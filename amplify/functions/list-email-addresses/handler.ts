import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchEmailAddressesCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

/**
 * list-email-addresses — returns the Connect email addresses the
 * instance has registered (the "From" addresses for outbound email).
 * The agent desktop calls this once to populate the From dropdown in
 * the New Email inline form.
 */
const connect = new ConnectClient({ maxAttempts: 2 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// CORS is handled by the Function URL's own CORS config (duplicated
// headers cause the browser to reject the response).
const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  // Auth + tenant: resuelve el Connect del tenant del JWT. Anónimo →
  // blockedConnectClient → SearchEmailAddresses devuelve vacío (cierra el leak de
  // las direcciones de email de Connect de Novasys, que antes eran públicas).
  // Tenant real → SU instancia + SUS direcciones.
  const r = await resolveConnect(event.headers, connect, INSTANCE_ID);
  try {
    const out = await r.client.send(
      new SearchEmailAddressesCommand({
        InstanceId: r.instanceId,
        MaxResults: 100,
      })
    );
    const items = (out.EmailAddresses ?? []).map((e) => ({
      id: e.EmailAddressId,
      arn: e.EmailAddressArn,
      address: e.EmailAddress,
      displayName: e.DisplayName,
      description: e.Description,
    }));
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ items }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-email-addresses error", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
