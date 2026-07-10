/**
 * diagnose-connection — health-check completo de la integración de un tenant.
 *
 * Corre una batería de chequeos READ-ONLY contra el Amazon Connect del cliente
 * (vía el rol cross-account) y devuelve, por cada uno: estado (ok/warn/error),
 * un detalle legible, y la remediación concreta (qué activar + link a su
 * consola) cuando algo falta. Lo consume el panel "Estado de la integración".
 *
 * Auth: JWT de admin del tenant. El tenant se resuelve del token; la config
 * (roleArn/externalId/instanceArn) se lee de connectview-connections. También
 * acepta params directos en el body (roleArn/externalId/instanceArn/region)
 * para diagnosticar ANTES de guardar la config (desde el wizard).
 *
 * Chequeos:
 *   role          — assume-role del rol cross-account
 *   instance      — DescribeInstance
 *   contactLens   — DescribeInstanceAttribute(CONTACT_LENS)
 *   recordings    — ListInstanceStorageConfigs(CALL_RECORDINGS) + nombre bucket
 *   s3Recordings  — acceso S3 real al bucket de grabaciones
 *   customerProfiles — ListIntegrationAssociations(CUSTOMER_PROFILES)
 *   dataPlane     — DescribeTable de las tablas (si dataPlaneEnabled)
 *   cloudformation— (opcional) DescribeStackEvents si el rol lo permite
 */
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  ConnectClient,
  DescribeInstanceCommand,
  DescribeInstanceAttributeCommand,
  ListInstanceStorageConfigsCommand,
  ListIntegrationAssociationsCommand,
} from "@aws-sdk/client-connect";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CustomerProfilesClient, GetDomainCommand } from "@aws-sdk/client-customer-profiles";
import { DynamoDBClient, DescribeTableCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { CloudFormationClient, DescribeStackEventsCommand } from "@aws-sdk/client-cloudformation";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { getIdentity } from "../_shared/cognitoAuth";

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const voxDdb = new DynamoDBClient({});
const sts = new STSClient({});

// Las 14 tablas del Data Plane (mantener en sync con cfnTemplates.ts).
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

// Acciones que el rol DEBE tener con Resource:"*" — justo donde históricamente
// apareció el "drift" (el código usa una acción que la plantilla vieja no
// otorgaba → AccessDenied en silencio). Las acciones scoped por recurso
// (outbound, S3, Bedrock) las cubren los probes funcionales de más abajo, no
// esta simulación. MANTENER EN SYNC con cfnTemplates.ts / connect-role.yaml.
const EXPECTED_STAR_PERMISSIONS: {
  group: string;
  label: string;
  actions: string[];
}[] = [
  {
    group: "directory",
    label: "Usuarios y perfiles de seguridad",
    actions: [
      "connect:ListUsers",
      "connect:DescribeUser",
      "connect:ListQueues",
      "connect:DescribeQueue",
      "connect:DescribeSecurityProfile",
      "connect:ListSecurityProfiles",
      "connect:UpdateUserSecurityProfiles",
    ],
  },
  {
    group: "routing",
    label: "Enrutamiento y números de teléfono",
    actions: [
      "connect:ListRoutingProfiles",
      "connect:ListRoutingProfileQueues",
      "connect:AssociateRoutingProfileQueues",
      "connect:DisassociateRoutingProfileQueues",
      "connect:ListPhoneNumbers",
      "connect:ListPhoneNumbersV2",
    ],
  },
  {
    group: "metrics",
    label: "Métricas e historial de contactos",
    actions: [
      "connect:GetMetricDataV2",
      "connect:GetCurrentMetricData",
      "connect:GetCurrentUserData",
      "connect:SearchContacts",
      "connect:DescribeContact",
      "connect:ListContactReferences",
    ],
  },
  {
    group: "flows",
    label: "Flujos de contacto (bots)",
    actions: [
      "connect:ListContactFlows",
      "connect:DescribeContactFlow",
      "connect:CreateContactFlow",
      "connect:UpdateContactFlowContent",
    ],
  },
  {
    group: "profiles",
    label: "Cliente 360° (Customer Profiles)",
    actions: [
      "profile:SearchProfiles",
      "profile:GetDomain",
      "profile:ListDomains",
      "profile:CreateProfile",
      "profile:UpdateProfile",
      "profile:PutProfileObject",
      "profile:AddProfileKey",
    ],
  },
  {
    group: "whatsapp",
    label: "WhatsApp (plantillas y envío)",
    actions: [
      "social-messaging:SendWhatsAppMessage",
      "social-messaging:ListLinkedWhatsAppBusinessAccounts",
      "social-messaging:ListWhatsAppMessageTemplates",
      "social-messaging:GetWhatsAppMessageTemplate",
    ],
  },
];

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

type CheckStatus = "ok" | "warn" | "error";
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Qué se rompe sin esto + cómo activarlo. null si está OK. */
  remediation?: string | null;
  /** Link a la consola del cliente para resolverlo (si aplica). */
  link?: string | null;
}

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function instanceIdFromArn(arn: string): string {
  const m = /instance\/([0-9a-f-]+)/i.exec(arn || "");
  return m ? m[1] : "";
}

