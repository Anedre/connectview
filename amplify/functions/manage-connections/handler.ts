/**
 * manage-connections — config de integraciones por organización (tenant) del SaaS.
 *
 * GET  ?tenantId=<id>           → { config }   (config NO sensible del tenant)
 * POST { config, whatsappSecret? } → upsert config; el token de WhatsApp va a
 *                                    Secrets Manager (NUNCA a DynamoDB).
 *
 * Sin Cognito todavía, el tenant por defecto es "default". Cuando exista el
 * login multi-tenant, el tenantId saldrá del token del usuario.
 *
 * Requiere que el rol tenga (policy a aplicar por separado):
 *   - dynamodb CRUD sobre connectview-connections
 *   - secretsmanager Create/Put/GetSecretValue sobre connectview/tenant/*
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  SocialMessagingClient,
  ListLinkedWhatsAppBusinessAccountsCommand,
  GetLinkedWhatsAppBusinessAccountCommand,
} from "@aws-sdk/client-socialmessaging";
import { getIdentity } from "../_shared/cognitoAuth";
import { getTenantConnect } from "../_shared/tenantConnect";
import { provisionSfInboundToken } from "../_shared/sfInboundToken";
import {
  readMetaSecret,
  writeMetaSecret,
  normalizeMetaAccounts,
  type MetaAccount,
  type MetaConfig,
} from "../_shared/metaAccounts";
import {
  normalizeWaNumbers,
  waNumberKey,
  readWaSecret,
  writeWaSecret,
  type WhatsAppNumber as WaNumber,
  type WhatsAppConfig,
} from "../_shared/whatsappNumbers";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const ddb = new DynamoDBClient({ region: REGION });
const sm = new SecretsManagerClient({ region: REGION });
const social = new SocialMessagingClient({ region: REGION });

interface WhatsAppNumber {
  displayPhoneNumber?: string;
  displayName?: string;
  metaPhoneNumberId?: string;
  phoneNumberId?: string;
  phoneNumberArn?: string;
  wabaId?: string;
  wabaName?: string;
  qualityRating?: string;
}

/** Detecta los números de WhatsApp vinculados en AWS End User Messaging Social
 *  (los que tu Amazon Connect usa para WhatsApp NATIVO: entran como contacto y
 *  los atiende un agente). Read-only; si no hay permiso o no hay números → []. */
async function detectWhatsAppNumbers(client: SocialMessagingClient): Promise<WhatsAppNumber[]> {
  try {
    const accts = await client.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
    const out: WhatsAppNumber[] = [];
    for (const a of accts.linkedAccounts || []) {
      if (!a.id) continue;
      try {
        const det = await client.send(new GetLinkedWhatsAppBusinessAccountCommand({ id: a.id }));
        for (const p of det.account?.phoneNumbers || []) {
          out.push({
            displayPhoneNumber: p.displayPhoneNumber,
            displayName: p.displayPhoneNumberName,
            metaPhoneNumberId: p.metaPhoneNumberId,
            phoneNumberId: p.phoneNumberId,
            phoneNumberArn: p.arn,
            wabaId: a.wabaId,
            wabaName: a.wabaName,
            qualityRating: p.qualityRating,
          });
        }
      } catch {
        /* salteamos esta WABA */
      }
    }
    return out;
  } catch {
    return [];
  }
}

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function putWhatsAppSecret(tenantId: string, token: string): Promise<void> {
  const name = `connectview/tenant/${tenantId}/whatsapp`;
  const SecretString = JSON.stringify({ token });
  try {
    await sm.send(new CreateSecretCommand({ Name: name, SecretString }));
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceExistsException") {
      await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString }));
    } else {
      throw e;
    }
  }
}

/** Guarda (merge) el secreto de correo del tenant en Secrets Manager. Merge para
 *  que cambiar el proveedor/remitente no borre la contraseña ya guardada. */
async function putEmailSecret(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  const name = `connectview/email/${tenantId}`;
  let existing: Record<string, unknown> = {};
  try {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: name }));
    if (r.SecretString) existing = JSON.parse(r.SecretString);
  } catch {
    /* aún no existe → se crea */
  }
  const SecretString = JSON.stringify({ ...existing, ...patch });
  try {
    await sm.send(new CreateSecretCommand({ Name: name, SecretString }));
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceExistsException") {
      await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString }));
    } else {
      throw e;
    }
  }
}

