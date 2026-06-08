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
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
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
        const det = await client.send(
          new GetLinkedWhatsAppBusinessAccountCommand({ id: a.id })
        );
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
  // acá: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
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
  //  3. Solo Admins de la org pueden tocar integraciones.
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!identity || !identity.tenantId) {
    return resp(401, { error: "No autorizado" });
  }
  if (!identity.groups.includes("Admins")) {
    return resp(403, { error: "Solo administradores pueden configurar integraciones" });
  }
  const tenantId = identity.tenantId;

  try {
    if (method === "GET") {
      const r = await ddb.send(
        new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } })
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
          new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/salesforce` })
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
            new GetSecretValueCommand({ SecretId: process.env.SF_SECRET_NAME || "connectview/salesforce" })
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
      };

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
            new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } })
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
          })
        );
        // SEGURIDAD: el plaintext viaja UNA vez en esta respuesta y NUNCA se
        // persiste en DynamoDB (sólo el flag). No loguearlo.
        return resp(200, { ok: true, inboundToken, tenantId });
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
            })
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
        })
      );
      return resp(200, { ok: true, config, tenantId });
    }

    return resp(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("manage-connections error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
