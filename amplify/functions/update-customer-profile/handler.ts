import type { Handler } from "aws-lambda";
import {
  CustomerProfilesClient,
  UpdateProfileCommand,
} from "@aws-sdk/client-customer-profiles";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

/**
 * update-customer-profile — Connect Customer Profiles writer. The agent
 * desktop's idle browser calls this after editing a profile to push
 * the changes back to the domain.
 *
 * Body: { profileId, fields: { FirstName, LastName, ... }, actor }
 * `fields` is whitelisted server-side so the UI can't ask us to PUT
 * arbitrary attributes that don't map to known profile columns.
 */
const profiles = new CustomerProfilesClient({});
const dynamo = new DynamoDBClient({});
const DOMAIN_NAME =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

// CORS is handled by the Function URL's own CORS config (duplicated
// headers cause the browser to reject the response).
const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

// Fields we let the agent edit. Anything else in the request body is
// silently dropped (server-side whitelist). Attributes (key/value bag)
// are merged separately below.
const ALLOWED_FIELDS = [
  "FirstName",
  "MiddleName",
  "LastName",
  "BusinessName",
  "PhoneNumber",
  "MobilePhoneNumber",
  "HomePhoneNumber",
  "EmailAddress",
  "PersonalEmailAddress",
  "BusinessEmailAddress",
  "AccountNumber",
  "AdditionalInformation",
  "BirthDate",
] as const;

async function audit(
  actor: string,
  profileId: string,
  fields: Record<string, unknown>,
  result: "success" | "error",
  errorMsg?: string
): Promise<void> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: randomUUID() },
          timestamp: { S: new Date().toISOString() },
          action: { S: "update-customer-profile" },
          actor: { S: actor },
          target: { S: JSON.stringify({ profileId, fields }) },
          result: { S: result },
          errorMsg: { S: errorMsg || "" },
        },
      })
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}

interface UpdateBody {
  profileId: string;
  fields: Record<string, string | null | undefined>;
  attributes?: Record<string, string | null>;
  actor?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  let body: UpdateBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "JSON inválido" }),
    };
  }

  if (!body.profileId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "profileId requerido" }),
    };
  }

  // Filter to allowed fields only.
  //
  // Connect's UpdateProfile API uses the convention:
  //   field absent      → leave the existing value untouched
  //   field = "" (empty)→ CLEAR the value
  //   field = "something" → set it
  // We expose `null` from the frontend as the "clear" intent and
  // convert it to "" here.
  const updates: Record<string, string | undefined> = {};
  for (const key of ALLOWED_FIELDS) {
    const v = body.fields?.[key];
    if (v === undefined) continue;
    updates[key] = v === null ? "" : String(v);
  }

  try {
    // Customer Profiles UpdateProfile fields are pass-through. Attributes
    // map is merged separately; passing `Attributes` in the request fully
    // replaces existing attributes, so we don't expose attribute editing
    // here (would be lossy without a get-then-merge step).
    await profiles.send(
      new UpdateProfileCommand({
        DomainName: DOMAIN_NAME,
        ProfileId: body.profileId,
        ...updates,
      })
    );
    await audit(
      body.actor || "unknown",
      body.profileId,
      updates,
      "success"
    );
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ profileId: body.profileId, updated: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      body.actor || "unknown",
      body.profileId,
      updates,
      "error",
      msg
    );
    console.error("update-customer-profile error", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Update falló", message: msg }),
    };
  }
};
