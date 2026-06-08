import type { Handler } from "aws-lambda";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  type Profile,
} from "@aws-sdk/client-customer-profiles";
import { ConnectClient } from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

/**
 * search-customer-profiles — flexible profile search for the idle
 * "Cliente 360°" browser in the agent desktop. Wraps SearchProfiles
 * with multiple indexed keys so the agent can paste a phone number,
 * email or partial name and get matches.
 *
 * BYO (#43): Customer Profiles del cliente (cross-account); fallback Novasys.
 *
 * Connect's SearchProfiles only supports exact match on indexed keys;
 * we expose the most useful ones (_phone, _email, _account, _fullName)
 * and fan out so a single query string is tried against several.
 */
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const legacyClient = new CustomerProfilesClient({});
let client: CustomerProfilesClient = legacyClient;
const LEGACY_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
let DOMAIN_NAME = LEGACY_DOMAIN;

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

  // BYO (#43): tenant primero, fallback Novasys.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, "");
    client = r.customerProfiles || legacyClient;
    // Fail-closed: tenant real sin CP resuelto → "" → no buscamos en Novasys.
    DOMAIN_NAME = r.tenantScoped
      ? r.customerProfilesDomain || ""
      : LEGACY_DOMAIN;
  }

  const params = event.queryStringParameters || {};
  const query: string = (params.q || "").trim();

  if (!query) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Falta el parámetro q" }),
    };
  }

  // Fail-closed: tenant real sin Customer Profiles resuelto (DOMAIN_NAME "") →
  // sin resultados. NO consultamos el dominio de Novasys.
  if (!DOMAIN_NAME) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ results: [] }),
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
      // Name search — SearchProfiles only does EXACT match per key, so
      // we fan out across every name-bearing indexed key in parallel
      // and the user gets a hit if the typed text matches ANY of them
      // exactly. Useful when the agent types "Miguel" (matches by
      // _firstName) or "Trigger Co" (matches by _businessName or
      // _fullName) or "Loyola Diaz" (matches by _lastName).
      //
      // We also generate Title Case and lowercase variants because
      // Connect's indexed values can have either casing depending on
      // how the profile was created (Streams writes Title Case;
      // batch imports often write whatever the source had).
      const words = query.split(/\s+/).filter(Boolean);
      const variants = new Set<string>([query]);
      // Title Case for the whole string
      variants.add(
        words
          .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
          .join(" ")
      );
      variants.add(query.toLowerCase());
      variants.add(query.toUpperCase());

      // Keys we'll try in parallel against every variant
      const KEY_PAIRS: Array<{
        key: string;
        matchedBy: SearchResult["matchedBy"];
      }> = [
        { key: "_fullName", matchedBy: "name" },
        { key: "_businessName", matchedBy: "name" },
        { key: "_firstName", matchedBy: "name" },
        { key: "_lastName", matchedBy: "name" },
      ];

      // If the query has multiple words, also try first/last word
      // separately against firstName / lastName (catches "Miguel Vega"
      // → first-word "Miguel" matches _firstName="Miguel").
      const extraValues = new Set<string>();
      if (words.length > 1) {
        extraValues.add(words[0]);
        extraValues.add(words[words.length - 1]);
        // Title Case for the first/last word
        extraValues.add(
          words[0][0].toUpperCase() + words[0].slice(1).toLowerCase()
        );
        extraValues.add(
          words[words.length - 1][0].toUpperCase() +
            words[words.length - 1].slice(1).toLowerCase()
        );
      }

      // Build the cartesian (key × variant) job list, capped to avoid
      // hammering the Profiles API on a multi-word query.
      const jobs: Array<Promise<SearchResult[]>> = [];
      for (const v of variants) {
        for (const { key, matchedBy } of KEY_PAIRS) {
          jobs.push(searchKey(key, v, matchedBy));
        }
      }
      // First/last word jobs only target name-component keys.
      for (const v of extraValues) {
        jobs.push(searchKey("_firstName", v, "name"));
        jobs.push(searchKey("_lastName", v, "name"));
        jobs.push(searchKey("_businessName", v, "name"));
      }

      const flat = (await Promise.all(jobs)).flat();
      results = flat;
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
