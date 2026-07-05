/**
 * whatsappTemplatesApi — operaciones de plantillas (HSM) de WhatsApp en LOS DOS
 * modos del tenant, con una sola interfaz. Cierra la brecha en la que todo el
 * CRUD de plantillas hablaba SOLO con AWS End User Messaging (SocialMessaging) e
 * ignoraba `mode="meta"` (número standalone en la Graph API de Meta) → para un
 * número de Meta, AWS no conoce la WABA y las plantillas nunca cargaban.
 *
 *   • "aws"  → AWS End User Messaging Social (SocialMessagingClient). El wabaId
 *              crudo de Meta se mapea al id de AWS (waba-…) vía las cuentas
 *              vinculadas, igual que antes.
 *   • "meta" → Graph API directa (graph.facebook.com/{wabaId}/message_templates)
 *              con el token del tenant (Secrets Manager, NUNCA en el cliente).
 *
 * El formato de `components` es idéntico en ambos caminos (lo arma
 * buildTemplateComponents): AWS solo envuelve el mismo JSON de Meta. Por eso el
 * mismo builder sirve para los dos transportes.
 *
 * Lo bundlean los handlers hand-managed list/create/update/delete-whatsapp-template
 * y upload-whatsapp-template-media. 🔑 al tocarlo, re-desplegar esos Lambdas.
 */
import {
  SocialMessagingClient,
  ListWhatsAppMessageTemplatesCommand,
  GetWhatsAppMessageTemplateCommand,
  CreateWhatsAppMessageTemplateCommand,
  UpdateWhatsAppMessageTemplateCommand,
  DeleteWhatsAppMessageTemplateCommand,
  ListLinkedWhatsAppBusinessAccountsCommand,
  ListWhatsAppFlowsCommand,
} from "@aws-sdk/client-socialmessaging";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { WhatsAppAccount } from "./tenantConnect";

export const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

/** Access token de la Graph API del tenant (secret connectview/tenant/<id>/whatsapp).
 *  numberTokens[phoneNumberId] gana; luego el token legacy singular; luego el
 *  primer numberToken. Cache por vida del contenedor. Mismo secret que usa el
 *  envío (whatsappSend) y la salud (get-whatsapp-health). */
const secretsClient = new SecretsManagerClient({});
const waTokenCache = new Map<string, string>();
export async function getTenantWaToken(
  tenantId: string,
  metaPhoneNumberId?: string,
): Promise<string | null> {
  if (!tenantId) return null;
  const cacheKey = `${tenantId}::${metaPhoneNumberId || ""}`;
  const hit = waTokenCache.get(cacheKey);
  if (hit) return hit;
  try {
    const r = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const raw = r.SecretString || "{}";
    let token: string | undefined;
    try {
      const j = JSON.parse(raw) as { token?: string; numberTokens?: Record<string, string> };
      token =
        (metaPhoneNumberId && j.numberTokens?.[metaPhoneNumberId]) ||
        j.token ||
        (j.numberTokens ? Object.values(j.numberTokens)[0] : undefined);
    } catch {
      token = raw.trim() || undefined; // secret en texto plano
    }
    if (token) {
      waTokenCache.set(cacheKey, token);
      return token;
    }
  } catch {
    /* sin secret / sin token */
  }
  return null;
}

/** Ruta de una operación de plantillas: modo + credencial resuelta. */
export interface TemplateRoute {
  mode: "aws" | "meta";
  /** wabaId CRUDO de Meta (ambos modos lo tienen en la config). */
  wabaId: string;
  /** mode=aws: cliente SocialMessaging del tenant. */
  client?: SocialMessagingClient;
  /** mode=meta: access token de la Graph API del tenant. */
  token?: string | null;
  tenantId?: string;
}

export interface TemplateButton {
  type: string;
  text: string;
  url?: string;
  phoneNumber?: string;
}
export interface TemplateBrief {
  name: string;
  metaTemplateId?: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  headerFormat?: string;
  footerText?: string;
  buttons?: TemplateButton[];
  cards?: { bodyText?: string; headerFormat?: string; buttons?: TemplateButton[] }[];
}

/** Parsea el array `components` (formato Meta, igual en AWS y Graph) a un brief
 *  con body/vars/header/footer/botones/carousel. */
