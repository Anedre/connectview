/**
 * tenantConnect — resuelve el Amazon Connect del CLIENTE (tenant) para llamadas
 * server-side, vía rol cross-account.
 *
 * Dado un tenantId: lee su config de conexión (connectview-connections), asume
 * el rol IAM que el cliente creó en SU cuenta (sts:AssumeRole + ExternalId) y
 * devuelve un ConnectClient con esas credenciales + el instanceId de SU Connect.
 *
 * Es el helper central de #43: cada Lambda que toca Connect (métricas, outbound,
 * grabaciones, colas, admin) lo usa en vez de instanciar ConnectClient contra la
 * cuenta de Vox. Cachea las credenciales asumidas por tenant (~50 min).
 *
 * Si el tenant no configuró Connect (o es "default"), devuelve null → el Lambda
 * cae a su comportamiento legacy (la instancia hardcodeada de Vox), para que la
 * transición no rompa nada.
 *
 * Requiere (policy aparte): sts:AssumeRole sobre arn:aws:iam::*:role/VoxCrmConnectAccess.
 */
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { ConnectClient } from "@aws-sdk/client-connect";
import { S3Client } from "@aws-sdk/client-s3";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { resolveTenantId, isLegacyTenant } from "./cognitoAuth";

// Helper para las APIs que solo necesitan el DynamoDB del cliente (sin
// preocuparse por Connect/S3). Lo usan los Lambdas que NO tocan Connect
// pero sí tablas que migran a la cuenta del cliente en #46 (manage-leads,
// manage-appointments, manage-callbacks, manage-bots, etc.).
//
// Misma lógica que resolveConnect: si el tenant tiene Connect configurado
// (que es donde vive el rol cross-account), usamos SU DynamoDB; si no,
// caemos al cliente legacy de Vox (tablas en la cuenta de Novasys).

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const ddb = new DynamoDBClient({});
const sts = new STSClient({});

export interface TenantConnect {
  client: ConnectClient;
  /** S3 client con las MISMAS credenciales assumed del tenant. Útil para
   *  recording (las grabaciones viven en el bucket de Connect del cliente,
   *  no en el de Vox). Si el cliente no extendió el rol con permisos S3 el
   *  GetObject va a tirar AccessDenied → manejarlo en el caller. */
  s3: S3Client;
  /** DynamoDB client con las MISMAS credenciales assumed del tenant — apunta
   *  a las tablas que viven en SU cuenta AWS (#46 BYO Data Plane). Cuando
   *  el cliente aplica el CFN template, se crean las tablas con el mismo
   *  nombre (connectview-leads, -campaigns, …) en su cuenta. Si NO aplicó
   *  el template, las llamadas tiran ResourceNotFoundException → manejarlo
   *  en el caller (típicamente fallback al cliente legacy). */
  dynamo: DynamoDBClient;
  /** Customer Profiles client del tenant. El "domain name" del Customer
   *  Profile es `customerProfilesDomain` (derivado del alias del Connect del
   *  cliente: instancia novasys → "amazon-connect-novasys"). Para Lambdas
   *  que hacen Search/Update/Get sobre los perfiles del cliente. */
  customerProfiles: CustomerProfilesClient;
  /** Domain name del Customer Profiles (per-Connect-instance). Default:
   *  `amazon-connect-<alias>` del instanceUrl del cliente. */
  customerProfilesDomain: string;
  /** AWS End User Messaging Social client con las MISMAS creds assumed del
   *  tenant — para enviar WhatsApp desde el número del CLIENTE (su WABA
   *  conectada a SU instancia de Connect vía End User Messaging). Si el rol
   *  no tiene `social-messaging:SendWhatsAppMessage`, el send tira AccessDenied. */
  socialMessaging: SocialMessagingClient;
  /** Phone Number Id (origination identity) de End User Messaging del tenant,
   *  de su config (`whatsapp.phoneNumberId`). "" si no conectó WhatsApp. */
  whatsappPhoneNumberId: string;
  /** WhatsApp Business Account Id (WABA) del tenant, de su config
   *  (`whatsapp.wabaId`). Para listar SUS plantillas aprobadas en el wizard de
   *  campañas. "" si no lo cargó. */
  whatsappWabaId: string;
  /** Modo de envío de WhatsApp: "aws" (End User Messaging, número de Connect) o
   *  "meta" (Cloud API directa, número de Meta suelto). Default "aws". */
  whatsappMode: "aws" | "meta";
  /** Phone Number Id de Meta Cloud API (modo "meta"). "" en modo "aws". */
  whatsappMetaPhoneNumberId: string;
  /** Bedrock Runtime client con las creds assumed del tenant — los bots
   *  (bot-runtime) y los resúmenes corren en la cuenta del CLIENTE, contra SU
   *  Bedrock (su quota, sus modelos habilitados). Si el rol no tiene
   *  `bedrock:InvokeModel`, la llamada tira AccessDenied → manejarlo en el caller. */
  bedrock: BedrockRuntimeClient;
  instanceId: string;
  region: string;
  instanceArn?: string;
}

