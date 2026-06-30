import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  ListWhatsAppFlowsCommand,
  ListLinkedWhatsAppBusinessAccountsCommand,
} from "@aws-sdk/client-socialmessaging";
import { resolveWhatsAppWaba } from "../_shared/tenantConnect";

/**
 * list-whatsapp-flows — lista los WhatsApp Flows (formularios nativos de Meta) de
 * la WABA del TENANT, para poder elegir uno al agregar un botón FLOW a una
 * plantilla. BYO: la WABA sale del JWT (resolveWhatsAppWaba), igual que list-templates.
 *
 * Devuelve { flows: [{ id, name, status, categories }] }. Si no hay flows → [].
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const { client, wabaId: WABA_ID } = await resolveWhatsAppWaba(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID
  );
  if (!WABA_ID) {
    return resp(200, { flows: [], note: "WhatsApp no configurado para esta organización." });
  }
  let wabaForApi = WABA_ID;
  if (!/^waba-/.test(WABA_ID) && !/^arn:/.test(WABA_ID)) {
    try {
      const linked = await client.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
      const match = (linked.linkedAccounts || []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => a.wabaId === WABA_ID || a.id === WABA_ID
      );
      if (match?.id) wabaForApi = match.id;
      else if (match?.arn) wabaForApi = match.arn;
    } catch {
      /* seguimos con el original */
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = await client.send(new ListWhatsAppFlowsCommand({ id: wabaForApi }));
    const raw = out.flows || out.Flows || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flows = (raw as any[]).map((f) => ({
      id: f.id || f.flowId || f.metaFlowId,
      name: f.name || f.flowName,
      status: f.status || f.flowStatus,
      categories: f.categories,
    }));
    return resp(200, { flows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-whatsapp-flows error", err);
    return resp(500, { error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
