import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListUsersCommand,
  ListQueuesCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
} from "@aws-sdk/client-customer-profiles";
import { resolveConnect } from "../_shared/tenantConnect";

/**
 * list-recent-customers — surfaces the agent's recently-contacted
 * customers for the idle Cliente 360° browser. Reads from the
 * `connectview-contacts` table via the `agentUsername-initiationTimestamp-index`
 * GSI, dedupes by customer phone, and returns the freshest entry per
 * customer with rolled-up counts.
 *
 * Query params (HTTP GET):
 *   agentUsername — Cognito username (required, resolved → Connect user id)
 *   limit         — number of unique customers to return (default 12, max 30)
 *
 * Uses the existing connectview-contacts schema (see processContactEvent).
 */
// BYO (#43+#46): module-active. Connect + DDB + Customer Profiles + domain
// vienen del mismo resolveConnect.
const legacyConnect = new ConnectClient({ maxAttempts: 2 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
let profiles: CustomerProfilesClient = legacyProfiles;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
const TABLE = process.env.CONTACTS_TABLE || "connectview-contacts";
const LEGACY_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN ||
  process.env.CUSTOMER_PROFILES_DOMAIN_NAME ||
  "amazon-connect-novasys";
let PROFILES_DOMAIN = LEGACY_PROFILES_DOMAIN;

// CORS is handled by the Function URL's own CORS config (created with
// `aws lambda create-function-url-config --cors ...`). Adding the
// Access-Control-* headers HERE too produces duplicate response headers
// — browsers then reject the response. We only set the content-type.
const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

// Warm-instance cache: resolving Cognito username → Connect user ID
// requires a ListUsers paginated scan, which adds 150-300 ms. We cache
// per-username for the lifetime of the execution environment so back-
// to-back idle refreshes don't pay that cost again.
const usernameCache = new Map<string, string>();

// queueId → queueName cache (refreshed every 5 min). Without this the
// recent-customers UI shows queue UUIDs instead of friendly names.
const queueNameCache = new Map<string, string>();
let queueCacheExpiry = 0;

async function refreshQueueCache(): Promise<void> {
  if (Date.now() < queueCacheExpiry && queueNameCache.size > 0) return;
  queueNameCache.clear();
  let nextToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await connect.send(
      new ListQueuesCommand({
        InstanceId: instanceId,
        QueueTypes: ["STANDARD"],
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    for (const q of res.QueueSummaryList ?? []) {
      if (q.Id && q.Name) queueNameCache.set(q.Id, q.Name);
    }
    if (!res.NextToken) break;
    nextToken = res.NextToken;
  }
  queueCacheExpiry = Date.now() + 5 * 60 * 1000;
}

async function resolveAgentUserId(username: string): Promise<string | null> {
  const key = username.toLowerCase();
  const cached = usernameCache.get(key);
  if (cached) return cached;
  let nextToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await connect.send(
      new ListUsersCommand({
        InstanceId: instanceId,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    const match = (res.UserSummaryList ?? []).find(
      (u) => (u.Username || "").toLowerCase() === key
    );
    if (match?.Id) {
      usernameCache.set(key, match.Id);
      return match.Id;
    }
    if (!res.NextToken) return null;
    nextToken = res.NextToken;
  }
  return null;
}

function s(v?: AttributeValue): string | undefined {
  return v?.S;
}
function n(v?: AttributeValue): number | undefined {
  const raw = v?.N;
  return raw === undefined ? undefined : Number(raw);
}

interface RecentCustomer {
  customerPhone: string;
  lastContactTime: string; // ISO
  lastChannel: string;
  lastQueueName?: string;
  lastDuration?: number;
  lastContactId: string;
  contactCount: number;
  // Enriched from Customer Profiles SearchProfiles. Optional — if the
  // lookup fails for one customer we just leave them with phone only.
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  partyType?: string;
}

// Profile lookups are slow individually (~150-300 ms each) but parallelize
// well. We cap concurrent calls so the Lambda doesn't burst-trigger
// throttling on the Customer Profiles API.
const PROFILE_LOOKUP_CONCURRENCY = 8;

async function enrichWithProfile(
  customer: RecentCustomer
): Promise<RecentCustomer> {
  if (!PROFILES_DOMAIN) return customer;
  try {
    const res = await profiles.send(
      new SearchProfilesCommand({
        DomainName: PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [customer.customerPhone],
        MaxResults: 1,
      })
    );
    const p = res.Items?.[0];
    if (!p) return customer;
    return {
      ...customer,
      firstName: p.FirstName || undefined,
      lastName: p.LastName || undefined,
      businessName: p.BusinessName || undefined,
      email: p.EmailAddress || undefined,
      partyType: p.PartyType || undefined,
    };
  } catch (err) {
    // Soft-fail — log but return unenriched record so the UI keeps
    // working even if Profiles is temporarily unavailable.
    console.warn(
      "Profile enrichment failed for",
      customer.customerPhone,
      err instanceof Error ? err.message : err
    );
    return customer;
  }
}

/** Run enrichment in parallel batches so we don't blow past the
 *  Customer Profiles per-second quota on a 30-customer payload. */
async function enrichAll(items: RecentCustomer[]): Promise<RecentCustomer[]> {
  const out: RecentCustomer[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(PROFILE_LOOKUP_CONCURRENCY, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await enrichWithProfile(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // BYO (#43+#46): tenant primero, fallback Novasys.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
    dynamo = r.dynamo || legacyDynamo;
    profiles = r.customerProfiles || legacyProfiles;
    // Fail-closed: solo el tenant legacy (Novasys) cae al dominio del env. Un
    // tenant real sin CP resuelto → "" (skip enrichment), NUNCA amazon-connect-novasys.
    PROFILES_DOMAIN = r.tenantScoped
      ? r.customerProfilesDomain || ""
      : LEGACY_PROFILES_DOMAIN;
  }

  const params = event.queryStringParameters || {};
  const agentUsername = (params.agentUsername || "").trim();
  const limit = Math.min(parseInt(params.limit || "12", 10) || 12, 30);

  if (!agentUsername) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "agentUsername requerido" }),
    };
  }
  if (!instanceId) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "CONNECT_INSTANCE_ID no configurado" }),
    };
  }

  try {
    // Refresh queue cache in parallel — used to resolve lastQueueName.
    const queueWarm = refreshQueueCache();
    const agentId = await resolveAgentUserId(agentUsername);
    if (!agentId) {
      // Empty result rather than 404 — UI renders "no recent contacts"
      // cleanly when an unknown username is passed.
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ items: [], reason: "agent-not-found" }),
      };
    }

    // Query the GSI in descending order. Scan enough rows to dedup ~limit
    // unique customers — assume an agent might re-contact the same
    // customer up to 3× on average → scan 4×limit rows.
    const SCAN_DEPTH = Math.max(60, limit * 4);
    const q = await dynamo.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "agentUsername-initiationTimestamp-index",
        KeyConditionExpression: "agentUsername = :u",
        ExpressionAttributeValues: {
          ":u": { S: agentId },
        },
        ScanIndexForward: false,
        Limit: SCAN_DEPTH,
      })
    );

    await queueWarm; // ensure the queue cache is populated before we map

    const dedup = new Map<string, RecentCustomer>();
    for (const item of q.Items ?? []) {
      const phone = s(item.customerPhone);
      if (!phone) continue;
      const cur = dedup.get(phone);
      if (!cur) {
        // `queueName` in the contacts table is actually the queue ID
        // (we set it from contact.getQueue().name which happens to be
        // empty for many contacts → the writer falls back to the id).
        // Resolve it to a friendly name here.
        const rawQueue = s(item.queueName);
        const resolvedQueue = rawQueue
          ? queueNameCache.get(rawQueue) || rawQueue
          : undefined;
        dedup.set(phone, {
          customerPhone: phone,
          lastContactTime: s(item.initiationTimestamp) || "",
          lastChannel: s(item.channel) || "VOICE",
          lastQueueName: resolvedQueue,
          lastDuration: n(item.duration),
          lastContactId: s(item.contactId) || "",
          contactCount: 1,
        });
      } else {
        cur.contactCount += 1;
        // GSI is sorted desc on initiationTimestamp so the first
        // observation IS the freshest; subsequent ones just bump count.
      }
      if (dedup.size >= limit) break;
    }

    // Enrich each deduped customer with their Profile (name/business).
    // Parallelized + soft-fails so a Profiles outage degrades gracefully.
    const enriched = await enrichAll(Array.from(dedup.values()));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        items: enriched,
        scanned: q.Items?.length ?? 0,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-recent-customers error", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
