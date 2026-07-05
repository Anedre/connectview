import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppAccounts } from "../_shared/tenantConnect";
import { deleteTemplate, routeForAccount } from "../_shared/whatsappTemplatesApi";

/**
 * delete-whatsapp-template — borra una plantilla de la WABA del TENANT. BYO: la
 * WABA sale del JWT (resolveWhatsAppWaba). Acción DESTRUCTIVA (el frontend pide
 * confirmación).
 *
 * La API de AWS (DeleteWhatsAppMessageTemplate) exige `templateName`; con
 * `metaTemplateId` se borra esa versión de idioma puntual. Sin deleteAllLanguages
 * (default false) no toca las otras versiones de idioma.
 *
 * Body (JSON): { templateName, metaTemplateId? }
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event?.body || "{}");
  } catch {
    /* body inválido → cae en validación */
  }

  const templateName = String(body.templateName || "").trim();
  const metaTemplateId = String(body.metaTemplateId || "").trim();

  if (!templateName) {
    return resp(400, { error: "Falta el nombre de la plantilla a borrar." });
  }

  // Resolver la CUENTA del tenant (BYO, dual-mode).
  const accountKey = body.account ? String(body.account) : undefined;
  const { accounts, client, tenantId } = await resolveWhatsAppAccounts(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID,
  );
  const resolved = await routeForAccount(accounts, client, tenantId, accountKey);
  if (!resolved) {
    return resp(400, {
      error:
        "WhatsApp no está configurado para esta organización. Cargá tu número en Configuración → Integraciones.",
    });
  }

  try {
    // Con metaTemplateId borra solo esa versión de idioma; sin él, todas.
    await deleteTemplate(resolved.route, templateName, metaTemplateId || undefined);
    return resp(200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("delete-whatsapp-template error", err);
    return resp(500, { error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
