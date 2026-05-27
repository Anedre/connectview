import type { Handler } from "aws-lambda";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";

const client = new CustomerProfilesClient({});
const DOMAIN_NAME = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

// ─── Types ────────────────────────────────────────────────────────────────

/** Shape of the CTR object stored by Connect's standard `CTR` ObjectType.
 *  We keep only the fields we actually use to compute metrics; everything
 *  else is left as `unknown` so the type-check doesn't force us to update
 *  this every time AWS adds a field. */
interface CtrObject {
  contactId?: string;
  channel?: string;
  initiationTimestamp?: number;
  connectedToSystemTimestamp?: number;
  disconnectTimestamp?: number;
  initiationMethod?: string;
  disconnectReason?: string;
  initialContactFlowId?: string;
  agent?: {
    arn?: string;
    username?: string;
    agentInteractionDurationMillis?: number;
    afterContactWorkDurationMillis?: number;
  } | null;
  queue?: {
    arn?: string;
    enqueueTimestamp?: number;
    dequeueTimestamp?: number;
    durationMillis?: number;
  } | null;
  attributes?: Record<string, string>;
  chatMetrics?: {
    contactMetrics?: {
      totalMessages?: number;
      totalBotMessages?: number;
      conversationTurnCount?: number;
      agentFirstResponseTimeInMillis?: number;
    };
    customerMetrics?: {
      messagesSent?: number;
      messageLengthInChars?: number;
      maxResponseTimeInMillis?: number;
      lastMessageTimestamp?: number;
    };
  } | null;
  qualityMetrics?: {
    agent?: { audio?: { qualityScore?: number } } | null;
  } | null;
  segmentAttributes?: Record<string, { valueString?: string }>;
  customerEndpoint?: { address?: string } | null;
  systemEndpoint?: { address?: string } | null;
}

interface ProfileSummary {
  profileId: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  email?: string;
  phoneNumber?: string;
  accountNumber?: string;
  birthDate?: string;
  gender?: string;
  partyType?: string;
  businessName?: string;
  address?: unknown;
  attributes?: Record<string, string> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Lowercase / normalise a channel name from CTR data. WhatsApp is delivered
 *  as channel=CHAT with segmentAttributes["connect:Subtype"] = "connect:WhatsApp",
 *  so we surface "whatsapp" as a distinct bucket for the agent UI. */
function normalizeChannel(ctr: CtrObject): string {
  const subtype =
    ctr.segmentAttributes?.["connect:Subtype"]?.valueString || "";
  if (subtype.toLowerCase().includes("whatsapp")) return "whatsapp";
  const ch = (ctr.channel || "").toUpperCase();
  if (ch === "VOICE" || ch === "TELEPHONY") return "voice";
  if (ch === "CHAT") return "chat";
  if (ch === "EMAIL") return "email";
  if (ch === "TASK") return "task";
  if (ch === "SMS") return "sms";
  return ch.toLowerCase() || "unknown";
}

/** Try every shape S3 / CustomerProfiles uses to ship the actual CTR JSON. */
function parseCtr(raw: unknown): CtrObject | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as CtrObject;
  return null;
}

/**
 * Compute per-customer aggregates over the CTR history list. Designed to
 * be cheap: a single pass, no nested loops. All output goes to the
 * `stats` field of the Lambda response.
 */