interface CacheEntry {
  value: TenantConnect;
  exp: number;
}
const cache = new Map<string, CacheEntry>();

/** Deriva el instanceId del ARN (…:instance/<id>). */
function instanceIdFromArn(arn?: string): string | null {
  if (!arn) return null;
  const m = /instance\/([0-9a-f-]+)/i.exec(arn);
  return m ? m[1] : null;
}

interface ConnectConnConfig {
  instanceUrl?: string;
  region?: string;
  instanceArn?: string;
  roleArn?: string;
  externalId?: string;
  /** BYO Data Plane (#46) — flag explícito que el cliente activa DESPUÉS de
   *  aplicar el CFN de las 14 tablas. Sin esto, `resolveDynamo` devuelve el
   *  cliente legacy de Vox (las tablas tenant-side no existen todavía). */
  dataPlaneEnabled?: boolean;
  /** Override del domain name de Customer Profiles. Default: derivado del
   *  instanceUrl como `amazon-connect-<alias>`. */
  customerProfilesDomain?: string;
  /** Región de Bedrock del cliente (los bots corren en SU cuenta). Default: la
   *  misma región del Connect. Útil si el cliente habilitó modelos en otra. */
  bedrockRegion?: string;
}

/** "https://acme.my.connect.aws" → "amazon-connect-acme". Devuelve null si
 *  no logra parsear (URL inválido o sin subdominio). */
function deriveCustomerProfilesDomain(instanceUrl?: string): string | null {
  if (!instanceUrl) return null;
  try {
    const host = new URL(instanceUrl).hostname;
    const alias = host.split(".")[0];
    return alias ? `amazon-connect-${alias}` : null;
  } catch {
    return null;
  }
}

interface WhatsAppConnConfig {
  /** Phone Number Id (origination identity) de AWS End User Messaging Social.
   *  Es el número de WhatsApp del CLIENTE desde el que se envía. */
  phoneNumberId?: string;
  wabaId?: string;
  tokenSet?: boolean;
}
interface TenantConfig {
  connect?: ConnectConnConfig;
  whatsapp?: WhatsAppConnConfig;
}

async function readTenantConfig(tenantId: string): Promise<TenantConfig | null> {
  const r = await ddb.send(
    new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
  );
  const json = r.Item?.configJson?.S;
  if (!json) return null;
  try {
    return JSON.parse(json) as TenantConfig;
  } catch {
    return null;
  }
}

/** Cache de "tenant tiene data plane?" — separado de la cache de creds porque
 *  el flag se puede flipear sin que cambien las creds. Tiene su propio TTL
 *  corto (1 min) para que activar/desactivar el data plane se propague rápido. */
const dataPlaneFlagCache = new Map<string, { enabled: boolean; exp: number }>();

/**
 * BlockedDynamoClient — proxy del DynamoDBClient para tenants reales que aún
 * no activaron BYO Data Plane. Reads devuelven vacío, writes son no-op. Así
 * NO leakeamos los datos pooled de Vox (que son de Novasys) a tenants nuevos,
 * y tampoco contaminamos esa tabla con escrituras de otros tenants.
 *
 * Para Novasys (`tenantId === "default"`) seguimos usando el client real →
 * legacy app sigue funcionando idénticamente. La separación es:
 *
 *   default         → legacyDynamo (Vox pooled tables, datos reales)
 *   real + DP on    → tenant DDB (assumed creds → su cuenta)
 *   real + DP off   → blockedDynamoClient (empty/no-op) ← este
 */