/** URL base de la consola de Connect del cliente para deep-links de remediación. */
function consoleBase(instanceUrl?: string): string {
  return (instanceUrl || "").replace(/\/$/, "");
}

/** Nombre del dominio de Customer Profiles. Por convención Connect crea uno
 *  llamado `amazon-connect-<alias>` (el alias = primer label del host de la
 *  instancia). El cliente puede sobrescribirlo en Opciones avanzadas. */
function deriveCpDomain(instanceUrl?: string, override?: string): string {
  if (override) return override;
  const host = (instanceUrl || "").replace(/^https?:\/\//, "").split("/")[0];
  const alias = host.split(".")[0];
  return alias ? `amazon-connect-${alias}` : "";
}

interface DiagnoseConfig {
  roleArn?: string;
  externalId?: string;
  instanceArn?: string;
  instanceUrl?: string;
  region?: string;
  dataPlaneEnabled?: boolean;
  recordingBucket?: string;
  customerProfilesDomain?: string;
}

async function readTenantConfig(tenantId: string): Promise<DiagnoseConfig | null> {
  try {
    const r = await voxDdb.send(
      new GetItemCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { tenantId: { S: tenantId } },
      }),
    );
    const json = r.Item?.configJson?.S;
    if (!json) return null;
    const cfg = JSON.parse(json) as { connect?: DiagnoseConfig };
    return cfg.connect || null;
  } catch {
    return null;
  }
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  // Auth: admin del tenant.
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!identity || !identity.tenantId) return resp(401, { error: "No autorizado" });
  if (!identity.groups.includes("Admins")) {
    return resp(403, { error: "Solo administradores pueden diagnosticar" });
  }

  // Config: del body (wizard pre-guardado) o de connectview-connections.
  let body: DiagnoseConfig = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* sin body → usamos la config guardada */
  }
  const stored = await readTenantConfig(identity.tenantId);
  const cfg: DiagnoseConfig = {
    roleArn: body.roleArn || stored?.roleArn,
    externalId: body.externalId || stored?.externalId,
    instanceArn: body.instanceArn || stored?.instanceArn,
    instanceUrl: body.instanceUrl || stored?.instanceUrl,
    region: body.region || stored?.region || "us-east-1",
    dataPlaneEnabled: body.dataPlaneEnabled ?? stored?.dataPlaneEnabled,
    recordingBucket: body.recordingBucket || stored?.recordingBucket,
    customerProfilesDomain: body.customerProfilesDomain || stored?.customerProfilesDomain,
  };

  const checks: Check[] = [];
  const region = cfg.region || "us-east-1";
  const cBase = consoleBase(cfg.instanceUrl);

  // ── Check 1: ¿hay config mínima? ───────────────────────────────────────
  if (!cfg.roleArn || !cfg.instanceArn) {
    checks.push({
      id: "config",
      label: "Configuración de Amazon Connect",
      status: "error",
      detail: "Falta la URL/ARN de la instancia o el ARN del rol.",
      remediation:
        "Completa los pasos 1 a 3 del asistente: pega la URL de tu instancia, su ARN, y el RoleArn del rol que crea la plantilla CloudFormation.",
    });
    return resp(200, { checks, generatedAt: new Date().toISOString() });
  }

  // ── Check 2: assume-role ───────────────────────────────────────────────
  let creds;
  try {
    const a = await sts.send(
      new AssumeRoleCommand({
        RoleArn: cfg.roleArn,
        RoleSessionName: "vox-diagnose",
        ExternalId: cfg.externalId,
        DurationSeconds: 900,
      }),
    );
    creds = a.Credentials;
    if (!creds?.AccessKeyId) throw new Error("STS sin credenciales");
    checks.push({
      id: "role",
      label: "Acceso seguro (rol cross-account)",
      status: "ok",
      detail: "Vox puede asumir tu rol correctamente.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      id: "role",
      label: "Acceso seguro (rol cross-account)",
      status: "error",
      detail: "No pudimos asumir el rol.",
      remediation:
        "Las 3 causas más comunes: (1) el stack de CloudFormation todavía se está creando — espera 1-2 min y reintentá; (2) el ExternalId del asistente no coincide con el del rol — reaplicá la plantilla; (3) tu cuenta bloquea roles con confianza externa (SCP) — pídele a tu equipo de seguridad una excepción para la cuenta de Vox. Detalle técnico: " +
        msg.slice(0, 160),
    });
    // Sin rol no podemos seguir con los chequeos de Connect.
    await maybeDiagnoseCloudFormation(checks, cfg, region);
    return resp(200, { checks, generatedAt: new Date().toISOString() });
  }

  const assumedCreds = {
    accessKeyId: creds.AccessKeyId!,
    secretAccessKey: creds.SecretAccessKey!,
    sessionToken: creds.SessionToken!,
  };
  const connect = new ConnectClient({ region, credentials: assumedCreds });
  const instanceId = instanceIdFromArn(cfg.instanceArn);

  // ── Check 3: instancia accesible ───────────────────────────────────────
  try {
    const di = await connect.send(new DescribeInstanceCommand({ InstanceId: instanceId }));
    checks.push({
      id: "instance",
      label: "Instancia de Connect",
      status: "ok",
      detail: `Accesible · ${di.Instance?.InstanceAlias || instanceId} · ${region}`,
    });
  } catch (e) {
    checks.push({
      id: "instance",
      label: "Instancia de Connect",
      status: "error",
      detail: "El rol funciona, pero no encontramos la instancia.",
      remediation:
        "Verifica que el ARN de la instancia y la región sean correctos. El ARN tiene la forma arn:aws:connect:REGION:CUENTA:instance/ID. Detalle: " +
        (e instanceof Error ? e.message.slice(0, 140) : ""),
    });
  }

  // ── Check 3b: drift de permisos del rol (auto-diagnóstico, SIN ejecutar) ─
  await diagnosePermissionDrift(checks, region, assumedCreds, cfg.roleArn);

  // ── Check 4: Contact Lens ──────────────────────────────────────────────
  try {
    const cl = await connect.send(
      new DescribeInstanceAttributeCommand({
        InstanceId: instanceId,
        AttributeType: "CONTACT_LENS",
      }),
    );
    const on = cl.Attribute?.Value === "true";
    checks.push({
      id: "contactLens",
      label: "Contact Lens (transcripciones + sentiment)",
      status: on ? "ok" : "warn",
      detail: on ? "Activado." : "Apagado.",
      remediation: on
        ? null
        : "Sin Contact Lens no vas a ver transcripciones ni análisis de sentimiento de las llamadas. Actívalo en tu consola de Connect → Análisis y optimización → Contact Lens. Aplica a las llamadas nuevas.",
      link: on ? null : cBase ? `${cBase}/connect/contact-lens` : null,
    });
  } catch {
    checks.push({
      id: "contactLens",
      label: "Contact Lens (transcripciones + sentiment)",
      status: "warn",
      detail: "No pudimos verificar el estado.",
      remediation:
        "Verifica en tu consola de Connect → Análisis y optimización si Contact Lens está activado.",
    });
  }

  // ── Check 5: grabaciones de llamadas + nombre del bucket ───────────────
  let recordingBucket = cfg.recordingBucket || "";
  try {
    const sc = await connect.send(
      new ListInstanceStorageConfigsCommand({
        InstanceId: instanceId,
        ResourceType: "CALL_RECORDINGS",
      }),
    );
    const s3cfg = sc.StorageConfigs?.[0]?.S3Config;
    if (s3cfg?.BucketName) {
      recordingBucket = recordingBucket || s3cfg.BucketName;
      checks.push({
        id: "recordings",
        label: "Grabación de llamadas",
        status: "ok",
        detail: `Habilitada · bucket "${s3cfg.BucketName}"`,
      });
    } else {
      checks.push({
        id: "recordings",
        label: "Grabación de llamadas",
        status: "warn",
        detail: "No hay almacenamiento de grabaciones configurado.",
        remediation:
          "Las llamadas no se están grabando. Activa la grabación en tu consola de Connect → Almacenamiento de datos → Grabación de llamadas.",
        link: cBase ? `${cBase}/connect/data-storage` : null,
      });
    }
  } catch {
    checks.push({
      id: "recordings",
      label: "Grabación de llamadas",
      status: "warn",
      detail: "No pudimos verificar la configuración de grabaciones.",
    });
  }

  // ── Check 6: acceso S3 real al bucket de grabaciones ───────────────────
  if (recordingBucket && !recordingBucket.includes("*")) {
    try {
      const s3 = new S3Client({ region, credentials: assumedCreds });
      await s3.send(new ListObjectsV2Command({ Bucket: recordingBucket, MaxKeys: 1 }));
      checks.push({
        id: "s3Recordings",
        label: "Acceso al bucket de grabaciones",
        status: "ok",
        detail: `Vox puede leer "${recordingBucket}".`,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const denied = /AccessDenied|Forbidden/i.test(name);
      checks.push({
        id: "s3Recordings",
        label: "Acceso al bucket de grabaciones",
        status: "error",
        detail: denied
          ? `Sin permiso para leer "${recordingBucket}".`
          : `No pudimos acceder a "${recordingBucket}".`,
        remediation: denied
          ? `El parámetro RecordingBucket de tu plantilla CloudFormation no coincide con el bucket real ("${recordingBucket}"). Reaplicá la plantilla del rol poniendo ese nombre exacto en el parámetro RecordingBucket.`
          : `Verifica que el bucket "${recordingBucket}" exista en tu cuenta y región (${region}).`,
      });
    }
  } else {
    checks.push({
      id: "s3Recordings",
      label: "Acceso al bucket de grabaciones",
      status: "warn",
      detail: "El nombre del bucket está como patrón, no exacto.",
      remediation:
        "Para que Vox pueda leer las grabaciones, pon el nombre EXACTO del bucket en el parámetro RecordingBucket de la plantilla (en vez de amazon-connect-*).",
    });
  }

  // ── Check 7: Customer Profiles (REAL — GetDomain del dominio del cliente) ─
  // Antes esto era un falso positivo: consultaba el tipo equivocado e ignoraba
  // el resultado → siempre "OK". Ahora intentamos GetDomain del dominio real.
  {
    const cpDomain = deriveCpDomain(cfg.instanceUrl, cfg.customerProfilesDomain);
    if (!cpDomain) {
      checks.push({
        id: "customerProfiles",
        label: "Customer Profiles (Cliente 360°)",
        status: "warn",
        detail: "No pudimos derivar el nombre del dominio.",
        remediation:
          "Indica el dominio de Customer Profiles en Opciones avanzadas (suele ser amazon-connect-<alias>).",
        link: cBase ? `${cBase}/connect/customerprofiles` : null,
      });
    } else {
      const cp = new CustomerProfilesClient({ region, credentials: assumedCreds });
      try {
        await cp.send(new GetDomainCommand({ DomainName: cpDomain }));
        checks.push({
          id: "customerProfiles",
          label: "Customer Profiles (Cliente 360°)",
          status: "ok",
          detail: `Activado · dominio "${cpDomain}".`,
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (/ResourceNotFound/i.test(name)) {
          checks.push({
            id: "customerProfiles",
            label: "Customer Profiles (Cliente 360°)",
            status: "warn",
            detail: `No existe el dominio "${cpDomain}".`,
            remediation:
              "Sin Customer Profiles, el Cliente 360° va a estar vacío. Activa Customer Profiles en tu consola de Connect (crea el dominio amazon-connect-<alias>). Si ya lo tienes con otro nombre, ponelo en Opciones avanzadas.",
            link: cBase ? `${cBase}/connect/customerprofiles` : null,
          });
        } else if (/AccessDenied|not authorized/i.test(name)) {
          checks.push({
            id: "customerProfiles",
            label: "Customer Profiles (Cliente 360°)",
            status: "warn",
            detail: "El rol no tiene permiso para verificar Customer Profiles.",
            remediation:
              "Reaplicá la plantilla del rol (paso 3): la versión nueva agrega profile:GetDomain/SearchProfiles para leer el Cliente 360° y poder verificarlo.",
          });
        } else {
          checks.push({
            id: "customerProfiles",
            label: "Customer Profiles (Cliente 360°)",
            status: "warn",
            detail: "No pudimos verificar el estado.",
          });
        }
      }
    }
  }

  // ── Check 7b: Amazon Q in Connect (Wisdom) ─────────────────────────────
  try {
    const wa = await connect.send(
      new ListIntegrationAssociationsCommand({
        InstanceId: instanceId,
        IntegrationType: "WISDOM_ASSISTANT",
      }),
    );
    const on = (wa.IntegrationAssociationSummaryList?.length || 0) > 0;
    checks.push({
      id: "amazonQ",
      label: "Amazon Q in Connect (copiloto)",
      status: on ? "ok" : "warn",
      detail: on ? "Activado." : "No detectamos un asistente de Amazon Q.",
      remediation: on
        ? null
        : "Sin Amazon Q in Connect, el copiloto del agente no va a sugerir respuestas ni artículos de la base de conocimiento. Actívalo en tu consola de Connect → Amazon Q.",
      link: on ? null : cBase ? `${cBase}/connect/amazon-q` : null,
    });
  } catch {
    checks.push({
      id: "amazonQ",
      label: "Amazon Q in Connect (copiloto)",
      status: "warn",
      detail: "No pudimos verificar el estado de Amazon Q.",
    });
  }

  // ── Check 7c: Amazon Bedrock — los bots + resúmenes IA corren en SU cuenta.
  //    Invocamos el modelo más barato (Claude Haiku) con max_tokens=1: si falla
  //    por acceso, casi siempre es que el tenant no habilitó los modelos en su
  //    consola de Bedrock → sus bots/resúmenes no funcionarían. ──────────────
  try {
    const br = new BedrockRuntimeClient({ region, credentials: assumedCreds });
    await br.send(
      new InvokeModelCommand({
        // Modelo ACTUAL (Haiku 4.5) — NO el 3-5-haiku, que AWS marca como Legacy
        // y rechaza si no se usó en 30 días (daría un falso "warn").
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );
    checks.push({
      id: "bedrock",
      label: "Amazon Bedrock (IA: bots y resúmenes)",
      status: "ok",
      detail: "Modelo Claude habilitado y accesible en tu cuenta.",
    });
  } catch (e) {
    const info = `${e instanceof Error ? e.name : ""} ${e instanceof Error ? e.message : ""}`;
    const accessIssue =
      /AccessDenied|access to the model|not authorized|ValidationException|ResourceNotFound|could not be found/i.test(
        info,
      );
    checks.push({
      id: "bedrock",
      label: "Amazon Bedrock (IA: bots y resúmenes)",
      status: "warn",
      detail: accessIssue
        ? "No pudimos invocar el modelo Claude — probablemente no tienes habilitado el acceso a los modelos en tu cuenta de Bedrock."
        : "No pudimos verificar Bedrock.",
      remediation:
        "Sin acceso a Bedrock, los bots y los resúmenes con IA no funcionan. Habilitá el acceso a los modelos de Anthropic (Claude) en tu consola de Amazon Bedrock → Model access, en la región de tu instancia.",
      link: `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`,
    });
  }

  // ── Check 8: BYO Data Plane — chequea las 14 tablas individualmente ────
  if (cfg.dataPlaneEnabled) {
    const dynamo = new DynamoDBClient({ region, credentials: assumedCreds });
    const missing: string[] = [];
    let permDenied = false;
    await Promise.all(
      DATA_PLANE_TABLES.map(async (t) => {
        try {
          await dynamo.send(new DescribeTableCommand({ TableName: t }));
        } catch (e) {
          const name = e instanceof Error ? e.name : "";
          if (/AccessDenied|not authorized/i.test(name)) permDenied = true;
          else missing.push(t); // ResourceNotFound → la tabla no existe
        }
      }),
    );
    if (permDenied && missing.length === 0) {
      // Las tablas existen pero el rol no tiene permiso DynamoDB sobre ellas.
      checks.push({
        id: "dataPlane",
        label: "BYO Data Plane (tus tablas)",
        status: "error",
        detail: "Las tablas existen, pero el rol no tiene permiso para usarlas.",
        remediation:
          "Tus tablas ya están creadas, pero al rol le falta el permiso DynamoDB. Aplica la plantilla de SOLO PERMISOS del Data Plane (extiende el rol sin tocar las tablas). Es segura de re-aplicar.",
      });
    } else if (missing.length === DATA_PLANE_TABLES.length) {
      checks.push({
        id: "dataPlane",
        label: "BYO Data Plane (tus tablas)",
        status: "error",
        detail: "Ninguna de las 14 tablas existe todavía.",
        remediation:
          "Aplicaste el rol pero falta la plantilla del Data Plane (crea las 14 tablas). Desplegala desde el paso 4. Hasta entonces, los datos del producto no se pueden guardar.",
      });
    } else if (missing.length > 0) {
      // Caso del miedo del usuario: el stack se aplicó a medias.
      checks.push({
        id: "dataPlane",
        label: "BYO Data Plane (tus tablas)",
        status: "error",
        detail: `Faltan ${missing.length} de 14 tablas (creación incompleta).`,
        remediation:
          `Tu stack del Data Plane quedó incompleto. Faltan: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}. ` +
          "Re-aplica la plantilla del Data Plane: como las tablas existentes tienen 'Retain', no se pierde nada y se crean las que faltan.",
      });
    } else {
      checks.push({
        id: "dataPlane",
        label: "BYO Data Plane (tus tablas)",
        status: "ok",
        detail: "Las 14 tablas existen y son accesibles.",
      });
    }
  }

  // ── Check 9 (opcional): CloudFormation stack events ────────────────────
  await maybeDiagnoseCloudFormation(checks, cfg, region, assumedCreds);

  return resp(200, { checks, generatedAt: new Date().toISOString() });
};

/**
 * diagnosePermissionDrift — detecta "drift" de permisos: acciones que la app
 * USA pero que el rol del tenant (creado con una plantilla anterior) no otorga.
 * Usa iam:SimulatePrincipalPolicy sobre el PROPIO rol → evalúa cada acción SIN
 * ejecutarla (cero efectos secundarios, cubre lecturas Y escrituras). Si el rol
 * no tiene ni ese permiso (rol viejo), lo reporta como "reaplicá la plantilla"
 * en vez de fallar. Esto convierte cada AccessDenied silencioso futuro en un
 * aviso accionable aquí.
 */
async function diagnosePermissionDrift(
  checks: Check[],
  region: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assumedCreds: any,
  roleArn: string,
): Promise<void> {
  const allActions = EXPECTED_STAR_PERMISSIONS.flatMap((g) => g.actions);
  let results;
  try {
    const iam = new IAMClient({ region, credentials: assumedCreds });
    const out = await iam.send(
      new SimulatePrincipalPolicyCommand({
        PolicySourceArn: roleArn,
        ActionNames: allActions,
      }),
    );
    results = out.EvaluationResults || [];
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const denied = /AccessDenied|not authorized/i.test(name);
    checks.push({
      id: "permissions",
      label: "Permisos del rol (auto-diagnóstico)",
      status: "warn",
      detail: denied
        ? "El rol todavía no puede auto-verificar sus permisos."
        : "No pudimos verificar los permisos del rol.",
      remediation: denied
        ? "Reaplicá la plantilla del rol (paso 3): la versión nueva agrega iam:SimulatePrincipalPolicy SOLO sobre el propio rol, para que Vox detecte por ti cualquier permiso faltante (en vez de fallar en silencio)."
        : null,
    });
    return;
  }

  if (results.length === 0) {
    checks.push({
      id: "permissions",
      label: "Permisos del rol (auto-diagnóstico)",
      status: "warn",
      detail: "La simulación de permisos no devolvió resultados.",
      remediation: null,
    });
    return;
  }

  // Acciones denegadas, agrupadas por feature.
  const deniedByGroup: Record<string, string[]> = {};
  for (const r of results) {
    if (r.EvalDecision !== "allowed" && r.EvalActionName) {
      const grp = EXPECTED_STAR_PERMISSIONS.find((g) => g.actions.includes(r.EvalActionName!));
      if (grp) (deniedByGroup[grp.group] ||= []).push(r.EvalActionName);
    }
  }
  const missingGroups = EXPECTED_STAR_PERMISSIONS.filter(
    (g) => (deniedByGroup[g.group]?.length || 0) > 0,
  );

  if (missingGroups.length === 0) {
    checks.push({
      id: "permissions",
      label: "Permisos del rol",
      status: "ok",
      detail: `El rol tiene los ${allActions.length} permisos que la app necesita.`,
    });
    return;
  }

  const totalMissing = Object.values(deniedByGroup).reduce((n, a) => n + a.length, 0);
  checks.push({
    id: "permissions",
    label: "Permisos del rol",
    status: "error",
    detail: `Faltan ${totalMissing} permiso(s) en ${missingGroups.length} área(s): ${missingGroups
      .map((g) => g.label)
      .join(", ")}.`,
    remediation:
      "Tu rol se creó con una versión anterior de la plantilla. Reaplicá la plantilla del rol (paso 3) — es segura de re-aplicar (solo agrega lo que falta, no toca nada más). Detalle: " +
      missingGroups.map((g) => `${g.label} → ${deniedByGroup[g.group].join(", ")}`).join(" · "),
  });
}

/**
 * Si el rol del cliente otorgó cloudformation:DescribeStackEvents, leemos el
 * último evento de error del stack VoxCrmConnectAccess y lo mostramos textual.
 * Es opt-in (permiso extra); si no lo tienen, lo saltamos en silencio.
 */
async function maybeDiagnoseCloudFormation(
  checks: Check[],
  cfg: DiagnoseConfig,
  region: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assumedCreds?: any,
): Promise<void> {
  if (!assumedCreds) return; // sin rol asumido no podemos leer CF
  try {
    const cf = new CloudFormationClient({ region, credentials: assumedCreds });
    const ev = await cf.send(new DescribeStackEventsCommand({ StackName: "VoxCrmConnectAccess" }));
    const failed = (ev.StackEvents || []).find((e) => /FAILED/.test(e.ResourceStatus || ""));
    if (failed) {
      checks.push({
        id: "cloudformation",
        label: "CloudFormation (último error del stack)",
        status: "error",
        detail: `${failed.LogicalResourceId}: ${failed.ResourceStatusReason || failed.ResourceStatus}`,
        remediation:
          "Ese es el recurso exacto que falló en tu stack. Corregilo en CloudFormation y actualiza el stack.",
      });
    }
  } catch {
    /* sin permiso DescribeStackEvents → lo saltamos (es opt-in) */
  }
}
