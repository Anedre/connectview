import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  ConnectCampaignsV2Client,
  CreateCampaignCommand,
} from "@aws-sdk/client-connectcampaignsv2";
import { randomUUID } from "node:crypto";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { bulkUpsertProfilesFromCsv } from "../_shared/upsertCustomerProfileFromCsv";
import { bulkUpsertVoxLeads, setActiveDynamo } from "../_shared/leadSync";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { resolveDynamo, resolveCustomerProfiles } from "../_shared/tenantConnect";

// BYO Data Plane (#46): DynamoDB del tenant para campaigns + campaign-contacts
// + bulkUpsertVoxLeads (vía setActiveDynamo). ConnectCampaignsV2 queda legacy
// (es un AWS service que opera contra el InstanceId, no cross-account).
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const campaignsV2 = new ConnectCampaignsV2Client({ maxAttempts: 2 });
// Customer Profiles para el enrichment del CSV. Fallback Novasys SOLO para el
// tenant legacy — resolveCustomerProfiles bloquea a un tenant real sin CP.
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
// The AMD-aware flow created specifically for campaigns. Has a
// CheckOutboundCallStatus block at the start so voicemails/no-answer are
// dropped before reaching an agent.
const AMD_FLOW_ID =
  process.env.AMD_FLOW_ID || "a40dc527-8348-4694-a389-7b675c0ac3ac";

interface Contact {
  phone: string; // E.164
  customerName?: string;
  attributes?: Record<string, string>;
}