const blockedDynamoClient = new Proxy({} as DynamoDBClient, {
  get(_target, prop) {
    if (prop === "send") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (command: any) => {
        const name = command?.constructor?.name || "";
        // Reads → vacío.
        if (name === "GetItemCommand") return { Item: undefined };
        if (name === "QueryCommand" || name === "ScanCommand") {
          return { Items: [], Count: 0, ScannedCount: 0, LastEvaluatedKey: undefined };
        }
        if (name === "BatchGetItemCommand") return { Responses: {}, UnprocessedKeys: {} };
        if (name === "DescribeTableCommand") return { Table: undefined };
        // Writes / Updates / Deletes → silenciosos. Devolvemos el shape mínimo
        // que el caller suele esperar (Attributes vacíos, sin UnprocessedItems).
        if (name === "BatchWriteItemCommand") return { UnprocessedItems: {} };
        return { Attributes: undefined };
      };
    }
    // Métodos de configuración del SDK (config, destroy, etc.) no rompen porque
    // los Lambdas no los llaman.
    return undefined;
  },
});

/**
 * blockedConnectClient — análogo del blocked DDB para Amazon Connect.
 * Usado cuando un tenant tiene `tenantId` real pero NO conectó su instancia
 * de Connect. Antes caíamos al legacy (Novasys) → leakeábamos métricas/colas/
 * usuarios. Ahora devolvemos respuestas vacías para todas las operaciones de
 * lectura más comunes.
 */

const blockedConnectClient = new Proxy({} as ConnectClient, {
  get(_target, prop) {
    if (prop === "send") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (command: any) => {
        const name = command?.constructor?.name || "";
        // List* / Search* / Get*MetricData → arrays/maps vacíos.
        if (name === "GetCurrentMetricDataCommand")
          return { MetricResults: [], DataSnapshotTime: new Date() };
        if (name === "GetCurrentUserDataCommand") return { UserDataList: [] };
        if (name === "GetMetricDataV2Command") return { MetricResults: [] };
        if (name === "GetMetricDataCommand") return { MetricResults: [] };
        if (name === "ListQueuesCommand") return { QueueSummaryList: [] };
        if (name === "ListUsersCommand") return { UserSummaryList: [] };
        if (name === "ListContactFlowsCommand") return { ContactFlowSummaryList: [] };
        if (name === "ListRoutingProfilesCommand") return { RoutingProfileSummaryList: [] };
        if (name === "ListRoutingProfileQueuesCommand")
          return { RoutingProfileQueueConfigSummaryList: [] };
        if (name === "ListAgentStatusesCommand") return { AgentStatusSummaryList: [] };
        if (name === "ListPhoneNumbersCommand" || name === "ListPhoneNumbersV2Command")
          return { PhoneNumberSummaryList: [], ListPhoneNumbersSummaryList: [] };
        if (name === "SearchContactsCommand") return { Contacts: [] };
        if (name === "SearchUsersCommand") return { Users: [] };
        if (name === "SearchQueuesCommand") return { Queues: [] };
        if (name === "DescribeContactCommand") return { Contact: undefined };
        if (name === "DescribeUserCommand") return { User: undefined };
        if (name === "DescribeQueueCommand") return { Queue: undefined };
        if (name === "DescribeInstanceCommand") return { Instance: undefined };
        if (name === "ListContactReferencesCommand") return { ReferenceSummaryList: [] };
        // Writes / Starts → silenciosos. Devolvemos ids ficticios para no
        // romper los callers que esperan un ContactId.
        if (name.startsWith("Start") || name.startsWith("Create"))
          return { ContactId: "blocked-no-tenant-connect" };
        // Stop/Update/Associate/etc → no-op.
        return {};
      };
    }
    return undefined;
  },
});

/**
 * blockedProfilesClient — análogo del blocked DDB/Connect para Amazon Connect
 * Customer Profiles. Se usa cuando un tenant REAL no tiene su dominio de
 * Customer Profiles resuelto (no conectó Connect, o la lectura de config falló
 * por IAM). Antes caíamos al cliente legacy (cuenta de Novasys) + dominio
 * "amazon-connect-novasys" → leíamos/escribíamos los PERFILES DE CLIENTES de
 * Novasys = leak de datos cross-tenant (lectura) y contaminación de los
 * perfiles de Novasys con datos de otros tenants (escritura). Ahora: reads →
 * vacío, writes → no-op (con un ProfileId ficticio para no romper callers que
 * lo esperan).
 */
