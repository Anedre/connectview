import type { Handler } from "aws-lambda";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  type Profile,
} from "@aws-sdk/client-customer-profiles";

/**
 * search-customer-profiles — flexible profile search for the idle
 * "Cliente 360°" browser in the agent desktop. Wraps SearchProfiles
 * with multiple indexed keys so the agent can paste a phone number,
 * email or partial name and get matches.
 *
 * Connect's SearchProfiles only supports exact match on indexed keys;
 * we expose the most useful ones (_phone, _email, _account, _fullName)
 * and fan out so a single query string is tried against several.
 */
const client = new CustomerProfilesClient({});
const DOMAIN_NAME =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

// CORS is handled by the Function URL's own CORS config (duplicated
// headers cause the browser to reject the response).
const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

// Strip everything that's not a digit or '+' so users can paste phones
// with spaces / dashes and still hit the indexed _phone key.
function normalisePhone(raw: string): string {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

interface SearchResult {
  profileId: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  accountNumber?: string;
  partyType?: string;
  matchedBy: "phone" | "email" | "account" | "name";
}

function projectProfile(p: Profile, matchedBy: SearchResult["matchedBy"]): SearchResult {
  return {
    profileId: p.ProfileId!,
    firstName: p.FirstName,
    lastName: p.LastName,
    businessName: p.BusinessName,
    phoneNumber:
      p.PhoneNumber || p.MobilePhoneNumber || p.HomePhoneNumber || undefined,
    email: p.EmailAddress || p.PersonalEmailAddress || undefined,
    accountNumber: p.AccountNumber,
    partyType: p.PartyType,
    matchedBy,
  };
}

async function searchKey(
  keyName: string,
  value: string,
  matchedBy: SearchResult["matchedBy"]
): Promise<SearchResult[]> {
  try {
    const res = await client.send(
      new SearchProfilesCommand({
        DomainName: DOMAIN_NAME,
        KeyName: keyName,
        Values: [value],
        MaxResults: 25,
      })
    );
    return (res.Items ?? []).map((p) => projectProfile(p, matchedBy));
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const params = event.queryStringParameters || {};
  const query = (params.q || "").trim();

  if (!query) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Falta el parámetro q" }),
    };
  }

  try {
    const isEmail = /@/.test(query);
    const isPhonish = /^[+\d\s()-]+$/.test(query) && /\d/.test(query);

    // Fire only the relevant searches in parallel — saves Connect API
    // calls when the input is obviously a phone or email.
    let results: SearchResult[];
    if (isEmail) {
      results = await searchKey("_email", query.toLowerCase(), "email");
    } else if (isPhonish) {
      const normalised = normalisePhone(query);
      const variants = new Set<string>([normalised]);
      // Add the bare-digits variant in case the indexed value has no '+'.
      if (normalised.startsWith("+")) variants.add(normalised.slice(1));
      const byPhone = (
        await Promise.all(
          Array.from(variants).map((v) => searchKey("_phone", v, "phone"))
        )
      ).flat();
      // Also try account number — same digits-only shape — as fallback.
      const byAcct = await searchKey("_account", normalised.replace(/^\+/, ""), "account");
      results = [...byPhone, ...byAcct];
    } else {
      // Treat as full-name search (Connect's _fullName key is exact match).
      results = await searchKey("_fullName", query, "name");
    }

    // De-dupe by profileId
    const seen = new Set<string>();
    const unique = results.filter((r) => {
      if (seen.has(r.profileId)) return false;
      seen.add(r.profileId);
      return true;
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ results: unique }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("search-customer-profiles error", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
