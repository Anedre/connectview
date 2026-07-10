/**
 * create-connect-instance — provisión self-serve de una instancia de Amazon
 * Connect NUEVA (CONNECT_MANAGED) en la cuenta del CLIENTE (BYO), vía un rol
 * cross-account de PROVISIÓN (VoxCrmConnectProvision).
 *
 * Es la Opt 2 del onboarding: el cliente NO tiene Connect → ARIA se lo crea.
 *
 * 3 modos (el frontend orquesta, porque CreateInstance tarda ~1-2 min en quedar
 * ACTIVE y no se puede esperar dentro de un request HTTP):
 *   - mode "create":   CreateInstance(CONNECT_MANAGED) → { instanceId, instanceArn }
 *   - mode "status":   DescribeInstance → { status, alias, instanceUrl }   (poll)
 *   - mode "finalize": AssociateApprovedOrigin(<origen ARIA>) → { ok }      (1 vez, ACTIVE)
 *
 * Auth: el body trae { roleArn, externalId, region } del rol de PROVISIÓN que el
 * cliente creó (CFN connectProvisionCfnTemplate). Se asume con ExternalId, igual
 * que verify-connect-connection / diagnose-connection. NO usa getTenantConnect
 * porque la instancia todavía no existe (no hay instanceArn que resolver).
 *
 * El rol de provisión es MÁS permisivo que el de lectura: connect:CreateInstance
 * arrastra permisos de Directory Service (ds:*) porque cada instancia crea un
 * directorio interno. Es un rol separado y temporal (ver connectProvisionCfnTemplate).
 */
import {
  ConnectClient,
  CreateInstanceCommand,
  DescribeInstanceCommand,
  AssociateApprovedOriginCommand,
} from "@aws-sdk/client-connect";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const sts = new STSClient({});

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin y el browser rechaza con "Failed to fetch".
  "Content-Type": "application/json",
};

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface Body {
  mode?: "create" | "status" | "finalize";
  roleArn?: string;
  externalId?: string;
  region?: string;
  // create
  alias?: string;
  inboundCalls?: boolean;
  outboundCalls?: boolean;
  // status / finalize
  instanceId?: string;
  // finalize
  origin?: string;
}

/** Alias = subdominio de Connect: 2-45, minúsculas/números/guiones, sin guión
 *  al inicio/fin. (https://<alias>.my.connect.aws) */
const ALIAS_RE = /^[a-z0-9](?:[a-z0-9-]{0,43}[a-z0-9])?$/;

async function assumedConnect(b: Body): Promise<ConnectClient> {
  if (!b.roleArn || !b.region) {
    throw new Error("Falta roleArn o region del rol de provisión");
  }
  const a = await sts.send(
    new AssumeRoleCommand({
      RoleArn: b.roleArn,
      RoleSessionName: "vox-provision-connect",
      ExternalId: b.externalId,
      DurationSeconds: 900,
    }),
  );
  const c = a.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("STS no devolvió credenciales");
  }
  return new ConnectClient({
    region: b.region,
    credentials: {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
    },
  });
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  let b: Body;
  try {
    b = JSON.parse(event.body || "{}");
  } catch {
    return resp(400, { error: "Body inválido (se esperaba JSON)" });
  }

  const mode = b.mode || "create";

  let connect: ConnectClient;
  try {
    connect = await assumedConnect(b);
  } catch (e) {
    return resp(400, {
      error: "No pudimos asumir el rol de provisión",
      remediation:
        "Revisa que (1) el stack VoxCrmConnectProvision terminó (CREATE_COMPLETE), " +
        "(2) el ExternalId coincide, y (3) tu cuenta no bloquea roles con confianza externa.",
      message: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  try {
    // ── Modo CREATE: dispara la creación y vuelve enseguida ──────────────────
    if (mode === "create") {
      const alias = (b.alias || "").trim().toLowerCase();
      if (!ALIAS_RE.test(alias)) {
        return resp(400, {
          error:
            "Alias inválido: 2-45 caracteres, solo minúsculas, números y guiones, sin empezar/terminar con guión.",
        });
      }
      const r = await connect.send(
        new CreateInstanceCommand({
          IdentityManagementType: "CONNECT_MANAGED",
          InstanceAlias: alias,
          // Ambos requeridos por la API. Default ON (el cliente puede ajustar
          // después en la consola); si pasa false explícito, lo respetamos.
          InboundCallsEnabled: b.inboundCalls !== false,
          OutboundCallsEnabled: b.outboundCalls !== false,
        }),
      );
      return resp(200, {
        instanceId: r.Id,
        instanceArn: r.Arn,
        alias,
        status: "CREATION_IN_PROGRESS",
      });
    }

    // ── Modo STATUS: el frontend hace polling hasta ACTIVE ───────────────────
    if (mode === "status") {
      if (!b.instanceId) return resp(400, { error: "Falta instanceId" });
      const d = await connect.send(new DescribeInstanceCommand({ InstanceId: b.instanceId }));
      const inst = d.Instance;
      const alias = inst?.InstanceAlias || "";
      return resp(200, {
        status: inst?.InstanceStatus || "UNKNOWN", // CREATION_IN_PROGRESS | ACTIVE | CREATION_FAILED
        statusReason: inst?.StatusReason?.Message,
        alias,
        instanceArn: inst?.Arn,
        instanceUrl: alias ? `https://${alias}.my.connect.aws` : undefined,
      });
    }

    // ── Modo FINALIZE: ya ACTIVE → habilitar el origen del visor (embed CCP) ─
    if (mode === "finalize") {
      if (!b.instanceId || !b.origin) {
        return resp(400, { error: "Falta instanceId u origin" });
      }
      try {
        await connect.send(
          new AssociateApprovedOriginCommand({
            InstanceId: b.instanceId,
            Origin: b.origin,
          }),
        );
      } catch (e) {
        // Si el origen ya estaba asociado, Connect tira DuplicateResourceException:
        // lo tomamos como éxito (idempotente).
        if (!(e instanceof Error) || e.name !== "DuplicateResourceException") throw e;
      }
      return resp(200, { ok: true, originAssociated: b.origin });
    }

    return resp(400, { error: `Modo desconocido: ${mode}` });
  } catch (e) {
    const code = e instanceof Error ? e.name : "UnknownError";
    const msg = e instanceof Error ? e.message : String(e);
    // Errores típicos que el frontend mapea a mensajes amables:
    //   LimitExceededException     → límite de instancias de la cuenta/región (default 2)
    //   DuplicateResourceException → el alias (subdominio) ya está en uso (es global)
    //   AccessDeniedException      → el rol no tiene connect:CreateInstance / ds:*
    return resp(502, { error: code, message: msg.slice(0, 300) });
  }
};