const blockedProfilesClient = new Proxy({} as CustomerProfilesClient, {
  get(_target, prop) {
    if (prop === "send") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (command: any) => {
        const name = command?.constructor?.name || "";
        // Search / List / Get → vacío.
        if (name === "SearchProfilesCommand") return { Items: [] };
        if (name === "ListProfileObjectsCommand") return { Items: [] };
        if (name === "ListProfileObjectTypesCommand") return { Items: [] };
        if (name === "GetProfileObjectTypeCommand") return {};
        if (name === "ListIntegrationsCommand") return { Items: [] };
        if (name === "ListDomainsCommand") return { Items: [] };
        if (name === "GetDomainCommand") return {};
        // Create / Update → no-op pero devolvemos un ProfileId ficticio porque
        // el CSV upsert lee `created.ProfileId`. La escritura NO ocurre.
        if (name === "CreateProfileCommand" || name === "UpdateProfileCommand")
          return { ProfileId: "blocked-no-tenant-profiles" };
        // PutProfileObject / Delete / Merge / Add* → no-op silencioso.
        return {};
      };
    }
    return undefined;
  },
});

/**
 * blockedBedrockClient — para tenants REALES que NO configuraron su Connect/
 * Bedrock. Antes caíamos al Bedrock legacy de Vox → el tenant consumía NUESTRA
 * quota y costo (leak de costo + datos del prompt salían por nuestra cuenta).
 * Ahora tiramos un error claro que el caller ya sabe manejar (igual que un
 * AccessDenied de bedrock:InvokeModel): bot-runtime / generate-call-summary lo
 * envuelven en try/catch y degradan con gracia.
 */
const blockedBedrockClient = new Proxy({} as BedrockRuntimeClient, {
  get(_target, prop) {
    if (prop === "send") {
      return async () => {
        throw new Error(
          "BEDROCK_NOT_CONFIGURED: la organización no configuró Bedrock (BYO) — " +
            "conectá Amazon Connect para habilitar bots/resúmenes con tu propia cuenta.",
        );
      };
    }
    return undefined;
  },
});

/** Devuelve si el tenant tiene `dataPlaneEnabled: true` en su config.
 *  Si la lectura de DDB falla (Lambda sin permiso a connectview-connections),
 *  asumimos false → comportamiento blocked, más seguro que asumir true. */
export async function isTenantDataPlaneEnabled(tenantId: string): Promise<boolean> {
  // Novasys (legacy) usa las tablas pooled directo, no el data plane BYO.
  if (!tenantId || isLegacyTenant(tenantId)) return false;
  const hit = dataPlaneFlagCache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.enabled;
  try {
    const cfg = await readTenantConfig(tenantId);
    const enabled = !!cfg?.connect?.dataPlaneEnabled;
    dataPlaneFlagCache.set(tenantId, { enabled, exp: Date.now() + 60 * 1000 });
    return enabled;
  } catch {
    // Cachear el "false" por menos tiempo (10s) para que un fix de IAM se
    // refleje rápido sin esperar el TTL completo.
    dataPlaneFlagCache.set(tenantId, { enabled: false, exp: Date.now() + 10 * 1000 });
    return false;
  }
}

/**
 * Devuelve el Connect del tenant (cliente + instanceId), o null si no está
 * configurado (→ el caller usa su fallback legacy).
 */
