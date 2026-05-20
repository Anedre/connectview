import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  ListWhatsAppMessageTemplatesCommand,
  GetWhatsAppMessageTemplateCommand,
} from "@aws-sdk/client-socialmessaging";

/**
 * list-whatsapp-templates — lists Meta-approved WhatsApp templates
 * the campaign wizard can choose from. For each template we also
 * pull the body text + variable placeholders so the UI knows how
 * many parameters the agent needs to map from the CSV.
 *
 * Filters out PENDING / REJECTED templates by default — the wizard
 * only renders APPROVED ones the manager can actually send.
 */
const client = new SocialMessagingClient({});
const WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";

const CORS: Record<string, string> = {
  "Content-Type": "application/json",
};

interface TemplateButton {
  type: string; // QUICK_REPLY · URL · PHONE_NUMBER · COPY_CODE
  text: string;
  url?: string;
  phoneNumber?: string;
}

interface TemplateBrief {
  name: string;
  metaTemplateId?: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  footerText?: string;
  buttons?: TemplateButton[];
}

function extractBody(definition: unknown): {
  bodyText?: string;
  variableCount: number;
  headerText?: string;
  footerText?: string;
  buttons?: TemplateButton[];
} {
  if (!definition || typeof definition !== "object") {
    return { variableCount: 0 };
  }
  const def = definition as { components?: Array<Record<string, unknown>> };
  let bodyText: string | undefined;
  let headerText: string | undefined;
  let footerText: string | undefined;
  let buttons: TemplateButton[] | undefined;
  for (const c of def.components || []) {
    const t = String(c.type || "").toUpperCase();
    const txt = typeof c.text === "string" ? c.text : undefined;
    if (t === "BODY") bodyText = txt;
    if (t === "HEADER") headerText = txt;
    if (t === "FOOTER") footerText = txt;
    if (t === "BUTTONS" && Array.isArray(c.buttons)) {
      buttons = (c.buttons as Array<Record<string, unknown>>).map((b) => ({
        type: String(b.type || ""),
        text: String(b.text || ""),
        url: typeof b.url === "string" ? b.url : undefined,
        phoneNumber:
          typeof b.phone_number === "string"
            ? b.phone_number
            : typeof b.phoneNumber === "string"
            ? b.phoneNumber
            : undefined,
      }));
    }
  }
  // Count {{N}} placeholders in the body — that's how many CSV cols
  // the manager has to map when configuring the campaign.
  const variableCount = bodyText
    ? Array.from(bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).reduce(
        (max, m) => Math.max(max, Number(m[1] || 0)),
        0
      )
    : 0;
  return { bodyText, variableCount, headerText, footerText, buttons };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const includeAll =
    event?.queryStringParameters?.includeAll === "true" ||
    event?.queryStringParameters?.includeAll === "1";

  try {
    const res = await client.send(
      new ListWhatsAppMessageTemplatesCommand({ id: WABA_ID })
    );

    // For each template, fetch full definition so we get body + vars.
    // The list response only returns the metadata, not the components.
    const templates: TemplateBrief[] = [];
    for (const t of res.templates ?? []) {
      const status = t.templateStatus || "UNKNOWN";
      if (!includeAll && status !== "APPROVED") continue;
      try {
        const details = await client.send(
          new GetWhatsAppMessageTemplateCommand({
            id: WABA_ID,
            metaTemplateId: t.metaTemplateId,
          })
        );
        // The Lambda runtime gives us templateDefinition as Uint8Array;
        // decode it to JSON for the body / variable inspection.
        let definition: unknown = undefined;
        if (details.template) {
          try {
            const raw =
              typeof details.template === "string"
                ? details.template
                : new TextDecoder().decode(details.template as Uint8Array);
            definition = JSON.parse(raw);
          } catch {
            definition = undefined;
          }
        }
        const body = extractBody(definition);
        templates.push({
          name: (definition as { name?: string })?.name || t.metaTemplateId,
          metaTemplateId: t.metaTemplateId,
          language: (definition as { language?: string })?.language,
          category: t.category,
          status,
          ...body,
        });
      } catch (innerErr) {
        // Couldn't load this one — return the bare metadata so the
        // wizard still sees it.
        templates.push({
          name: t.metaTemplateId || "",
          metaTemplateId: t.metaTemplateId,
          category: t.category,
          status,
        });
        console.warn("Get template failed:", innerErr);
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ templates, wabaId: WABA_ID }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-whatsapp-templates error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