interface CreateCampaignBody {
  name: string;
  description?: string;
  sourcePhoneNumber: string;
  contactFlowId: string;
  contactFlowName?: string;
  campaignQueueId?: string;
  campaignQueueName?: string;
  dialMode?: "progressive" | "power" | "agentless" | "manual";
  concurrency?: number;
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  windowDaysOfWeek?: number[];
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  /** Per-agent contact bucket capacity. Default 5. The dialer pre-assigns
   *  contacts to each Available agent up to this number so the agent has a
   *  predictable queue. When the bucket runs low, more contacts are
   *  claimed from the general pool and assigned to that agent. */
  maxContactsPerAgent?: number;
  contacts: Contact[];
  createdBy?: string;
  startNow?: boolean;
  // If true (default), create an AWS Outbound Campaigns v2 resource too so
  // the service can handle dialing with AMD. If false, the campaign only
  // lives in our DynamoDB (legacy mode — no AMD).
  useNativeCampaign?: boolean;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Map our "dialMode" to connectcampaignsv2 outboundMode shape.
function buildOutboundMode(
  dialMode: string,
  concurrency: number
): Record<string, unknown> {
  const cap = Math.max(0.1, Math.min(1.0, concurrency / 2));
  if (dialMode === "power" || dialMode === "predictive") {
    return { predictive: { bandwidthAllocation: cap } };
  }
  // Default: progressive (1:1 agent pacing)
  return { progressive: { bandwidthAllocation: 1.0 } };
}

async function createNativeCampaign(params: {
  name: string;
  queueId: string;
  contactFlowId: string;
  sourcePhoneNumber: string;
  dialMode: string;
  concurrency: number;
  awsAccountId: string;
}): Promise<string | null> {
  try {
    const res = await campaignsV2.send(
      new CreateCampaignCommand({
        name: params.name.slice(0, 127),
        connectInstanceId: CONNECT_INSTANCE_ID,
        channelSubtypeConfig: {
          telephony: {
            capacity: 1.0,
            connectQueueId: params.queueId,
            outboundMode: buildOutboundMode(
              params.dialMode,
              params.concurrency
            ) as never,
            defaultOutboundConfig: {
              connectContactFlowId: params.contactFlowId,
              connectSourcePhoneNumber: params.sourcePhoneNumber,
              answerMachineDetectionConfig: {
                enableAnswerMachineDetection: true,
                awaitAnswerMachinePrompt: false,
              },
            },
          },
        },
        // Owner tag — this is what the Connect admin UI uses to associate a
        // campaign with the Connect instance. Without it, the UI shows 403s
        // and the Campaigns service won't dispatch. Matches AWS console
        // behavior when you create a campaign via the managed wizard.
        tags: {
          owner: `arn:aws:connect:us-east-1:${params.awsAccountId}:instance/${CONNECT_INSTANCE_ID}`,
        },
      })
    );
    return res.id || null;
  } catch (err) {
    console.error("createNativeCampaign failed:", err);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any, context: any) => {
  try {
    // Resolvemos el tenantId del JWT del usuario que crea la campaña. Lo
    // guardamos en el registro para que campaign-dialer (disparado por
    // EventBridge SIN token) sepa contra qué Connect tiene que pegar.
    const tenantId = await resolveTenantId(event?.headers);
    // BYO Data Plane (#46): DynamoDB del tenant + leadSync writes.
    {
      const r = await resolveDynamo(event?.headers, legacyDynamo);
      dynamo = r.dynamo;
      setActiveDynamo(r.tenantScoped ? r.dynamo : null);
    }
    const body: CreateCampaignBody = JSON.parse(event.body || "{}");
    // Derive account ID from our own Lambda ARN:
    // arn:aws:lambda:REGION:ACCOUNT:function:NAME
    const awsAccountId =
      (context?.invokedFunctionArn as string | undefined)?.split(":")[4] ||
      process.env.AWS_ACCOUNT_ID ||
      "";

    const errors: string[] = [];
    if (!body.name?.trim()) errors.push("name is required");
    if (!body.sourcePhoneNumber?.trim())
      errors.push("sourcePhoneNumber is required");
    if (!body.contactFlowId?.trim()) errors.push("contactFlowId is required");
    if (!Array.isArray(body.contacts) || body.contacts.length === 0)
      errors.push("contacts must be a non-empty array");
    if (body.contacts && body.contacts.length > 10000)
      errors.push("contacts limited to 10000 per campaign");

    if (errors.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Validation failed", details: errors }),
      };
    }

    const validContacts = body.contacts.filter((c) =>
      /^\+\d{8,15}$/.test((c.phone || "").trim())
    );
    const skippedCount = body.contacts.length - validContacts.length;

    if (validContacts.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No valid phone numbers",
          skipped: skippedCount,
        }),
      };
    }

    const campaignId = randomUUID();
    const now = new Date().toISOString();
    const startNow = body.startNow !== false;
    const status = startNow ? "RUNNING" : "DRAFT";
    // Default to our own Lambda dialer (custom). AWS Outbound Campaigns v2 is
    // only supported for US/MX/BR destinations from us-east-1 (not Peru), so
    // we keep useNativeCampaign=false. The v2 integration stays intact and
    // can be enabled per-campaign by passing useNativeCampaign=true explicitly
    // the day AWS adds PE coverage.
    const useNative = body.useNativeCampaign === true; // default false

    // 1. Create the AWS Outbound Campaigns v2 resource (parallel with our
    // meta). The service then handles dialing + AMD when we call BatchPutContact
    // in control-campaign "start".
    let awsCampaignId: string | null = null;
    if (useNative && body.campaignQueueId) {
      awsCampaignId = await createNativeCampaign({
        // Prefix with our id so we can find it later if needed
        name: `cv-${campaignId.slice(0, 8)}-${body.name.trim()}`,
        queueId: body.campaignQueueId,
        // Use the AMD-aware flow, not the one the admin picked (SBS etc).
        // The admin's chosen flow is stored in DynamoDB for reference but we
        // swap it for the AMD flow at the AWS level.
        contactFlowId: AMD_FLOW_ID,
        sourcePhoneNumber: body.sourcePhoneNumber,
        dialMode: body.dialMode || "progressive",
        concurrency: body.concurrency || 1,
        awsAccountId,
      });
    }

    // 2. Insert campaign meta — include awsCampaignId if we got one
    await dynamo.send(
      new PutItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Item: {
          campaignId: { S: campaignId },
          // tenantId del JWT del creador. campaign-dialer lo lee para
          // assume-role contra el Connect del cliente. "default" en transición.
          tenantId: { S: tenantId },
          name: { S: body.name.trim() },
          description: { S: body.description || "" },
          sourcePhoneNumber: { S: body.sourcePhoneNumber },
          contactFlowId: { S: body.contactFlowId },
          contactFlowName: { S: body.contactFlowName || "" },
          campaignQueueId: body.campaignQueueId
            ? { S: body.campaignQueueId }
            : { NULL: true },
          campaignQueueName: { S: body.campaignQueueName || "" },
          dialMode: { S: body.dialMode || "progressive" },
          concurrency: { N: String(body.concurrency || 1) },
          timezone: { S: body.timezone || "America/Lima" },
          windowStartHour: { N: String(body.windowStartHour ?? 9) },
          windowEndHour: { N: String(body.windowEndHour ?? 18) },
          windowDaysOfWeek: {
            S: JSON.stringify(body.windowDaysOfWeek ?? [1, 2, 3, 4, 5]),
          },
          retryNoAnswerMinutes: { N: String(body.retryNoAnswerMinutes ?? 30) },
          retryMaxAttempts: { N: String(body.retryMaxAttempts ?? 3) },
          maxContactsPerAgent: {
            N: String(
              Math.max(1, Math.min(50, body.maxContactsPerAgent ?? 5))
            ),
          },
          // WhatsApp template campaign fields. When campaignType is
          // "whatsapp" the dialer routes to send-whatsapp-template
          // instead of StartOutboundVoiceContact and the source phone
          // / dial mode / contact flow fields above are unused.
          campaignType: { S: (body as { campaignType?: string }).campaignType || "voice" },
          templateName: { S: (body as { templateName?: string }).templateName || "" },
          templateLanguage: { S: (body as { templateLanguage?: string }).templateLanguage || "es" },
          templateVarColumns: {
            S: JSON.stringify(
              (body as { templateVarColumns?: string[] }).templateVarColumns || []
            ),
          },
          status: { S: status },
          createdAt: { S: now },
          createdBy: { S: body.createdBy || "system" },
          startedAt: startNow ? { S: now } : { NULL: true },
          completedAt: { NULL: true },
          totalContacts: { N: String(validContacts.length) },
          pendingCount: { N: String(validContacts.length) },
          dialingCount: { N: "0" },
          connectedCount: { N: "0" },
          doneCount: { N: "0" },
          failedCount: { N: "0" },
          noAnswerCount: { N: "0" },
          skippedCount: { N: String(skippedCount) },
          // Native campaign link (null if creation failed or legacy mode)
          awsCampaignId: awsCampaignId
            ? { S: awsCampaignId }
            : { NULL: true },
          useNativeCampaign: { BOOL: !!awsCampaignId },
        },
      })
    );

    // 3. Batch insert contacts
    for (const batch of chunk(validContacts, 25)) {
      await dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [CONTACTS_TABLE]: batch.map((c) => {
              const rowId = randomUUID();
              const attrs = JSON.stringify(c.attributes || {});
              return {
                PutRequest: {
                  Item: {
                    campaignId: { S: campaignId },
                    rowId: { S: rowId },
                    phone: { S: c.phone },
                    customerName: { S: c.customerName || "" },
                    customAttributes: { S: attrs },
                    status: { S: "pending" },
                    attempts: { N: "0" },
                    createdAt: { S: now },
                    nextRetryAt: { S: now },
                  },
                },
              };
            }),
          },
        })
      );
    }

    // 4. Enrich Customer Profiles from CSV. The CSV is the source of
    //    truth the moment a campaign is uploaded — names, emails,
    //    documents and any other column the manager provides should be
    //    reflected on the profile the agent sees when the call connects.
    //    Best-effort: errors are counted but don't fail the campaign
    //    creation. Bounded by a 20s soft deadline so the Lambda's 30s
    //    timeout still has headroom for very large CSVs.
    let profileEnrichment: Awaited<
      ReturnType<typeof bulkUpsertProfilesFromCsv>
    > | null = null;
    try {
      // CP tenant-scoped (fail-closed): un tenant real sin CP resuelto NO
      // escribe estos contactos en el dominio de perfiles de Novasys.
      const cp = await resolveCustomerProfiles(
        event?.headers,
        legacyProfiles,
        LEGACY_PROFILES_DOMAIN
      );
      profileEnrichment = await bulkUpsertProfilesFromCsv(
        validContacts,
        { concurrency: 20, deadlineMs: 20_000 },
        { profiles: cp.client, domainName: cp.domainName }
      );
      console.log("customer-profile enrichment:", profileEnrichment);
    } catch (err) {
      console.warn("customer-profile enrichment failed (non-fatal):", err);
    }

    // 5. Volcar los contactos al embudo de Leads (el hub). NO empuja a SF en
    //    la subida (decisión de producto: a SF recién cuando se trabajan).
    //    Best-effort + acotado, igual que el enrichment de perfiles.
    let leadFunnel: Awaited<ReturnType<typeof bulkUpsertVoxLeads>> | null = null;
    try {
      leadFunnel = await bulkUpsertVoxLeads(validContacts, {
        source: `Vox Campaña: ${body.name.trim()}`,
        deadlineMs: 15_000,
      });
      console.log("lead funnel upsert:", leadFunnel);
    } catch (err) {
      console.warn("lead funnel upsert failed (non-fatal):", err);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status,
        totalContacts: validContacts.length,
        skipped: skippedCount,
        awsCampaignId,
        useNativeCampaign: !!awsCampaignId,
        profileEnrichment,
        leadFunnel,
      }),
    };
  } catch (err) {
    console.error("create-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to create campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