export async function getTenantConnect(tenantId: string): Promise<TenantConnect | null> {
  // Novasys (legacy) no usa cross-account — sus recursos (Connect + tablas)
  // están en la cuenta de Vox y se acceden con el client legacy directo.
  if (!tenantId || isLegacyTenant(tenantId)) return null;

  const cached = cache.get(tenantId);
  if (cached && cached.exp > Date.now()) return cached.value;

  const cfg = await readTenantConfig(tenantId);
  const c = cfg?.connect;
  if (!c?.roleArn || !c?.region) return null;
  const instanceId = instanceIdFromArn(c.instanceArn);
  if (!instanceId) return null; // sin ARN no podemos llamar a la API de Connect

  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: c.roleArn,
      RoleSessionName: `vox-${tenantId}`.slice(0, 64),
      ExternalId: c.externalId,
      DurationSeconds: 3600,
    }),
  );
  const cr = assumed.Credentials;
  if (!cr?.AccessKeyId || !cr.SecretAccessKey || !cr.SessionToken) return null;

  const creds = {
    accessKeyId: cr.AccessKeyId,
    secretAccessKey: cr.SecretAccessKey,
    sessionToken: cr.SessionToken,
  };
  const client = new ConnectClient({ region: c.region, credentials: creds });
  // Mismo set de creds para S3 + DynamoDB + Customer Profiles — no cuesta
  // extra (las creds ya están asumidas) y nos ahorra round-trips a STS
  // cuando un Lambda necesita varios servicios del cliente.
  const s3 = new S3Client({ region: c.region, credentials: creds });
  const dynamo = new DynamoDBClient({ region: c.region, credentials: creds });
  const customerProfiles = new CustomerProfilesClient({
    region: c.region,
    credentials: creds,
  });
  // End User Messaging Social del cliente → WhatsApp desde SU número.
  const socialMessaging = new SocialMessagingClient({
    region: c.region,
    credentials: creds,
  });
  // Bedrock del cliente → los bots/resúmenes corren en SU cuenta (su quota).
  // Región: la del Connect por default, override con `bedrockRegion` en config.
  const bedrock = new BedrockRuntimeClient({
    region: c.bedrockRegion || c.region,
    credentials: creds,
    maxAttempts: 3,
  });
  // El domain name de Customer Profiles sigue la convención de Connect:
  // `amazon-connect-<alias>`. Lo derivamos del instanceUrl del cliente
  // (https://<alias>.my.connect.aws/ → "amazon-connect-<alias>"). El cliente
  // puede sobrescribirlo en el config con `customerProfilesDomain` si lo
  // renombró manualmente.
  // Si no podemos derivar el dominio (instanceUrl ausente/raro y sin override),
  // devolvemos "" en vez de adivinar "amazon-connect-default": el caller
  // (tenantScoped) hace skip del enrichment. NUNCA se cae al dominio de Novasys
  // porque este client ya es el del tenant (creds assumed), pero un dominio
  // adivinado que no existe solo genera ruido/ResourceNotFound.
  const customerProfilesDomain =
    c.customerProfilesDomain || deriveCustomerProfilesDomain(c.instanceUrl) || "";

  const value: TenantConnect = {
    client,
    s3,
    dynamo,
    customerProfiles,
    customerProfilesDomain,
    socialMessaging,
    whatsappPhoneNumberId: cfg?.whatsapp?.phoneNumberId || "",
    whatsappWabaId: cfg?.whatsapp?.wabaId || "",
    whatsappMode: (cfg?.whatsapp as { mode?: string })?.mode === "meta" ? "meta" : "aws",
    whatsappMetaPhoneNumberId:
      (cfg?.whatsapp as { metaPhoneNumberId?: string })?.metaPhoneNumberId || "",
    bedrock,
    instanceId,
    region: c.region,
    instanceArn: c.instanceArn,
  };
  cache.set(tenantId, { value, exp: Date.now() + 50 * 60 * 1000 }); // ~50 min
  return value;
}

type HeaderBag = Record<string, string | undefined> | undefined;

/**
 * Atajo para los Lambdas de Connect: resuelve el tenant del request y devuelve
 * SU Connect (cliente + instanceId). Si no hay tenant configurado, cae al
 * cliente/instancia legacy (los que el Lambda ya usaba contra la cuenta de Vox),
 * para que el comportamiento single-tenant actual no cambie.
 */