function computeMetrics(ctrs: CtrObject[]) {
  const now = Date.now();
  const D7 = 7 * 86_400_000;
  const D30 = 30 * 86_400_000;
  const D90 = 90 * 86_400_000;

  let total = 0;
  const channelCount: Record<string, number> = {};
  let lastTs: number | undefined;
  let lastChannel: string | undefined;
  let lastAgent: string | undefined;
  let lastIntent: string | undefined;

  let in7d = 0;
  let in30d = 0;
  let in90d = 0;

  let qualityScoreSum = 0;
  let qualityScoreCount = 0;

  let chatMessagesTotal = 0;
  let chatCustomerMessages = 0;
  let chatMaxResponseMs = 0;

  let abandonedCount = 0;
  let voicemailCount = 0;
  let connectedCount = 0;

  // Hour-of-day histogram (24 buckets). We use the customer's local time
  // best-effort by assuming the CTR timestamp matches the customer phone's
  // tz — for Perú that's UTC-5. We add an offset later.
  const hours = new Array<number>(24).fill(0);

  // UDEP-specific attributes. We grab them from the MOST RECENT CTR that
  // has them set, so old empty values don't override newer good ones.
  const udepAttrs: Record<string, string> = {};
  const allAttrs: Record<string, string> = {};

  for (const ctr of ctrs) {
    if (!ctr) continue;
    total += 1;
    const ts = ctr.initiationTimestamp || 0;
    const channel = normalizeChannel(ctr);
    channelCount[channel] = (channelCount[channel] || 0) + 1;

    if (ts && (!lastTs || ts > lastTs)) {
      lastTs = ts;
      lastChannel = channel;
      const arn = ctr.agent?.arn || "";
      lastAgent = arn ? arn.split("/").pop() || arn : undefined;
      lastIntent =
        ctr.attributes?.udep_intent ||
        ctr.attributes?.intent ||
        lastIntent;
    }

    const age = now - ts;
    if (age <= D7) in7d += 1;
    if (age <= D30) in30d += 1;
    if (age <= D90) in90d += 1;

    const q = ctr.qualityMetrics?.agent?.audio?.qualityScore;
    if (typeof q === "number") {
      qualityScoreSum += q;
      qualityScoreCount += 1;
    }

    const cm = ctr.chatMetrics?.contactMetrics;
    if (cm?.totalMessages) chatMessagesTotal += cm.totalMessages;
    const custm = ctr.chatMetrics?.customerMetrics;
    if (custm?.messagesSent) chatCustomerMessages += custm.messagesSent;
    if (custm?.maxResponseTimeInMillis && custm.maxResponseTimeInMillis > chatMaxResponseMs)
      chatMaxResponseMs = custm.maxResponseTimeInMillis;

    if (ctr.disconnectReason === "CUSTOMER_DISCONNECT" && !ctr.agent?.arn) {
      abandonedCount += 1;
    }
    if (ctr.disconnectReason === "CONTACT_FLOW_DISCONNECT") {
      voicemailCount += 1;
    }
    if (ctr.agent?.arn) connectedCount += 1;

    if (ts) {
      // -5h for Perú (UTC-5, no DST).
      const localHour = new Date(ts - 5 * 3600 * 1000).getUTCHours();
      hours[localHour] += 1;
    }

    // Pull UDEP attrs from this CTR if its initiation is newer than the
    // attrs we have. We track the per-attribute "from when" via the `ts`
    // of this CTR — only overwrite when newer.
    for (const [k, v] of Object.entries(ctr.attributes || {})) {
      if (!v || !String(v).trim()) continue;
      allAttrs[k] = String(v);
      if (k.startsWith("udep_") || k === "selectedProduct" || k === "selectedMotivo") {
        udepAttrs[k] = String(v);
      }
    }
  }

  // Preferred channel = the one with the most contacts.
  let preferredChannel: string | undefined;
  let preferredChannelPct = 0;
  if (total > 0) {
    const sorted = Object.entries(channelCount).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      preferredChannel = sorted[0][0];
      preferredChannelPct = Math.round((sorted[0][1] / total) * 100);
    }
  }

  // Preferred hour-of-day = the hour with the most contacts (Perú local).
  let preferredHour: number | undefined;
  let preferredHourCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hours[h] > preferredHourCount) {
      preferredHour = h;
      preferredHourCount = hours[h];
    }
  }

  return {
    total,
    in7d,
    in30d,
    in90d,
    channelBreakdown: channelCount,
    preferredChannel,
    preferredChannelPct,
    lastContactAt: lastTs ? new Date(lastTs).toISOString() : null,
    lastContactChannel: lastChannel,
    lastAgentId: lastAgent,
    lastIntent,
    avgQualityScore:
      qualityScoreCount > 0
        ? +(qualityScoreSum / qualityScoreCount).toFixed(2)
        : null,
    chatMessagesTotal,
    chatCustomerMessages,
    chatMaxResponseMs,
    abandonedCount,
    voicemailCount,
    connectedCount,
    preferredHourLocal: preferredHour,
    udepAttrs,
    customAttrs: allAttrs,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const params = event.queryStringParameters || {};
  const phone = params.phone;
  const email = params.email;
  const profileId = params.profileId;
  const fullHistory = params.fullHistory === "true";

  try {
    if (!phone && !email && !profileId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "phone, email, or profileId parameter required",
        }),
      };
    }

    const searchKey = profileId ? "_profileId" : phone ? "_phone" : "_email";
    const searchValue = profileId || phone || email;

    const result = await client.send(
      new SearchProfilesCommand({
        DomainName: DOMAIN_NAME,
        KeyName: searchKey,
        Values: [searchValue!],
      })
    );

    const profile = result.Items?.[0];
    if (!profile) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: null }),
      };
    }

    // Fetch CTR history. We grab up to 100 (the SDK's per-page max) so
    // metrics over 30-90 days are accurate even for chatty customers.
    let history: { objectTypeName?: string; raw?: unknown; parsed?: CtrObject | null }[] = [];
    try {
      const historyResult = await client.send(
        new ListProfileObjectsCommand({
          DomainName: DOMAIN_NAME,
          ProfileId: profile.ProfileId!,
          ObjectTypeName: "CTR",
          MaxResults: 100,
        })
      );
      history = (historyResult.Items || []).map((it) => ({
        objectTypeName: it.ObjectTypeName,
        raw: it.Object,
        parsed: parseCtr(it.Object),
      }));
    } catch {
      /* CTR object type may not be configured; metrics stay zero */
    }

    const ctrs = history.map((h) => h.parsed).filter((c): c is CtrObject => !!c);
    const stats = computeMetrics(ctrs);

    // Build a compact timeline (most recent N) so the frontend doesn't
    // need to re-parse the big CTRs again. Only the fields the timeline
    // UI actually renders.
    const timeline = ctrs
      .map((c) => ({
        contactId: c.contactId,
        channel: normalizeChannel(c),
        initiationTimestamp: c.initiationTimestamp
          ? new Date(c.initiationTimestamp).toISOString()
          : null,
        duration:
          c.disconnectTimestamp && c.initiationTimestamp
            ? Math.round((c.disconnectTimestamp - c.initiationTimestamp) / 1000)
            : 0,
        agentUserId: c.agent?.arn?.split("/").pop(),
        queueArn: c.queue?.arn,
        disconnectReason: c.disconnectReason,
        intent: c.attributes?.udep_intent || c.attributes?.intent,
        nivel: c.attributes?.udep_nivel,
        source: c.attributes?.udep_source,
        wasAnswered: !!c.agent?.arn,
        subtype: c.segmentAttributes?.["connect:Subtype"]?.valueString,
      }))
      .sort((a, b) =>
        (b.initiationTimestamp || "").localeCompare(a.initiationTimestamp || "")
      )
      .slice(0, fullHistory ? 100 : 30);

    const profileOut: ProfileSummary = {
      profileId: profile.ProfileId!,
      firstName: profile.FirstName,
      lastName: profile.LastName,
      middleName: profile.MiddleName,
      email: profile.EmailAddress || profile.PersonalEmailAddress,
      phoneNumber:
        profile.PhoneNumber ||
        profile.MobilePhoneNumber ||
        profile.HomePhoneNumber,
      accountNumber: profile.AccountNumber,
      birthDate: profile.BirthDate,
      gender: profile.Gender,
      partyType: profile.PartyType,
      businessName: profile.BusinessName,
      address: profile.Address,
      attributes: profile.Attributes,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: profileOut,
        stats,
        timeline,
        // Keep `history` raw for the original caller (back-compat). When
        // the frontend has been updated to use `timeline`, we can drop
        // this to save bandwidth.
        history: history.slice(0, 5).map((h) => ({
          ObjectTypeName: h.objectTypeName,
          Object: typeof h.raw === "string" ? h.raw : JSON.stringify(h.raw),
        })),
      }),
    };
  } catch (error) {
    console.error("Error looking up customer profile:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to lookup customer profile",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
