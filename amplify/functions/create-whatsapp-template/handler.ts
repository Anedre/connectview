import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  CreateWhatsAppMessageTemplateCommand,
  ListLinkedWhatsAppBusinessAccountsCommand,
} from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppWaba } from "../_shared/tenantConnect";
import {
  buildTemplateComponents,
  type ButtonIn,
  type CarouselCardIn,
} from "../_shared/waTemplateComponents";

/**
 * create-whatsapp-template — crea una plantilla en la WABA del TENANT y la envía
 * a aprobación de Meta (queda PENDING hasta que Meta la revise). BYO: la WABA
 * sale del JWT del tenant (resolveWhatsAppWaba), igual que list-whatsapp-templates.
 *
 * Los components (header/body/footer/botones + rama AUTHENTICATION) los arma
 * buildTemplateComponents (compartido con update-whatsapp-template).
 *
 * Body (JSON):
 *   { name, language, category, bodyText?, headerText?, footerText?,
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

  const name = String(body.name || "").trim();
  const language = String(body.language || "es").trim();
  const category = String(body.category || "UTILITY")
    .trim()
    .toUpperCase();

  // El nombre es obligatorio y con el formato que exige Meta.
  if (!/^[a-z0-9_]+$/.test(name)) {
    return resp(400, {
      error: "El nombre debe ser minúsculas, números y guiones bajos (ej. confirmacion_cita).",
    });
  }

  // Validar + construir los components (incl. rama AUTHENTICATION) en un solo lugar.
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
    // Fase 4 · F4.2b — carousel (2-10 tarjetas).
    cards: Array.isArray(body.cards) ? (body.cards as CarouselCardIn[]) : [],
  });
  if (!built.ok) return resp(400, { error: built.error });

  // Resolver la WABA del tenant (BYO).
  const { client, wabaId: WABA_ID } = await resolveWhatsAppWaba(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID,
  );
  if (!WABA_ID) {
    return resp(400, {
      error:
        "WhatsApp no está configurado para esta organización. Cargá tu WABA en Configuración → Integraciones.",
    });
  }
  // El WABA guardado puede ser el ID crudo de Meta; la API de AWS espera el ID
  // de AWS (waba-...) o el ARN. Lo resolvemos vía las cuentas linkeadas.
  let wabaForApi = WABA_ID;
  if (!/^waba-/.test(WABA_ID) && !/^arn:/.test(WABA_ID)) {
    try {
      const linked = await client.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
      const match = (linked.linkedAccounts || []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => a.wabaId === WABA_ID || a.id === WABA_ID,
      );
      if (match?.id) wabaForApi = match.id;
      else if (match?.arn) wabaForApi = match.arn;
    } catch {
      /* si falla, seguimos con el original — el error de Meta será claro */
    }
  }

  const definition = { name, language, category, components: built.components };

  try {
    const res = await client.send(
      new CreateWhatsAppMessageTemplateCommand({
        id: wabaForApi,
        templateDefinition: new TextEncoder().encode(JSON.stringify(definition)),
      }),
    );
    return resp(200, {
      ok: true,
      metaTemplateId: res.metaTemplateId,
      status: res.templateStatus, // normalmente "PENDING"
      category: res.category,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("create-whatsapp-template error", err);
    return resp(500, { error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