export async function resolveConnect(
  headers: HeaderBag,
  legacyClient: ConnectClient,
  legacyInstanceId: string,
  legacyInstanceArn = "",
): Promise<{
  client: ConnectClient;
  instanceId: string;
  instanceArn: string;
  /** DynamoDB client del tenant (mismas creds assumed). Si el tenant no
   *  configuró Connect, es `undefined` y el caller debe usar su DDB legacy.
   *  Los 11 Lambdas migrados en #43 no destructuran este campo (no rompen);
   *  los Lambdas de #46 sí lo usan para evitar un segundo round-trip. */
  dynamo?: DynamoDBClient;
  /** S3 client del tenant (mismas creds assumed). Útil para Lambdas que
   *  presignen grabaciones desde el bucket de Connect del cliente
   *  (get-contact-detail, get-customer-attachments) sin volver a STS. */
  s3?: S3Client;
  /** CustomerProfiles client + domain del tenant. Para Lambdas
   *  SearchProfiles/UpdateProfile/GetProfile contra el dominio Connect
   *  del cliente. */
  customerProfiles?: CustomerProfilesClient;
  customerProfilesDomain?: string;
  tenantScoped: boolean;
}> {
  // Step 1: resolver tenantId del JWT. NO requiere DDB → seguro contra IAM
  // limitada del Lambda. resolveTenantId no throwea (devuelve "" en error).
  const tenantId = await resolveTenantId(headers);

  // Step 2a: ANÓNIMO (sin token / token inválido) → BLOQUEADO. Cierra el leak:
  // antes caía al legacy (datos de Novasys) sin autenticación.
  if (!tenantId) {
    return {
      client: blockedConnectClient,
      instanceId: "blocked-anonymous",
      instanceArn: "",
      dynamo: blockedDynamoClient,
      // Customer Profiles BLOQUEADO + dominio "" → los Lambdas (que hacen
      // `r.tenantScoped ? r.customerProfilesDomain : LEGACY`) NO caen al
      // dominio de Novasys para un request anónimo.
      customerProfiles: blockedProfilesClient,
      customerProfilesDomain: "",
      tenantScoped: true,
    };
  }

  // Step 2b: Novasys (tenant fundador) → recursos legacy reales de Vox
  // (tablas pooled + instancia Connect hardcodeada, que son suyos).
  if (isLegacyTenant(tenantId)) {
    return {
      client: legacyClient,
      instanceId: legacyInstanceId,
      instanceArn: legacyInstanceArn,
      tenantScoped: false,
    };
  }

  // Step 3: tenant REAL → SAFE DEFAULT = ambos clients bloqueados. Si después
  // logramos leer la config y resulta que tiene Connect configurado,
  // upgradamos a tenant-scoped. Si la lectura falla por IAM (los Lambdas
  // amplify-managed tienen rol propio sin acceso a `connectview-connections`),
  // mantenemos blocked — preferimos "vacío y seguro" antes que "leak de Novasys".
  try {
    const tc = await getTenantConnect(tenantId);
    if (tc) {
      // Connect/S3/CustomerProfiles van tenant-scoped siempre (rol del paso 3
      // los habilita). El DDB depende del flag dataPlaneEnabled.
      const dataPlaneOn = await isTenantDataPlaneEnabled(tenantId);
      return {
        client: tc.client,
        instanceId: tc.instanceId,
        instanceArn: tc.instanceArn || legacyInstanceArn,
        dynamo: dataPlaneOn ? tc.dynamo : blockedDynamoClient,
        s3: tc.s3,
        customerProfiles: tc.customerProfiles,
        customerProfilesDomain: tc.customerProfilesDomain,
        tenantScoped: true,
      };
    }
  } catch (e) {
    console.error("resolveConnect: lectura de config falló, mantengo blocked:", e);
  }
  return {
    client: blockedConnectClient,
    instanceId: "blocked-no-tenant-connect",
    instanceArn: "",
    dynamo: blockedDynamoClient,
    // Tenant REAL sin Customer Profiles resuelto → BLOQUEADO, nunca legacy.
    // Cierra el leak cross-tenant: leer/escribir los perfiles de Novasys.
    customerProfiles: blockedProfilesClient,
    customerProfilesDomain: "",
    tenantScoped: true,
  };
}

/**
 * Atajo para los Lambdas que SOLO tocan DynamoDB del cliente (#46 BYO Data
 * Plane): resuelve el tenant del request y devuelve SU DynamoDBClient. Si el
 * tenant no configuró Connect (= no aplicó el CFN template, = no tiene
 * tablas en su cuenta), cae al cliente legacy → tablas pooled de Vox.
 *
 * Patrón en el handler:
 *   const dynamo = await resolveDynamo(event.headers, legacyDynamo);
 *   // reemplaza TODOS los usos de `dynamo` posteriores
 */
export async function resolveDynamo(
  headers: HeaderBag,
  legacyDynamo: DynamoDBClient,
  explicitTenantId?: string,
): Promise<{ dynamo: DynamoDBClient; tenantScoped: boolean }> {
  // Step 1: tenantId del JWT — o EXPLÍCITO, para llamadas server-to-server SIN JWT
  // (p.ej. el whatsapp-meta-webhook invocando bot-runtime con body.tenantId). Sin
  // esto esas llamadas caen a "anónimo" → blockedDynamoClient → loadBot no
  // encuentra el bot → 400. NO requiere DDB. No throwea ("" en error).
  const tenantId = explicitTenantId || (await resolveTenantId(headers));

  // Step 2a: ANÓNIMO → BLOQUEADO (cierra el leak de las tablas pooled).
  if (!tenantId) {
    return { dynamo: blockedDynamoClient, tenantScoped: true };
  }

  // Step 2b: Novasys (legacy) → tablas pooled reales de Vox (son suyas).
  if (isLegacyTenant(tenantId)) {
    return { dynamo: legacyDynamo, tenantScoped: false };
  }

  // Step 3: tenant REAL → SAFE DEFAULT = blockedDynamoClient. Las dos lecturas
  // siguientes (`isTenantDataPlaneEnabled` y `getTenantConnect`) requieren
  // DDB sobre `connectview-connections`, lo cual no todos los Lambdas
  // amplify-managed tienen permiso para leer. Si fallan, mantenemos blocked
  // — preferimos "vacío y seguro" antes que "leak de Novasys".
  try {
    if (await isTenantDataPlaneEnabled(tenantId)) {
      const tc = await getTenantConnect(tenantId);
      if (tc) return { dynamo: tc.dynamo, tenantScoped: true };
    }
  } catch (e) {
    console.error("resolveDynamo: lectura de config falló, mantengo blocked:", e);
  }
  return { dynamo: blockedDynamoClient, tenantScoped: true };
}