/** Lee el configJson guardado del tenant (para acciones aisladas que mergean un
 *  solo bloque sin recibir el config completo del body). {} si no hay. */
async function readStoredConfig(tenantId: string): Promise<Record<string, unknown>> {
  try {
    const r = await ddb.send(
      new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (r.Item?.configJson?.S) return JSON.parse(r.Item.configJson.S);
  } catch {
    /* sin config previa → {} */
  }
  return {};
}
async function writeStoredConfig(tenantId: string, config: Record<string, unknown>): Promise<void> {
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        tenantId: { S: tenantId },
        configJson: { S: JSON.stringify(config) },
        updatedAt: { S: new Date().toISOString() },
      },
    }),
  );
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return resp(200, {});

  // SEGURIDAD (auditoría): este endpoint maneja config sensible del tenant
  // (roleArn + externalId del rol cross-account, instanceArn). Reglas:
  //  1. EXIGIR token válido — sin fail-open a "default". Un request anónimo
  //     NO debe poder leer/escribir config de ningún tenant.
  //  2. El tenantId SALE SIEMPRE del JWT verificado, NUNCA de un query param.
  //     Antes había `?tenantId=` override → IDOR (cualquiera leía la config
  //     de otro tenant pasando su id). Eliminado.
  //  3. ESCRITURA (POST) = solo Admins configuran integraciones. LECTURA (GET) =
  //     cualquier MIEMBRO autenticado del tenant. Antes el GET también exigía
  //     Admin → un agente/supervisor invitado recibía 403 al leer la config,
  //     el front no veía `connect.instanceUrl` y la app le mostraba el
  //     onboarding "Falta conectar tu Amazon Connect" AUNQUE el admin ya lo
  //     había configurado. A los no-admins se les devuelve una vista SANEADA
  //     (sin roleArn/externalId/instanceArn) más abajo — lo operacional que el
  //     runtime necesita (instanceUrl del softphone, branding, mensajería).
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!identity || !identity.tenantId) {
    return resp(401, { error: "No autorizado" });
  }
  const isAdmin = identity.groups.includes("Admins");
  if (method !== "GET" && !isAdmin) {
    return resp(403, { error: "Solo administradores pueden configurar integraciones" });
  }
  const tenantId = identity.tenantId;

  try {
    if (method === "GET") {
      const r = await ddb.send(
        new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } }),
      );
      const json = r.Item?.configJson?.S;
      const config = (json ? JSON.parse(json) : {}) as Record<string, unknown>;
      // Salesforce: el estado "conectado" se deriva de la conexión REAL (igual
      // que getToken() del connector), NO del flag en DynamoDB — un save
      // genérico de config (Connect/WhatsApp) reemplaza todo el configJson y
      // podía pisarlo a false. Dos modos, como el connector:
      //   ① per-tenant OAuth web   → secret connectview/tenant/<id>/salesforce
      //   ② legacy JWT-bearer (Novasys, compartido) → secret connectview/salesforce
      const sfPrev = (config.salesforce as Record<string, unknown>) || {};
      let sfConnected = false;
      try {
        const sec = await sm.send(
          new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/salesforce` }),
        );
        try {
          sfConnected = !!JSON.parse(sec.SecretString || "{}").refreshToken;
        } catch {
          /* tombstone / malformado → no conectado por esta vía */
        }
      } catch (e) {
        // ResourceNotFound = el tenant no hizo su propio OAuth → probamos legacy.
        if (!(e instanceof Error && e.name === "ResourceNotFoundException")) {
          console.error("read tenant SF secret:", e instanceof Error ? e.name : String(e));
        }
      }
      if (!sfConnected) {
        try {
          const master = await sm.send(
            new GetSecretValueCommand({
              SecretId: process.env.SF_SECRET_NAME || "connectview/salesforce",
            }),
          );
          try {
            const p = JSON.parse(master.SecretString || "{}");
            // Conexión legacy operativa si están las credenciales JWT-bearer.
            sfConnected = !!(p.consumerKey && p.username && p.privateKey);
          } catch {
            /* secret malformado */
          }
        } catch {
          /* sin secret master → no conectado */
        }
      }
      config.salesforce = { ...sfPrev, connected: sfConnected };

      // No-admins (agentes/supervisores invitados): vista operacional SANEADA.
      // Quitamos la config de INFRAESTRUCTURA sensible del rol cross-account
      // (roleArn + externalId anti-confused-deputy + instanceArn), que solo el
      // wizard del admin usa, y salteamos la detección de números vinculados
      // (llamadas caras a Social Messaging para el formulario del admin).
      // Devolvemos lo que el runtime SÍ necesita para no caer en el onboarding:
      // instanceUrl del softphone, region, branding, mensajería, flows, ruteo,
      // defaultQueue y los flags de estado (connected/tokenSet).
      if (!isAdmin) {
        const c = config.connect as Record<string, unknown> | undefined;
        if (c) {
          delete c.roleArn;
          delete c.externalId;
          delete c.instanceArn;
        }
        return resp(200, { config, tenantId, whatsappNumbers: [] });
      }

      // Números de WhatsApp ya vinculados a tu Connect (AWS End User Messaging),
      // para ofrecerlos en el formulario sin que el cliente tipee el ID.
      // BYO: un tenant real usa SU cliente socialmessaging (assumed) → detecta
      // los números de SU cuenta; el legacy (Novasys) usa el de la plataforma.
      let waClient = social;
      try {
        const tc = await getTenantConnect(tenantId);
        if (tc?.socialMessaging) waClient = tc.socialMessaging;
      } catch {
        /* fallback al cliente de la plataforma */
      }
      const whatsappNumbers = await detectWhatsAppNumbers(waClient);
      return resp(200, { config, tenantId, whatsappNumbers });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}") as {
        config?: Record<string, unknown>;
        whatsappSecret?: string;
        disconnectSalesforce?: boolean;
        rotateSfInboundToken?: boolean;
        action?: string;
        pageIds?: unknown[];
        pageId?: string;
        number?: Partial<WaNumber>;
        token?: string;
        id?: string;
        botId?: string;
        provider?: Record<string, unknown>;
        emailSecret?: Record<string, unknown>;
      };

      // Guardar la config de correo del tenant: el secreto (si viene) va a Secrets
      // Manager; el configJson solo guarda el proveedor + el flag `secretSet`.
      // Acción aislada — no pisa el resto del config con un body.config parcial.
      if (body.action === "saveEmailConn") {
        const stored = await readStoredConfig(tenantId);
        const hasSecret = !!body.emailSecret && Object.keys(body.emailSecret).length > 0;
        if (hasSecret) await putEmailSecret(tenantId, body.emailSecret!);
        const prevEmail = (stored.email as { secretSet?: boolean } | undefined) || {};
        stored.email = {
          provider: body.provider,
          secretSet: hasSecret ? true : (prevEmail.secretSet ?? false),
        };
        await writeStoredConfig(tenantId, stored);
        return resp(200, { ok: true, email: stored.email });
      }

      // Provisión/ROTACIÓN del token de ENTRADA de Salesforce (SF→Vox). Mina un
      // token NUEVO per-tenant, lo guarda en Secrets Manager y devuelve el
      // PLAINTEXT UNA sola vez (el admin lo pega en el Custom Header x-vox-token
      // del Flow de SF). Acción aislada: NO pisa el resto del configJson con un
      // body.config parcial — sólo mergea el flag `inboundTokenSet`. Ver
      // sfInboundToken. El tenantId sale del JWT (arriba), nunca del body.
      if (body.rotateSfInboundToken) {
        let inboundToken: string;
        try {
          inboundToken = await provisionSfInboundToken(tenantId);
        } catch (e) {
          return resp(400, {
            error: e instanceof Error ? e.message : "No se pudo generar el token",
          });
        }
        // Mergear el flag en el config GUARDADO (sin clobber).
        let stored: Record<string, unknown> = {};
        try {
          const r = await ddb.send(
            new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } }),
          );
          if (r.Item?.configJson?.S) stored = JSON.parse(r.Item.configJson.S);
        } catch {
          /* sin config previa → arrancamos de {} */
        }
        const sfPrev = (stored.salesforce as Record<string, unknown>) || {};
        stored.salesforce = {
          ...sfPrev,
          inboundTokenSet: true,
          inboundTokenRotatedAt: new Date().toISOString(),
        };
        await ddb.send(
          new PutItemCommand({
            TableName: TABLE,
            Item: {
              tenantId: { S: tenantId },
              configJson: { S: JSON.stringify(stored) },
              updatedAt: { S: new Date().toISOString() },
            },
          }),
        );
        // SEGURIDAD: el plaintext viaja UNA vez en esta respuesta y NUNCA se
        // persiste en DynamoDB (sólo el flag). No loguearlo.
        return resp(200, { ok: true, inboundToken, tenantId });
      }

      // ── Meta multi-cuenta (Instagram/Messenger/Facebook · auto-servicio) ──
      // Acciones AISLADAS (no dependen de body.config): mergean SOLO el bloque
      // meta para no pisar el resto del configJson. Los page tokens viven en el
      // secret connectview/tenant/<id>/meta, NUNCA en DynamoDB ni en el navegador.

      // listMetaAccounts → cuentas ya conectadas + páginas pendientes de elección
      // (del último "Conectar con Facebook"). Ambas SIN tokens.
      if (body.action === "listMetaAccounts") {
        const stored = await readStoredConfig(tenantId);
        const meta = (stored.meta as MetaConfig) || {};
        let pending: {
          pageId: string;
          pageName?: string;
          igId?: string;
          igUsername?: string;
        }[] = [];
        try {
          const secret = await readMetaSecret(sm, tenantId);
          pending = (secret.pending?.pages || []).map((p) => ({
            pageId: p.pageId,
            pageName: p.pageName,
            igId: p.igId,
            igUsername: p.igUsername,
          }));
        } catch (e) {
          console.error("readMetaSecret (list):", e instanceof Error ? e.name : String(e));
        }
        return resp(200, { accounts: normalizeMetaAccounts(meta), pending, tenantId });
      }

      // saveMetaAccounts → el usuario eligió qué páginas traer (pageIds del
      // pending). Movemos sus page tokens a definitivos y agregamos su metadata a
      // config.meta.accounts (upsert por pageId). Limpia el pending del secret.
      if (body.action === "saveMetaAccounts") {
        const pageIds = Array.isArray(body.pageIds) ? body.pageIds.map((x) => String(x)) : [];
        if (!pageIds.length) return resp(400, { error: "pageIds requerido" });
        const secret = await readMetaSecret(sm, tenantId);
        const pendingPages = secret.pending?.pages || [];
        const chosen = pendingPages.filter((p) => pageIds.includes(p.pageId));
        if (!chosen.length)
          return resp(400, { error: "ninguna de las páginas elegidas está pendiente" });
        // Mover los page tokens elegidos a definitivos + limpiar el pending.
        secret.pageTokens = { ...(secret.pageTokens || {}) };
        for (const p of chosen) secret.pageTokens[p.pageId] = p.pageToken;
        secret.pending = undefined;
        await writeMetaSecret(sm, tenantId, secret);
        // Mergear la metadata (sin tokens) en config.meta.accounts.
        const stored = await readStoredConfig(tenantId);
        const meta = (stored.meta as MetaConfig) || {};
        const now = new Date().toISOString();
        const existing: MetaAccount[] = Array.isArray(meta.accounts) ? [...meta.accounts] : [];
        for (const p of chosen) {
          const acc: MetaAccount = {
            id: p.pageId,
            pageId: p.pageId,
            pageName: p.pageName,
            igId: p.igId,
            igUsername: p.igUsername,
            addedAt: now,
          };
          const idx = existing.findIndex((a) => a.pageId === p.pageId);
          if (idx >= 0) existing[idx] = { ...existing[idx], ...acc };
          else existing.push(acc);
        }
        meta.accounts = existing;
        meta.connectedAt = meta.connectedAt || now;
        stored.meta = meta;
        await writeStoredConfig(tenantId, stored);
        return resp(200, { ok: true, accounts: existing, tenantId });
      }

      // removeMetaAccount → quitar una página conectada (metadata + su page token).
      if (body.action === "removeMetaAccount") {
        const pageId = String(body.pageId || "");
        if (!pageId) return resp(400, { error: "pageId requerido" });
        const stored = await readStoredConfig(tenantId);
        const meta = (stored.meta as MetaConfig) || {};
        meta.accounts = (Array.isArray(meta.accounts) ? meta.accounts : []).filter(
          (a) => a.pageId !== pageId,
        );
        // Si el legacy singular apuntaba a esta página, también lo limpiamos.
        if (meta.pageId === pageId) {
          meta.pageId = undefined;
          meta.igId = undefined;
          meta.pageName = undefined;
        }
        stored.meta = meta;
        await writeStoredConfig(tenantId, stored);
        // Borrar el page token del secret (best-effort).
        try {
          const secret = await readMetaSecret(sm, tenantId);
          if (secret.pageTokens && secret.pageTokens[pageId]) {
            delete secret.pageTokens[pageId];
            await writeMetaSecret(sm, tenantId, secret);
          }
        } catch (e) {
          console.error("removeMetaAccount secret:", e instanceof Error ? e.name : String(e));
        }
        return resp(200, { ok: true, accounts: meta.accounts, tenantId });
      }

      // ── WhatsApp multi-número (Meta Cloud API · varios números por tenant) ──
      // Acciones AISLADAS (mergean SOLO el bloque whatsapp, sin pisar el resto del
      // configJson). El access token de cada número vive en el secret
      // connectview/tenant/<id>/whatsapp (numberTokens[<phoneNumberId>]), NUNCA en
      // DynamoDB ni en el navegador. El ruteo número→flujo es number.botId (se decide
      // en la vista de Ruteo, sección Bots). Retrocompat: normalizeWaNumbers trata el
      // número singular viejo como numbers[0], sin migración manual.

      // listWaNumbers → números registrados (con el legacy singular incluido). Sin tokens.
      if (body.action === "listWaNumbers") {
        const stored = await readStoredConfig(tenantId);
        const wa = (stored.whatsapp as WhatsAppConfig) || {};
        return resp(200, { numbers: normalizeWaNumbers(wa), tenantId });
      }

      // saveWaNumber → alta/edición de UN número (upsert por id = phone_number_id).
      // Si viene `token`, se guarda en el secret (numberTokens[id]) + tokenSet=true.
      if (body.action === "saveWaNumber") {
        const n = (body.number || {}) as Partial<WaNumber>;
        const mode = n.mode === "aws" ? "aws" : "meta";
        const id = String(n.metaPhoneNumberId || n.phoneNumberId || n.id || "").trim();
        if (!id) return resp(400, { error: "phoneNumberId requerido" });
        const stored = await readStoredConfig(tenantId);
        const wa = (stored.whatsapp as WhatsAppConfig) || {};
        const numbers = normalizeWaNumbers(wa); // migra el singular a numbers[] al primer save
        const now = new Date().toISOString();
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (token) {
          const secret = await readWaSecret(sm, tenantId);
          secret.numberTokens = { ...(secret.numberTokens || {}), [id]: token };
          await writeWaSecret(sm, tenantId, secret);
        }
        const idx = numbers.findIndex((x) => waNumberKey(x) === id || x.id === id);
        const prev = idx >= 0 ? numbers[idx] : undefined;
        const merged: WaNumber = {
          id,
          label: (n.label ?? prev?.label)?.toString().trim() || undefined,
          mode,
          metaPhoneNumberId:
            mode === "meta" ? id : (n.metaPhoneNumberId ?? prev?.metaPhoneNumberId),
          phoneNumberId: n.phoneNumberId ?? prev?.phoneNumberId,
          wabaId: (n.wabaId ?? prev?.wabaId)?.toString().trim() || undefined,
          displayNumber: (n.displayNumber ?? prev?.displayNumber)?.toString().trim() || undefined,
          botId: n.botId !== undefined ? n.botId || undefined : prev?.botId,
          tokenSet: token ? true : prev?.tokenSet,
          addedAt: prev?.addedAt || now,
          connectedAt: prev?.connectedAt || now,
        };
        if (idx >= 0) numbers[idx] = merged;
        else numbers.push(merged);
        stored.whatsapp = { ...wa, numbers }; // conserva legacy singular; normalize deduplica
        await writeStoredConfig(tenantId, stored);
        return resp(200, { ok: true, numbers, tenantId });
      }

      // removeWaNumber → quitar un número (metadata + su token del secret).
      if (body.action === "removeWaNumber") {
        const id = String(body.id || body.number?.id || "").trim();
        if (!id) return resp(400, { error: "id requerido" });
        const stored = await readStoredConfig(tenantId);
        const wa = (stored.whatsapp as WhatsAppConfig) || {};
        const numbers = normalizeWaNumbers(wa).filter((x) => waNumberKey(x) !== id && x.id !== id);
        const nextWa: WhatsAppConfig = { ...wa, numbers };
        // Si el legacy singular apuntaba a este número, limpiarlo (si no,
        // normalizeWaNumbers lo re-agregaría en la próxima lectura).
        if ((wa.metaPhoneNumberId || wa.phoneNumberId) === id) {
          nextWa.metaPhoneNumberId = undefined;
          nextWa.phoneNumberId = undefined;
          nextWa.mode = undefined;
          nextWa.botId = undefined;
          nextWa.wabaId = undefined;
          nextWa.tokenSet = undefined;
        }
        stored.whatsapp = nextWa;
        await writeStoredConfig(tenantId, stored);
        try {
          const secret = await readWaSecret(sm, tenantId);
          if (secret.numberTokens && secret.numberTokens[id]) {
            delete secret.numberTokens[id];
            await writeWaSecret(sm, tenantId, secret);
          }
        } catch (e) {
          console.error("removeWaNumber secret:", e instanceof Error ? e.name : String(e));
        }
        return resp(200, { ok: true, numbers, tenantId });
      }

      // setWaNumberBot → anclar (rutear) un número a un flujo/bot. Es la vista de
      // Ruteo: el ruteo vive en el número, no en las credenciales. botId "" = sin flujo.
      if (body.action === "setWaNumberBot") {
        const id = String(body.id || "").trim();
        if (!id) return resp(400, { error: "id requerido" });
        const botId = typeof body.botId === "string" ? body.botId.trim() : "";
        const stored = await readStoredConfig(tenantId);
        const wa = (stored.whatsapp as WhatsAppConfig) || {};
        const numbers = normalizeWaNumbers(wa);
        const idx = numbers.findIndex((x) => waNumberKey(x) === id || x.id === id);
        if (idx < 0) return resp(404, { error: "número no encontrado" });
        numbers[idx] = { ...numbers[idx], botId: botId || undefined };
        const nextWa: WhatsAppConfig = { ...wa, numbers };
        // Alinear el legacy singular si es ese número (para que normalize no lo pise).
        if ((wa.metaPhoneNumberId || wa.phoneNumberId) === id) nextWa.botId = botId || undefined;
        stored.whatsapp = nextWa;
        await writeStoredConfig(tenantId, stored);
        return resp(200, { ok: true, numbers, tenantId });
      }

      const config = (body.config || {}) as Record<string, unknown>;

      // El secreto de WhatsApp va a Secrets Manager; en DynamoDB solo el flag.
      if (body.whatsappSecret) {
        await putWhatsAppSecret(tenantId, body.whatsappSecret);
        const wa = (config.whatsapp as Record<string, unknown>) || {};
        config.whatsapp = { ...wa, tokenSet: true };
      }

      // Desconexión de Salesforce: invalidamos el SECRET del tenant (lo
      // sobrescribimos con un tombstone sin refreshToken). Como el GET deriva el
      // estado del secret, sin esto la desconexión no surtiría efecto en el badge.
      if (body.disconnectSalesforce) {
        try {
          await sm.send(
            new PutSecretValueCommand({
              SecretId: `connectview/tenant/${tenantId}/salesforce`,
              SecretString: JSON.stringify({ disconnected: true }),
            }),
          );
        } catch (e) {
          if (!(e instanceof Error && e.name === "ResourceNotFoundException")) {
            console.error("SF disconnect (tombstone) falló:", e);
          }
        }
        config.salesforce = { connected: false };
      }

      await ddb.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: {
            tenantId: { S: tenantId },
            configJson: { S: JSON.stringify(config) },
            updatedAt: { S: new Date().toISOString() },
          },
        }),
      );
      return resp(200, { ok: true, config, tenantId });
    }

    return resp(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("manage-connections error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
