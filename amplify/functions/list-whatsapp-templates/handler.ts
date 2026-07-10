import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppAccounts } from "../_shared/tenantConnect";
import { listTemplates, routeForAccount } from "../_shared/whatsappTemplatesApi";

/**
 * list-whatsapp-templates — lista las plantillas (HSM) aprobadas del tenant para
 * el gestor/wizard. Ahora es DUAL-MODE y multi-cuenta:
 *
 *  · Devuelve `accounts[]` — todas las cuentas (WABAs) del tenant: la de Meta
 *    standalone (mode="meta") y/o la del número anclado a Connect (mode="aws").
 *  · `?account=<wabaId>` lista las plantillas de ESA cuenta por su propio modo
 *    (Graph API de Meta o AWS End User Messaging). Sin `account`, usa la activa.
 *
 * Antes SIEMPRE consultaba AWS SocialMessaging → para un número de Meta la WABA
 * no existe en AWS y devolvía lista vacía. Ver _shared/whatsappTemplatesApi.ts.
 *
 * WhatsApp BYO: las cuentas salen del JWT (tenant). Sin cuentas → lista vacía
 * (NO las de Vox, que llevarían a envíos que Meta rechaza).
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const includeAll =
    event?.queryStringParameters?.includeAll === "true" ||
    event?.queryStringParameters?.includeAll === "1";
  const accountKey = event?.queryStringParameters?.account || undefined;

  const { accounts, client, tenantId } = await resolveWhatsAppAccounts(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID,
  );

  const resolved = await routeForAccount(accounts, client, tenantId, accountKey);
  if (!resolved) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        templates: [],
        accounts: [],
        wabaId: "",
        note: "WhatsApp no está configurado para esta organización. Carga tu número en Configuración → Integraciones.",
      }),
    };
  }

  try {
    const templates = await listTemplates(resolved.route, includeAll);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        templates,
        accounts,
        activeAccount: resolved.account.key,
        wabaId: resolved.account.wabaId,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-whatsapp-templates error", err);
    // Devolvemos las cuentas igual (para que el selector funcione) + el error.
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        templates: [],
        accounts,
        activeAccount: resolved.account.key,
        wabaId: resolved.account.wabaId,
        error: msg,
      }),
    };
  }
};
