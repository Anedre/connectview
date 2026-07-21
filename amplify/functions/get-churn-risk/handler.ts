import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient, SearchProfilesCommand } from "@aws-sdk/client-customer-profiles";
import { ConnectClient } from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO (#43+#46): module-active.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 1 });
let profiles: CustomerProfilesClient = legacyProfiles;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
const LEGACY_CUSTOMER_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
let CUSTOMER_PROFILES_DOMAIN = LEGACY_CUSTOMER_PROFILES_DOMAIN;

interface ContactRow {
  contactId: string;
  customerPhone?: string;
  initiationTimestamp: string;
  sentiment?: string;
  sentimentPositive?: number;
  sentimentNegative?: number;
  sentimentNeutral?: number;
  sentimentTotal?: number;
  disconnectReason?: string;
  duration?: number;
}

interface CustomerBucket {
  customerPhone: string;
  contactCount: number;
  negativeContacts: number;
  mixedContacts: number;
  lastContactAt: string;
  lastSentiment: string;
  totalNegativeSegments: number;
  totalPositiveSegments: number;
  avgDurationSec: number;
  abandonedCount: number;
}

async function scanRecentContacts(days: number): Promise<ContactRow[]> {
  const startIso = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const rows: ContactRow[] = [];
  let lastKey: Record<string, unknown> | undefined;
  // BUG-audit P2: paginar completo (antes truncaba a 10 páginas). El
  // FilterExpression filtra DESPUÉS de leer ≤1MB por página, así que 10 páginas
  // NO son 10*items: podía cortar clientes en riesgo de un rango largo.
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression:
          "initiationTimestamp >= :start AND attribute_exists(customerPhone) AND customerPhone <> :empty",
        ExpressionAttributeValues: {
          ":start": { S: startIso },
          ":empty": { S: "" },
        },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of result.Items || []) rows.push(unmarshall(it) as ContactRow);
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return rows;
}

function bucketByCustomer(rows: ContactRow[]): Map<string, CustomerBucket> {
  const map = new Map<string, CustomerBucket>();
  for (const r of rows) {
    const phone = r.customerPhone || "";
    if (!phone) continue;
    let b = map.get(phone);
    if (!b) {
      b = {
        customerPhone: phone,
        contactCount: 0,
        negativeContacts: 0,
        mixedContacts: 0,
        lastContactAt: r.initiationTimestamp,
        lastSentiment: r.sentiment || "UNKNOWN",
        totalNegativeSegments: 0,
        totalPositiveSegments: 0,
        avgDurationSec: 0,
        abandonedCount: 0,
      };
      map.set(phone, b);
    }
    b.contactCount++;
    b.totalNegativeSegments += Number(r.sentimentNegative || 0);
    b.totalPositiveSegments += Number(r.sentimentPositive || 0);
    b.avgDurationSec += Number(r.duration || 0);
    if (r.sentiment === "NEGATIVE") b.negativeContacts++;
    if (r.sentiment === "MIXED") b.mixedContacts++;
    if (r.disconnectReason === "CUSTOMER_DISCONNECT" && Number(r.duration || 0) < 30) {
      // Short call ending in customer hangup → likely abandoned / frustrated
      b.abandonedCount++;
    }
    if (new Date(r.initiationTimestamp) > new Date(b.lastContactAt)) {
      b.lastContactAt = r.initiationTimestamp;
      b.lastSentiment = r.sentiment || b.lastSentiment;
    }
  }
  // Finalize avgDuration
  for (const b of map.values()) {
    b.avgDurationSec = Math.round(b.avgDurationSec / Math.max(1, b.contactCount));
  }
  return map;
}

// Risk 0..100. Higher = more likely to churn.
function computeRiskScore(b: CustomerBucket): number {
  const negativeSegmentTotal = b.totalNegativeSegments + b.totalPositiveSegments;
  const negativeRatio =
    negativeSegmentTotal > 0 ? b.totalNegativeSegments / negativeSegmentTotal : 0;
  const contactWeight = Math.min(1, b.contactCount / 5); // ≥5 contacts in window = full weight
  const abandonedWeight = Math.min(1, b.abandonedCount / 3);
  const sentimentWeight = negativeRatio;
  const lastSentimentBoost =
    b.lastSentiment === "NEGATIVE" ? 0.2 : b.lastSentiment === "MIXED" ? 0.1 : 0;

  // Weighted combination — sentiment dominates, frequency and abandonment add on top.
  const score =
    40 * sentimentWeight + 25 * contactWeight + 20 * abandonedWeight + 15 * lastSentimentBoost;
  return Math.max(0, Math.min(100, Math.round(score * 1.1)));
}

async function lookupProfileName(phone: string): Promise<string | null> {
  try {
    const res = await profiles.send(
      new SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone],
      }),
    );
    const p = res.Items?.[0];
    if (!p) return null;
    const first = p.FirstName?.trim() || "";
    const last = p.LastName?.trim() || "";
    const name = `${first} ${last}`.trim();
    return name || null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO (#43+#46): tenant primero, fallback Novasys.
    {
      const r = await resolveConnect(event?.headers, legacyConnect, "");
      dynamo = r.dynamo || legacyDynamo;
      profiles = r.customerProfiles || legacyProfiles;
      // Fail-closed: tenant real sin CP resuelto → "" → no enriquecemos nombres
      // desde Novasys (la data ya viene del DDB tenant-scoped/bloqueado).
      CUSTOMER_PROFILES_DOMAIN = r.tenantScoped
        ? r.customerProfilesDomain || ""
        : LEGACY_CUSTOMER_PROFILES_DOMAIN;
    }
    const params = event.queryStringParameters || {};
    const days = parseInt(params.days || "30");
    const limit = parseInt(params.limit || "5");
    const minRisk = parseInt(params.minRisk || "40");

    const rows = await scanRecentContacts(days);
    const customers = bucketByCustomer(rows);

    // Rank by risk
    const ranked = [...customers.values()]
      .map((b) => {
        const score = computeRiskScore(b);
        const daysSince = Math.floor((Date.now() - new Date(b.lastContactAt).getTime()) / 86400000);
        return { ...b, riskScore: score, daysSinceContact: daysSince };
      })
      .filter((c) => c.riskScore >= minRisk)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, limit);

    // Enrich with customer names from Customer Profiles
    const enriched = await Promise.all(
      ranked.map(async (c) => ({
        customerPhone: c.customerPhone,
        name: (await lookupProfileName(c.customerPhone)) || c.customerPhone,
        contactCount: c.contactCount,
        lastSentiment: c.lastSentiment,
        daysSinceContact: c.daysSinceContact,
        riskScore: c.riskScore,
      })),
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeDays: days,
        totalCustomersAnalyzed: customers.size,
        atRisk: enriched,
      }),
    };
  } catch (err) {
    console.error("churn-risk error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute churn risk",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
