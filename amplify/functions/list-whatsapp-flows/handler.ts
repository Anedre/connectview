import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppAccounts } from "../_shared/tenantConnect";
import { listFlows, routeForAccount } from "../_shared/whatsappTemplatesApi";

/**
 * list-whatsapp-flows — lista los WhatsApp Flows (formularios nativos de Meta) de
 * la WABA del TENANT, para elegir uno al agregar un botón FLOW a una plantilla.
 * DUAL-MODE: para un número de Meta standalone usa la Graph API (/{wabaId}/flows);
 * para el número anclado a Connect usa AWS End User Messaging. `?account=<wabaId>`
 * elige la cuenta (sin él, la activa). Ver _shared/whatsappTemplatesApi.ts.
 *
 * Devuelve { flows: [{ id, name, status, categories }] }. Sin flows → [].
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const accountKey = event?.queryStringParameters?.account || undefined;
  const { accounts, client, tenantId } = await resolveWhatsAppAccounts(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID,
  );
  const resolved = await routeForAccount(accounts, client, tenantId, accountKey);
  if (!resolved) {
    return resp(200, { flows: [], note: "WhatsApp no configurado para esta organización." });
  }

  try {
    const flows = await listFlows(resolved.route);
    return resp(200, { flows, activeAccount: resolved.account.key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-whatsapp-flows error", err);
    return resp(200, { flows: [], error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