export function extractBody(
  definition: unknown,
): Omit<TemplateBrief, "name" | "metaTemplateId" | "language" | "category" | "status"> {
  if (!definition || typeof definition !== "object") return { variableCount: 0 };
  const def = definition as { components?: Array<Record<string, unknown>> };
  let bodyText: string | undefined;
  let headerText: string | undefined;
  let headerFormat: string | undefined;
  let footerText: string | undefined;
  let buttons: TemplateButton[] | undefined;
  let cards: { bodyText?: string; headerFormat?: string; buttons?: TemplateButton[] }[] | undefined;
  const parseButtons = (arr: unknown): TemplateButton[] =>
    (Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : []).map((b) => ({
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
  for (const c of def.components || []) {
    const t = String(c.type || "").toUpperCase();
    const txt = typeof c.text === "string" ? c.text : undefined;
    if (t === "BODY") bodyText = txt;
    if (t === "HEADER") {
      headerText = txt;
      headerFormat = typeof c.format === "string" ? c.format : undefined;
    }
    if (t === "FOOTER") footerText = txt;
    if (t === "BUTTONS" && Array.isArray(c.buttons)) buttons = parseButtons(c.buttons);
    if (t === "CAROUSEL" && Array.isArray(c.cards)) {
      cards = (c.cards as Array<{ components?: Array<Record<string, unknown>> }>).map((card) => {
        let cb: string | undefined;
        let cf: string | undefined;
        let cbtn: TemplateButton[] | undefined;
        for (const cc of card.components || []) {
          const ct = String(cc.type || "").toUpperCase();
          if (ct === "BODY") cb = typeof cc.text === "string" ? cc.text : undefined;
          if (ct === "HEADER") cf = typeof cc.format === "string" ? cc.format : undefined;
          if (ct === "BUTTONS") cbtn = parseButtons(cc.buttons);
        }
        return { bodyText: cb, headerFormat: cf, buttons: cbtn };
      });
    }
  }
  const variableCount = bodyText
    ? Array.from(bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).reduce(
        (max, m) => Math.max(max, Number(m[1] || 0)),
        0,
      )
    : 0;
  return { bodyText, variableCount, headerText, headerFormat, footerText, buttons, cards };
}

/** El wabaId guardado suele ser el ID crudo de Meta; la API de AWS espera el id
 *  de AWS (waba-…) o el ARN. Lo mapea vía las cuentas vinculadas. mode=meta usa
 *  el crudo tal cual (es lo que la Graph API espera). */
export async function awsWabaFor(client: SocialMessagingClient, wabaId: string): Promise<string> {
  if (/^waba-/.test(wabaId) || /^arn:/.test(wabaId)) return wabaId;
  try {
    const linked = await client.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
    const match = (linked.linkedAccounts || []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => a.wabaId === wabaId || a.id === wabaId,
    );
    if (match?.id) return match.id;
    if (match?.arn) return match.arn;
  } catch {
    /* el error posterior de la API será claro */
  }
  return wabaId;
}

/** Fetch a la Graph API con el token del tenant. Lanza con el mensaje de Meta. */
async function graph(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(init?.query || {}).toString();
  const url = `${GRAPH}/${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  // SEGURIDAD: nunca loguear el token; solo el error de Meta.
  if (!r.ok) throw new Error(j?.error?.message || `Graph ${r.status}`);
  return j;
}

/** Lista las plantillas de una WABA (aprobadas, o todas con includeAll). */
export async function listTemplates(
  route: TemplateRoute,
  includeAll: boolean,
): Promise<TemplateBrief[]> {
  if (route.mode === "meta") {
    if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    const out: TemplateBrief[] = [];
    // Graph devuelve components inline → no hay que pedir cada plantilla aparte.
    let after: string | undefined;
    do {
      const page = await graph(`${route.wabaId}/message_templates`, route.token, {
        query: {
          fields: "name,status,category,language,components,id",
          limit: "100",
          ...(after ? { after } : {}),
        },
      });
      const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
      for (const t of data) {
        const status = String(t.status || "UNKNOWN").toUpperCase();
        if (!includeAll && status !== "APPROVED") continue;
        out.push({
          name: String(t.name || t.id || ""),
          metaTemplateId: t.id != null ? String(t.id) : undefined,
          language: typeof t.language === "string" ? t.language : undefined,
          category: typeof t.category === "string" ? t.category : undefined,
          status,
          ...extractBody(t),
        });
      }
      const paging = (page.paging as { cursors?: { after?: string }; next?: string }) || {};
      after = paging.next ? paging.cursors?.after : undefined;
    } while (after);
    return out;
  }

  // mode=aws
  if (!route.client) throw new Error("WhatsApp (AWS): cliente no resuelto");
  const wabaForApi = await awsWabaFor(route.client, route.wabaId);
  const res = await route.client.send(new ListWhatsAppMessageTemplatesCommand({ id: wabaForApi }));
  const out: TemplateBrief[] = [];
  for (const t of res.templates ?? []) {
    const status = t.templateStatus || "UNKNOWN";
    if (!includeAll && status !== "APPROVED") continue;
    try {
      const details = await route.client.send(
        new GetWhatsAppMessageTemplateCommand({ id: wabaForApi, metaTemplateId: t.metaTemplateId }),
      );
      let definition: unknown;
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
      out.push({
        name: (definition as { name?: string })?.name || t.metaTemplateId || "",
        metaTemplateId: t.metaTemplateId,
        language: (definition as { language?: string })?.language,
        category: (definition as { category?: string })?.category,
        status,
        ...extractBody(definition),
      });
    } catch {
      out.push({
        name: t.metaTemplateId || "",
        metaTemplateId: t.metaTemplateId,
        status,
      });
    }
  }
  return out;
}

/** Crea una plantilla (queda PENDING en Meta). `components` = salida de buildTemplateComponents. */
export async function createTemplate(
  route: TemplateRoute,
  def: { name: string; language: string; category: string; components: unknown[] },
): Promise<{ metaTemplateId?: string; status?: string; category?: string }> {
  if (route.mode === "meta") {
    if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    const j = await graph(`${route.wabaId}/message_templates`, route.token, {
      method: "POST",
      body: {
        name: def.name,
        language: def.language,
        category: def.category,
        components: def.components,
      },
    });
    return {
      metaTemplateId: j.id != null ? String(j.id) : undefined,
      status: typeof j.status === "string" ? j.status : "PENDING",
      category: typeof j.category === "string" ? j.category : def.category,
    };
  }
  if (!route.client) throw new Error("WhatsApp (AWS): cliente no resuelto");
  const wabaForApi = await awsWabaFor(route.client, route.wabaId);
  const res = await route.client.send(
    new CreateWhatsAppMessageTemplateCommand({
      id: wabaForApi,
      templateDefinition: new TextEncoder().encode(JSON.stringify(def)),
    }),
  );
  return {
    metaTemplateId: res.metaTemplateId,
    status: res.templateStatus,
    category: res.category,
  };
}

/** Edita una plantilla existente (por metaTemplateId). Vuelve a PENDING. */
export async function updateTemplate(
  route: TemplateRoute,
  metaTemplateId: string,
  category: string,
  components: unknown[],
): Promise<void> {
  if (route.mode === "meta") {
    if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    // Graph edita por ID del template: POST /{template-id} { category, components }.
    await graph(String(metaTemplateId), route.token, {
      method: "POST",
      body: { category, components },
    });
    return;
  }
  if (!route.client) throw new Error("WhatsApp (AWS): cliente no resuelto");
  const wabaForApi = await awsWabaFor(route.client, route.wabaId);
  await route.client.send(
    new UpdateWhatsAppMessageTemplateCommand({
      id: wabaForApi,
      metaTemplateId,
      templateCategory: category,
      templateComponents: new TextEncoder().encode(JSON.stringify(components)),
    }),
  );
}

/** Borra una plantilla por nombre (con metaTemplateId, solo esa versión de idioma). */
export async function deleteTemplate(
  route: TemplateRoute,
  templateName: string,
  metaTemplateId?: string,
): Promise<void> {
  if (route.mode === "meta") {
    if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    // Graph: DELETE /{wabaId}/message_templates?name=…(&hsm_id=… para 1 versión).
    await graph(`${route.wabaId}/message_templates`, route.token, {
      method: "DELETE",
      query: { name: templateName, ...(metaTemplateId ? { hsm_id: metaTemplateId } : {}) },
    });
    return;
  }
  if (!route.client) throw new Error("WhatsApp (AWS): cliente no resuelto");
  const wabaForApi = await awsWabaFor(route.client, route.wabaId);
  await route.client.send(
    new DeleteWhatsAppMessageTemplateCommand({
      id: wabaForApi,
      templateName,
      ...(metaTemplateId ? { metaTemplateId } : {}),
    }),
  );
}

/**
 * Sube un archivo como encabezado multimedia y devuelve el `header_handle` que
 * Meta exige en `example.header_handle` — SOLO para mode="meta" (Resumable
 * Upload API). El app_id sale del token (debug_token). El camino AWS (S3 +
 * CreateWhatsAppMessageTemplateMedia) se queda en el handler porque necesita el
 * bucket de staging.
 */
export async function uploadTemplateMediaMeta(
  route: TemplateRoute,
  file: { buffer: Buffer; contentType: string; fileName: string },
): Promise<string> {
  if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
  const token = route.token;
  // app_id del token (necesario para /{app-id}/uploads).
  const appId = process.env.META_APP_ID || (await appIdFromToken(token));
  if (!appId) {
    throw new Error(
      "WhatsApp (Meta): no se pudo resolver el app_id para subir el encabezado. Configurá META_APP_ID.",
    );
  }
  // 1) Abrir la sesión de subida.
  const session = await graph(`${appId}/uploads`, token, {
    method: "POST",
    query: {
      file_name: file.fileName,
      file_length: String(file.buffer.length),
      file_type: file.contentType,
    },
  });
  const sessionId = String(session.id || "");
  if (!sessionId) throw new Error("WhatsApp (Meta): la sesión de subida no devolvió id");
  // 2) Subir los bytes (auth OAuth + file_offset). Devuelve { h }.
  const r = await fetch(`${GRAPH}/${sessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: "0",
      "Content-Type": file.contentType,
    },
    body: file.buffer,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.h) throw new Error(j?.error?.message || `Upload ${r.status}`);
  return String(j.h);
}

/**
 * Arma el route (modo + credencial) para operar sobre UNA cuenta del tenant.
 * Valida que la cuenta pertenezca al tenant (accountKey debe estar en `accounts`,
 * que ya viene scope-ado por tenant) — así un `?account=` ajeno NO opera sobre
 * una WABA de otro. Sin accountKey usa la cuenta activa. null si no hay cuentas.
 */
export async function routeForAccount(
  accounts: WhatsAppAccount[],
  client: SocialMessagingClient,
  tenantId: string,
  accountKey?: string,
): Promise<{ route: TemplateRoute; account: WhatsAppAccount } | null> {
  if (accounts.length === 0) return null;
  const account =
    (accountKey ? accounts.find((a) => a.key === accountKey) : undefined) ||
    accounts.find((a) => a.active) ||
    accounts[0];
  if (!account) return null;
  if (account.mode === "meta") {
    const token = await getTenantWaToken(tenantId);
    return { route: { mode: "meta", wabaId: account.wabaId, token, tenantId }, account };
  }
  return { route: { mode: "aws", wabaId: account.wabaId, client, tenantId }, account };
}

export interface FlowBrief {
  id?: string;
  name?: string;
  status?: string;
  categories?: unknown;
}

/** Lista los WhatsApp Flows (formularios nativos) de una WABA, dual-mode. */
export async function listFlows(route: TemplateRoute): Promise<FlowBrief[]> {
  if (route.mode === "meta") {
    if (!route.token) throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    const page = await graph(`${route.wabaId}/flows`, route.token, {
      query: { fields: "id,name,status,categories", limit: "200" },
    });
    const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
    return data.map((f) => ({
      id: f.id != null ? String(f.id) : undefined,
      name: typeof f.name === "string" ? f.name : undefined,
      status: typeof f.status === "string" ? f.status : undefined,
      categories: f.categories,
    }));
  }
  if (!route.client) throw new Error("WhatsApp (AWS): cliente no resuelto");
  // ListWhatsAppFlows no está en todas las versiones del SDK del runtime de
  // Lambda (AWS End User Messaging Social) → sin él, [] en vez de crashear.
  if (typeof ListWhatsAppFlowsCommand !== "function") return [];
  const wabaForApi = await awsWabaFor(route.client, route.wabaId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await route.client.send(new ListWhatsAppFlowsCommand({ id: wabaForApi }));
  const raw = out.flows || out.Flows || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (raw as any[]).map((f) => ({
    id: f.id || f.flowId || f.metaFlowId,
    name: f.name || f.flowName,
    status: f.status || f.flowStatus,
    categories: f.categories,
  }));
}

/** app_id asociado a un token, vía debug_token. Cache por vida del contenedor. */
const appIdCache = new Map<string, string>();
async function appIdFromToken(token: string): Promise<string | null> {
  const hit = appIdCache.get(token);
  if (hit) return hit;
  try {
    const j = await graph("debug_token", token, { query: { input_token: token } });
    const appId = (j.data as { app_id?: string })?.app_id;
    if (appId) {
      appIdCache.set(token, appId);
      return appId;
    }
  } catch {
    /* sin app_id */
  }
  return null;
}
