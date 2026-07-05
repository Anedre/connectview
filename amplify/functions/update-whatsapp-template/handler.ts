import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppAccounts } from "../_shared/tenantConnect";
import { updateTemplate, routeForAccount } from "../_shared/whatsappTemplatesApi";
import { buildTemplateComponents, type ButtonIn } from "../_shared/waTemplateComponents";

/**
 * update-whatsapp-template — edita una plantilla EXISTENTE de la WABA del TENANT.
 * Igual que create- pero usa UpdateWhatsAppMessageTemplateCommand e identifica la
 * plantilla por `metaTemplateId`. BYO: la WABA sale del JWT (resolveWhatsAppWaba).
 *
 * Diferencias con create (ver AWS End User Messaging Social):
 *   - se identifica con id (WABA) + metaTemplateId
 *   - `templateComponents` es el ARRAY de components (no el objeto completo), en
 *     base64 (≤3000 chars). NO se puede cambiar name ni language; category sí.
 *
 * Reglas de Meta (no las forzamos acá; el error de Meta es claro): no se puede
 * editar una plantilla en revisión (PENDING); editar tiene límite (~1/24 h);
 * editar una APPROVED normalmente la manda de nuevo a revisión.
 *
 * Body (JSON):
 *   { metaTemplateId, category, bodyText?, headerText?, footerText?,
 *     buttons?: [{ type, text, url?, phoneNumber?, example? }], variableExamples?,
 *     addSecurityRecommendation?, codeExpirationMinutes?, otpButtonText? }
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

  const metaTemplateId = String(body.metaTemplateId || "").trim();
  const category = String(body.category || "UTILITY")
    .trim()
    .toUpperCase();

  if (!/^[0-9]+$/.test(metaTemplateId)) {
    return resp(400, { error: "Falta el identificador de la plantilla (metaTemplateId)." });
  }

  // Validar + construir los components (mismo builder que create).
  const built = buildTemplateComponents({
    category,
    bodyText: body.bodyText ? String(body.bodyText) : "",
    headerText: body.headerText ? String(body.headerText) : "",
    headerFormat: body.headerFormat ? String(body.headerFormat) : "TEXT",
    headerHandle: body.headerHandle ? String(body.headerHandle) : "",
    footerText: body.footerText ? String(body.footerText) : "",
    buttons: Array.isArray(body.buttons) ? (body.buttons as ButtonIn[]) : [],
    variableExamples: Array.isArray(body.variableExamples)
      ? (body.variableExamples as unknown[]).map(String)
      : [],
    addSecurityRecommendation: !!body.addSecurityRecommendation,
    codeExpirationMinutes: Number(body.codeExpirationMinutes || 0),
    otpButtonText: body.otpButtonText ? String(body.otpButtonText) : "",
  });
  if (!built.ok) return resp(400, { error: built.error });

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
    await updateTemplate(resolved.route, metaTemplateId, category, built.components);
    // El estado pasa a PENDING (re-revisión de Meta).
    return resp(200, { ok: true, status: "PENDING" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("update-whatsapp-template error", err);
    return resp(500, { error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