/**
 * Atajo para WhatsApp BYO: resuelve el AWS End User Messaging Social del tenant
 * (cliente + su phone number id) para enviar WhatsApp desde el número del
 * CLIENTE. El `explicitTenantId` es para llamadas server-to-server (p.ej. el
 * campaign-dialer, que no tiene JWT pero sí el `campaign.tenantId`).
 *
 *  - Novasys/default → cliente legacy de Vox + número del env (comportamiento actual).
 *  - tenant real con WhatsApp configurado → SU client (creds assumed) + SU número.
 *  - tenant real SIN WhatsApp / anónimo → phoneNumberId "" → el caller corta con
 *    "WhatsApp no configurado para esta organización".
 */
export async function resolveWhatsApp(
  headers: HeaderBag,
  legacyClient: SocialMessagingClient,
  legacyPhoneNumberId: string,
  explicitTenantId?: string,
): Promise<{
  client: SocialMessagingClient;
  phoneNumberId: string;
  mode: "aws" | "meta";
  metaPhoneNumberId: string;
  tenantId: string;
  tenantScoped: boolean;
}> {
  const tenantId = explicitTenantId || (await resolveTenantId(headers));

  // Anónimo (sin tenant) → sin número.
  if (!tenantId) {
    return {
      client: legacyClient,
      phoneNumberId: "",
      mode: "aws",
      metaPhoneNumberId: "",
      tenantId: "",
      tenantScoped: true,
    };
  }
  // Novasys/default → WhatsApp legacy de Vox (su número en env, modo AWS).
  if (isLegacyTenant(tenantId)) {
    return {
      client: legacyClient,
      phoneNumberId: legacyPhoneNumberId,
      mode: "aws",
      metaPhoneNumberId: "",
      tenantId,
      tenantScoped: false,
    };
  }
  // Tenant real → SU End User Messaging (AWS) o Cloud API de Meta, según su modo.
  try {
    const tc = await getTenantConnect(tenantId);
    if (tc) {
      const mode = tc.whatsappMode === "meta" ? "meta" : "aws";
      const hasNumber =
        mode === "meta" ? !!tc.whatsappMetaPhoneNumberId : !!tc.whatsappPhoneNumberId;
      if (hasNumber) {
        return {
          client: tc.socialMessaging,
          phoneNumberId: tc.whatsappPhoneNumberId,
          mode,
          metaPhoneNumberId: tc.whatsappMetaPhoneNumberId,
          tenantId,
          tenantScoped: true,
        };
      }
    }
  } catch (e) {
    console.error("resolveWhatsApp: lectura de config falló:", e);
  }
  // Tenant real sin WhatsApp configurado → sin número.
  return {
    client: legacyClient,
    phoneNumberId: "",
    mode: "aws",
    metaPhoneNumberId: "",
    tenantId,
    tenantScoped: true,
  };
}

/**
 * Atajo para LISTAR plantillas de WhatsApp BYO: devuelve el SocialMessaging del
 * tenant + su WABA Id, para que el wizard de campañas / builder de bots muestre
 * las plantillas aprobadas del CLIENTE (no las de Vox). Mismo patrón que
 * resolveWhatsApp pero con el WABA (templates) en vez del número de origen (envío).
 *
 *  - Novasys/default → cliente legacy de Vox + WABA del env (comportamiento actual).
 *  - tenant real con WABA configurada → SU client + SU WABA.
 *  - tenant real SIN WABA / anónimo → wabaId "" → el caller muestra "no configurado"
 *    (NO caemos a la WABA de Vox: mostrar plantillas ajenas llevaría a envíos que
 *    Meta rechaza porque la plantilla no existe en la WABA del tenant).
 */
