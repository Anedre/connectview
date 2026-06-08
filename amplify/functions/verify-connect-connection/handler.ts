/**
 * verify-connect-connection — verifica que el rol cross-account del cliente
 * sea asumible y que la instancia de Connect responda. Opcionalmente,
 * verifica también que las 14 tablas del BYO Data Plane (#46) existan en la
 * cuenta del cliente (DescribeTable).
 *
 * El wizard de Integraciones lo llama dos veces:
 *   1. Sin checkDataPlane → confirma assume-role + Connect (paso 3 OK).
 *   2. Con checkDataPlane → confirma que el cliente aplicó el CFN del paso 4
 *      y que Vox puede leer/escribir sus tablas.
 *
 * No requiere JWT — el cliente sólo envía las creds necesarias (roleArn,
 * externalId, instanceArn, region) para hacer la verificación.
 */
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  ConnectClient,
  DescribeInstanceCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const sts = new STSClient({});

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // acá: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

interface VerifyBody {
  roleArn?: string;
  externalId?: string;
  instanceArn?: string;
  region?: string;
  /** Si true, además de Connect verifica DescribeTable sobre las 14 tablas. */
  checkDataPlane?: boolean;
}

// Las 14 tablas del template `dataPlaneCfnTemplate`. Mantener en sync.
const DATA_PLANE_TABLES = [
  "connectview-admin-audit",
  "connectview-ai-conversations",
  "connectview-appointments",
  "connectview-bots",
  "connectview-callbacks",
  "connectview-campaign-agents",
  "connectview-campaign-contacts",
  "connectview-campaigns",
  "connectview-catalogs",
  "connectview-contacts",
  "connectview-hsm-sends",
  "connectview-leads",
  "connectview-taxonomies",
  "connectview-wrapup-history",
];

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  body?: string;
}

function instanceIdFromArn(arn: string): string {
  const m = /instance\/([0-9a-f-]+)/i.exec(arn);
  return m ? m[1] : "";
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  let body: VerifyBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return resp(400, { ok: false, error: "JSON inválido" });
  }
  if (!body.roleArn || !body.externalId) {
    return resp(400, { ok: false, error: "roleArn y externalId son obligatorios" });
  }
  if (!body.instanceArn) {
    return resp(400, { ok: false, error: "instanceArn es obligatorio" });
  }
  const region = body.region || "us-east-1";

  // 1) Assume-role.
  let creds;
  try {
    const a = await sts.send(
      new AssumeRoleCommand({
        RoleArn: body.roleArn,
        RoleSessionName: "vox-verify",
        ExternalId: body.externalId,
        DurationSeconds: 900,
      })
    );
    creds = a.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      return resp(502, { ok: false, error: "STS no devolvió credenciales" });
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // STS devuelve "not authorized" tanto cuando el rol no existe como cuando
    // el ExternalId no coincide. Damos un hint legible al cliente.
    const hint = /not authorized|access denied/i.test(raw)
      ? " Verificá que (a) el ARN del rol esté bien copiado, (b) el ExternalId del wizard coincida con el del CFN, y (c) ya aplicaste el template del paso 3."
      : "";
    return resp(502, {
      ok: false,
      error: `Asumir el rol falló.${hint} Detalle: ${raw.slice(0, 200)}`,
    });
  }
  const assumedCreds = {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  };

  // 2) DescribeInstance.
  const instanceId = instanceIdFromArn(body.instanceArn);
  if (!instanceId) {
    return resp(400, { ok: false, error: "instanceArn malformado (no se pudo derivar instanceId)" });
  }
  try {
    const connect = new ConnectClient({ region, credentials: assumedCreds });
    await connect.send(new DescribeInstanceCommand({ InstanceId: instanceId }));
  } catch (e) {
    return resp(502, {
      ok: false,
      error: `DescribeInstance falló (¿la instancia existe?): ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
    });
  }

  // 3) Si checkDataPlane, verificar las 14 tablas.
  if (body.checkDataPlane) {
    const ddb = new DynamoDBClient({ region, credentials: assumedCreds });
    const missing: string[] = [];
    await Promise.all(
      DATA_PLANE_TABLES.map(async (t) => {
        try {
          await ddb.send(new DescribeTableCommand({ TableName: t }));
        } catch {
          missing.push(t);
        }
      })
    );
    if (missing.length > 0) {
      return resp(424, {
        ok: false,
        error: `Faltan ${missing.length} de 14 tablas. Aplicá el CFN del paso 4.`,
        missingTables: missing,
      });
    }
    return resp(200, { ok: true, dataPlaneVerified: true, tables: DATA_PLANE_TABLES.length });
  }

  return resp(200, { ok: true, connectVerified: true });
};