export async function resolveWhatsAppWaba(
  headers: HeaderBag,
  legacyClient: SocialMessagingClient,
  legacyWabaId: string,
  explicitTenantId?: string,
): Promise<{ client: SocialMessagingClient; wabaId: string; tenantScoped: boolean }> {
  const tenantId = explicitTenantId || (await resolveTenantId(headers));
  if (!tenantId) {
    return { client: legacyClient, wabaId: "", tenantScoped: true };
  }
  if (isLegacyTenant(tenantId)) {
    return { client: legacyClient, wabaId: legacyWabaId, tenantScoped: false };
  }
  try {
    const tc = await getTenantConnect(tenantId);
    if (tc && tc.whatsappWabaId) {
      return { client: tc.socialMessaging, wabaId: tc.whatsappWabaId, tenantScoped: true };
    }
  } catch (e) {
    console.error("resolveWhatsAppWaba: lectura de config falló:", e);
  }
  return { client: legacyClient, wabaId: "", tenantScoped: true };
}

/**
 * Atajo para Bedrock BYO: los bots / resúmenes corren en la cuenta del CLIENTE
 * (su quota de Bedrock, sus modelos habilitados), no en la de Vox. El
 * `explicitTenantId` es para invocaciones sin JWT (p.ej. bot-runtime llamado
 * desde un Contact Flow del cliente, que trae el tenant en los atributos).
 *
 *  - Novasys/default/anónimo → Bedrock legacy de Vox (comportamiento actual).
 *  - tenant real configurado → SU Bedrock (creds assumed).
 *  - tenant real SIN Connect configurado → BLOQUEADO (no le prestamos la quota
 *    de Vox = leak de costo). El caller maneja el error como un AccessDenied.
 */
export async function resolveBedrock(
  headers: HeaderBag,
  legacyClient: BedrockRuntimeClient,
  explicitTenantId?: string,
): Promise<{ client: BedrockRuntimeClient; tenantScoped: boolean }> {
  const tenantId = explicitTenantId || (await resolveTenantId(headers));
  if (!tenantId || isLegacyTenant(tenantId)) {
    return { client: legacyClient, tenantScoped: false };
  }
  try {
    const tc = await getTenantConnect(tenantId);
    if (tc) return { client: tc.bedrock, tenantScoped: true };
  } catch (e) {
    console.error("resolveBedrock: lectura de config falló:", e);
  }
  // Tenant real SIN Bedrock propio → bloqueamos (antes caía a la quota de Vox).
  return { client: blockedBedrockClient, tenantScoped: true };
}

/**
 * Atajo para los Lambdas/helpers que SOLO tocan Amazon Connect Customer Profiles
 * del cliente (lookup/search/update de perfiles, enrichment de campañas, hub de
 * leads). Mismo criterio fail-closed que resolveBedrock/resolveSf:
 *
 *  - Novasys/default (legacy) → cliente + dominio legacy de Vox (sus datos).
 *  - tenant real configurado → SU Customer Profiles (creds assumed) + SU dominio.
 *  - tenant real SIN dominio CP resuelto / anónimo → BLOQUEADO (client vacío +
 *    dominio "") → NUNCA legacy/Novasys. El caller hace `if (!domainName) skip`.
 *
 * `explicitTenantId` para invocaciones sin JWT (webhooks SF, campaign-dialer):
 * el tenant viaja en el payload, no en un token.
 */
export async function resolveCustomerProfiles(
  headers: HeaderBag,
  legacyClient: CustomerProfilesClient,
  legacyDomain: string,
  explicitTenantId?: string,
): Promise<{ client: CustomerProfilesClient; domainName: string; tenantScoped: boolean }> {
  const tenantId = explicitTenantId || (await resolveTenantId(headers));

  // Anónimo (sin tenant) → bloqueado (dominio "" → el caller hace skip).
  if (!tenantId) {
    return { client: blockedProfilesClient, domainName: "", tenantScoped: true };
  }
  // Novasys/default (legacy) → Customer Profiles legacy de Vox (sus perfiles).
  if (isLegacyTenant(tenantId)) {
    return { client: legacyClient, domainName: legacyDomain, tenantScoped: false };
  }
  // Tenant real → SU Customer Profiles si tiene dominio resuelto.
  try {
    const tc = await getTenantConnect(tenantId);
    if (tc && tc.customerProfilesDomain) {
      return {
        client: tc.customerProfiles,
        domainName: tc.customerProfilesDomain,
        tenantScoped: true,
      };
    }
  } catch (e) {
    console.error("resolveCustomerProfiles: lectura de config falló:", e);
  }
  // Tenant real sin CP resuelto → BLOQUEADO (antes caía a los perfiles de Novasys).
  return { client: blockedProfilesClient, domainName: "", tenantScoped: true };
}
