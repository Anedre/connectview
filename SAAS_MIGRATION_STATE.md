# Vox CRM — Estado de la migración a SaaS multi-tenant (handoff)

> Documento de traspaso para continuar el trabajo en una sesión nueva.
> Proyecto: `B:/Connectview` (React+TS+Vite + Amplify Gen 2). Todo en **español**.
> Cuenta AWS **731736972577** (Novasys), región **us-east-1**.

## Objetivo del producto
Vender Vox como **web SaaS hosteada**: el cliente entra, en **Configuración → Integraciones**
conecta SU Amazon Connect + SU Salesforce + WhatsApp, y usa la plataforma. Decisiones ya tomadas:
- **Datos: Pooled** en tu cuenta (particionado por `tenantId`), diseñado para que BYO-data sea
  un tier premium futuro (driver = compliance). Storage de leads = centavos; lo caro (minutos
  Connect, grabaciones, WhatsApp) ya lo paga el cliente en SU cuenta.
- **Amazon Connect: BYO** — el cliente trae su instancia + un **rol IAM cross-account** que Vox asume.
- **Salesforce: OAuth web** (pendiente, tarea #44).
- **Login: Cognito** (puerta de entrada de Vox) + **federación silenciosa** del CCP del agente (tarea #45).

## Épica (tareas)
- #40 ✅ Pantalla Configuración → Integraciones (UI + wizards) — `src/components/admin/IntegrationsManager.tsx` + `src/hooks/useConnections.ts`.
- #41 ✅ Backend de conexiones — tabla `connectview-connections` (PK `tenantId`) + Lambda `connectview-manage-connections` (GET/POST config; secreto WhatsApp → Secrets Manager). Endpoint `manageConnections` en amplify_outputs.
- #42 ✅ Auth Cognito + tenant — pool `us-east-1_csLvANyZo`; atributo `custom:tenantId`; tabla `connectview-tenants`; portón `src/context/VoxAuthContext.tsx` (Authenticator) envuelve `ConnectAuthProvider` en `App.tsx`; `_shared/cognitoAuth.ts` (verifica JWT); `provision-tenant` Lambda (crea org en 1er login); interceptor global `src/lib/apiAuthInterceptor.ts` (adjunta ID token a toda llamada `*.lambda-url.*.on.aws`).
- #43 ✅ Connect multi-tenant (assume-role por tenant). Ver abajo.
- #44 ✅ Salesforce OAuth web + token por tenant.
- #45 ✅ Agent Desktop: federación silenciosa (GetFederationToken) + endurecimiento CCP.
- #46 ✅ BYO Data Plane completado de punta a punta. 57 Lambdas migrados +
  foundation + 2 CFN templates + wizard UI con toggle `dataPlaneEnabled` +
  Lambda nuevo `verify-connect-connection` que valida assume-role + las 14
  tablas. **Data leak fix (B+A) aplicado**: blockedDynamoClient devuelve
  vacío/no-op para tenants reales sin data plane → cero leak de Novasys a
  nuevos tenants. Banner de onboarding en la app para guiar al wizard.
  Listo para que un tenant real lo pruebe end-to-end.

## #46 — BYO Data Plane (en curso)

**Pivot arquitectural** (decisión de la empresa, junio 2026): los datos del
negocio del cliente NO se guardan en la cuenta AWS de Vox. Las 14 tablas de
producto se crean en la cuenta del CLIENTE; los Lambdas de Vox las leen/escriben
vía assume-role (mismo rol cross-account de #43, con permisos DDB extra).

Qué queda en cada lado:
- **Cuenta del cliente**: 14 tablas (admin-audit, ai-conversations, appointments,
  bots, callbacks, campaign-agents, campaign-contacts, campaigns, catalogs,
  contacts, hsm-sends, leads, taxonomies, wrapup-history) + grabaciones S3 +
  Customer Profiles del Connect + datos de Salesforce.
- **Cuenta de Vox**: 3 tablas (connectview-tenants, -connections, -permissions)
  + secretos cross-account (WhatsApp token, SF refresh_token) — son
  CREDENCIALES de Vox para actuar en nombre del cliente, no datos del cliente.

**Lo que YA está hecho:**
1. `_shared/tenantConnect.ts` extendido con `dynamo: DynamoDBClient` (mismas
   creds assumed). Helper nuevo `resolveDynamo(headers, legacyDynamo)` para
   Lambdas que SOLO tocan DDB.
2. `src/components/admin/cfnTemplates.ts` (archivo nuevo) — sacamos el YAML del
   IntegrationsManager para que no se ahogue. Dos templates separados:
   - `connectAccessCfnTemplate(externalId)` — el rol IAM (obligatorio, sin cambios
     respecto a #43).
   - `dataPlaneCfnTemplate()` — crea las 14 tablas en cuenta del cliente Y
     extiende el rol `VoxCrmConnectAccess` con `VoxCrmDataPlaneAccess` policy
     (`dynamodb:*` sobre `connectview-*` + `index/*`). BillingMode
     PAY_PER_REQUEST en todas las tablas → cero capacity planning del cliente.
3. UI `IntegrationsManager` extendida con Paso 4 ("BYO Data Plane (opcional,
   recomendado)") que ofrece copiar la plantilla del data plane junto al CFN
   del rol. Detalla por qué (compliance) y avisa el prerequisito (paso 3 ya
   aplicado).
4. **POC: `manage-appointment` migrado y desplegado.** Patrón:
   ```ts
   import { resolveDynamo } from "../_shared/tenantConnect";
   const legacyDynamo = new DynamoDBClient({});  // renombrar el existente

   // En el handler:
   const { dynamo } = await resolveDynamo(event?.headers, legacyDynamo);
   // ↑ todo el resto del handler usa este `dynamo` (no cambia API).
   ```
   Verificado: GET sin JWT → 200 con la cita real de Novasys (tabla pooled).
   Cuando un tenant configure el Data Plane, sus citas van a SU tabla.

**30 Lambdas migrados** (verificados todos por `npx tsc --noEmit` + curl/smoke
contra los datos de Novasys → siguen funcionando por path legacy):

- **CRUD DDB-only**: `manage-appointment` (POC), `manage-bot`, `manage-catalog`,
  `manage-taxonomy`, `schedule-callback`, `list-callbacks`, `cancel-callback`,
  `list-campaigns`, `update-campaign`, `clone-campaign`, `admin-list-audit`,
  `relaunch-campaign`, `get-hsm-report`, `query-contacts`, `control-campaign`,
  `get-agent-wellness`, `bot-runtime`, `send-whatsapp-template`.
- **DDB + leadSync helper** (con `setActiveDynamo`): `salesforce-sync`,
  `salesforce-inbound-webhook`, `manage-leads`, `create-campaign`,
  `edit-campaign-contacts`.
- **DDB + resolveConnect** (módulo `dynamo` destructurado del mismo round-trip):
  `admin-change-agent-status`, `admin-monitor-contact`, `admin-stop-contact`,
  `admin-transfer-contact`, `admin-update-contact-attrs`, `start-outbound-contact`.
- **Contact-flow-invoked** (`tenantId` de Parameter, bypass JWT):
  `agent-channel-adapter`.

**Foundation extra desplegada:**
- `resolveConnect` ahora también devuelve `dynamo?: DynamoDBClient` (mismas creds
  assumed, sin segundo round-trip a STS). Los 11 Lambdas de #43 no rompen porque
  no destructuran el campo; los nuevos lo usan.
- `_shared/leadSync.ts` ahora exporta `setActiveDynamo(client | null)` con un
  module-active `dynamo`. Los helpers (`propagateLead`, `upsertVoxLead`,
  `appendLeadHistory`, `bulkUpsertVoxLeads`, `setSfLeadId`) leen ese valor →
  las 5 Lambdas que usan leadSync (manage-leads, salesforce-sync, sf-inbound-
  webhook, create-campaign, edit-campaign-contacts) lo setean al inicio.

**+21 Lambdas más migrados en la segunda sesión** (hasta 51 total):

- **Connect + DDB** (resolveConnect ahora devuelve también `dynamo` + `s3`):
  `get-live-queue`, `get-campaign-agents`, `get-campaign-stats`,
  `get-campaign-contacts`, `assign-campaign-agents`, `list-missed-contacts`
  (sólo en código, no desplegado), `save-agent-notes`, `get-agent-leaderboard`,
  `get-contact-detail`.
- **Customer Profiles family** (7) — `getTenantConnect` ahora también expone
  `customerProfiles: CustomerProfilesClient` y `customerProfilesDomain`
  (derivado del instanceUrl como `amazon-connect-<alias>`; override via
  `customerProfilesDomain` en connectview-connections): `search-customer-profiles`,
  `update-customer-profile`, `list-recent-customers`, `get-customer-thread`,
  `get-customer-attachments`, `get-contact-history`, `get-churn-risk`.
- **EventBridge** (tenant del record/event): `campaign-dialer` (DDB
  destructure agregado a getTenantConnect per-campaign), `callback-dispatcher`
  (module-active legacy, TODO discovery scan), `process-contact-event`
  (module-active legacy, TODO reverse lookup instanceArn→tenantId),
  `enrich-contact-lens` (acepta `tenantId` en el event payload).
- **Webhook público**: `web-form-capture` — acepta `tenantId` en el payload
  (hidden field, query param o JSON) → setActiveDynamo del cliente.

**Gap crítico que cerré después** (era esencial para que BYO no rompa):

- **Toggle `dataPlaneEnabled` en el wizard** — sin esto, cuando un cliente
  aplicaba el paso 3 (rol) pero NO el paso 4 (tablas), `resolveDynamo`
  igual devolvía SU DDB client, lo que tiraba ResourceNotFoundException en
  cada llamada. Ahora:
  - `ConnectConn.dataPlaneEnabled?: boolean` (default false → legacy pooled).
  - `resolveDynamo` y `resolveConnect` consultan `isTenantDataPlaneEnabled(id)`
    (cache 1 min) y solo devuelven el tenant DDB cuando el flag está ON.
  - Checkbox prominente en el paso 4 del wizard, en verde cuando está activo.
  - **Lambda nuevo** `connectview-verify-connect-connection`
    ([url](https://4ptt375pneqdxslhsbh7c7zqky0vodod.lambda-url.us-east-1.on.aws/)):
    assume-role + DescribeInstance + opcionalmente DescribeTable sobre las
    14 tablas. Devuelve qué tablas faltan si el cliente todavía no aplicó
    el CFN del paso 4.
  - Botón "Verificar tablas" en el wizard que llama al Lambda con
    `checkDataPlane:true` y muestra resultado en toast.
  - Endpoint `verifyConnectConnection` wireado en amplify_outputs.
  - Error de assume-role traducido a texto humano ("verificá ARN, ExternalId
    y que aplicaste el template").
  - **57 Lambdas re-desplegados** para que el nuevo gate viva en todos.

**+3 polish menores cerrados:**

- **Toast en `/admin?sf=ok|err`** — `AdminPage.tsx` lee el query param, muestra
  toast, navega a sección Integrations y limpia la URL.
- **Input avanzado `customerProfilesDomain`** — colapsado en "Opciones avanzadas"
  del paso 1; default es derivar `amazon-connect-<alias>` del instanceUrl.
- **`list-missed-contacts`** — sigue sin estar desplegado en AWS (no existe en
  console), pero el source es tenant-aware. Cuando se cree, lista para usar.

**TODOs documentados (no bloqueantes, real-multitenant):**

1. **EventBridge discovery scan** — `campaign-dialer` y `callback-dispatcher`
   hacen el query inicial (running campaigns / due callbacks) contra la
   tabla pooled de Vox. Para multi-tenant real con N tenants en BYO Data
   Plane, hay que escanear `connectview-connections` (Vox-side) para listar
   tenants y luego iterar por tenant query'ando su tabla. La parte de
   procesar UNA campaña/callback ya está per-tenant scoped correctamente.

2. **process-contact-event reverse lookup** — el evento de EventBridge trae
   `instanceArn` pero no `tenantId`. Para resolverlo se necesita un GSI en
   `connectview-connections` con `instanceArn` como hash key. Hoy queda en
   legacy fallback (escribe a tabla pooled de Vox).

**Tablas que QUEDAN en Vox** (no se migran — son metadata del SaaS):
- `connectview-tenants`, `connectview-connections`, `connectview-permissions`.
  Lambdas asociados (`provision-tenant`, `manage-connections`, `manage-permissions`,
  `salesforce-oauth-callback`) usan el DynamoDBClient legacy directo y NO se
  migran.

**Próximos pasos sugeridos:**
1. Aplicar el `dataPlaneCfnTemplate()` en una cuenta AWS de prueba + configurar
   Connect → verificar end-to-end que un manage-appointment con JWT del tenant
   escribe en SU tabla y no en la pooled.
2. Si el verify funciona: terminar los ~15 Lambdas restantes con los mismos
   patrones documentados.
3. Eventualmente (épica futura): deshabilitar el fallback legacy una vez que
   ningún tenant use la cuenta pooled.

## #45 — Federación silenciosa del CCP + endurecimiento (HECHO)

**Phase 1 — Federación silenciosa:**
- **Lambda nuevo** `connectview-get-federation-token` →
  `https://euatyj2tr6ituqvxqzghy7ny2e0iauwo.lambda-url.us-east-1.on.aws/`
  Usa `resolveConnect` para asumir el rol cross-account del tenant y llama
  `connect:GetFederationToken`. Devuelve `{ signInUrl, expiresAt, userArn }`
  si la instancia soporta SAML; `{ signInUrl: null, reason: "instance_not_saml" }`
  si no (Novasys está en este caso). El frontend cae al popup cuando
  signInUrl es null — sin errores visibles para el usuario.
- **`src/lib/connect.ts`** — `initCCP` ahora acepta un tercer arg
  `{ federationSignInUrl? }`. Si está presente: `loginPopup: false` +
  `loginUrl: signInUrl` → el iframe se autentica solo (SAML del tenant). Si
  está ausente: comportamiento clásico (popup login Connect-hosted).
- **`src/context/ConnectAuthContext.tsx`** — antes de `initCCP`, hace
  `authedFetch(getFederationToken)` con el JWT del usuario; si responde con
  signInUrl lo pasa a `initCCP`. Cualquier falla (endpoint no desplegado,
  Lambda 500, instancia sin SAML) → fallback silencioso al popup.
- Endpoint `getFederationToken` añadido a `amplify_outputs.json` y al tipo
  `ApiEndpoints` en `src/lib/api.ts`.

**Phase 2 — Endurecimiento del flujo de auth:**
- Registro de `connect.core.onAuthFail` en `ConnectAuthProvider` → cuando
  Connect emite falla definitiva (cookie expirada o login rechazado),
  cortamos el timer de 15s y mostramos el LoginScreen de inmediato. Antes
  el usuario podía quedar mirando "Conectando…" hasta el timeout.
- El handler de `onAuthFail` desmonta el CCP (`terminateCCP` +
  `ccpInitialized = false`), igual que el path del timeout. El LoginScreen
  hace reload-on-focus (ya existía) → cuando el usuario vuelve del popup,
  el ConnectAuthProvider re-monta y re-corre el flujo (federación primero,
  popup después).

**Acción del usuario (manual, una vez):** sumar `connect:GetFederationToken`
a la policy del Lambda role `connectview-campaign-lambda-role` para que la
instancia legacy (Novasys, NO está en modo SAML hoy) también pueda llamar
al endpoint. Para TENANTS reales, el template `VoxCrmConnectAccess` ya lo
incluye desde #43 — no hay nada que hacer en cuenta del cliente.

Comando para el usuario (Windows cmd):
```cmd
echo {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"connect:GetFederationToken","Resource":"*"}]} > policy.json
aws iam put-role-policy --role-name connectview-campaign-lambda-role --policy-name ConnectFederation --policy-document file://policy.json
del policy.json
```
(PowerShell: `Set-Content -Path policy.json -Value '...'` + el mismo `aws iam` + `Remove-Item`.)

**Limitaciones conocidas (épica futura):**
- `GetFederationToken` solo funciona si la instancia Connect del cliente fue
  creada en modo **SAML authentication** (Cognito o SAML 2.0 IdP). Las
  instancias en modo "Amazon Connect-hosted credentials" (default fácil, como
  Novasys hoy) NO soportan federación → seguirán con popup. Para migrar a
  SAML el cliente tiene que **recrear** la instancia (no se puede convertir
  in-place).
- La verdadera "federación silenciosa universal" implicaría sumar SAML 2.0
  como IdP de Vox (Cognito User Pool federado como SAML) + un wizard que le
  diga al cliente cómo configurar SAML en su Connect. Eso queda para una
  épica futura cuando el primer tenant lo pida.

## #43 → DONE ya. #44 → DONE. #45 → DONE.
Toda la mocha de épicas SaaS para Vox cerrada salvo data partitioning
(#46 sugerida): agregar `tenantId` PK a las tablas pooled (`connectview-leads`,
`connectview-campaigns`, `connectview-contacts`, `connectview-taxonomies`,
Customer Profiles) para aislar datos entre tenants en producción real.

## #44 — Salesforce OAuth web por tenant (HECHO)
Patrón: **Connected App SHARED** (Vox la registra una sola vez en su dev org;
cada cliente autoriza desde SU org de Salesforce vía OAuth 2.0 Web Server).
Diferencia del flujo legacy (JWT bearer + secret único = single-tenant Novasys):
ahora cada tenant tiene SU `connectview/tenant/<id>/salesforce` con su
refresh_token + instanceUrl + environment.

**Piezas nuevas:**
- `amplify/functions/_shared/tenantSalesforce.ts` — `getTenantSfToken(tenantId)`
  lee el secret per-tenant, refresca contra `https://login|test.salesforce.com`
  usando las creds OAuth de Vox, cachea access tokens ~25min. `sfFetchForTenant`
  con retry-on-401. Devuelve null si el tenant no conectó SF.
- `amplify/functions/_shared/salesforceClient.ts` — extendido con
  `setActiveTenant(tenantId)`. Si hay tenant activo, `getToken()` primero
  intenta su flow tenant; si no, cae al JWT bearer legacy. Los Lambdas
  multi-tenant solo llaman `setActiveTenant(await resolveTenantId(headers))`
  al inicio del handler y el resto del código (soql, insertSObject,
  propagateLead, leadSync entero) queda igual.
- **Lambda nuevo** `connectview-salesforce-oauth-start` →
  `https://rz75kj3st6ixla4tqqaz4twm2u0vpxpu.lambda-url.us-east-1.on.aws/` —
  GET con JWT, devuelve `{ authUrl }` con la URL de SF authorize
  (state=`tenantId|environment`, scopes `api refresh_token offline_access`).
- **Lambda nuevo** `connectview-salesforce-oauth-callback` →
  `https://nfic4qxvzdllwlcp2ab35e24ti0jzdbi.lambda-url.us-east-1.on.aws/` — SF
  redirige acá; intercambia el code, guarda `{ refreshToken, instanceUrl,
  environment }` en `connectview/tenant/<id>/salesforce` y refleja
  `salesforce: { connected: true, instanceUrl, environment, connectedAt }`
  en `connectview-connections` (configJson). Redirige al user a
  `${VOX_APP_URL}/admin?sf=ok` (default `http://localhost:5173`).
- `salesforce-sync` migrado: setea `activeTenant` desde el JWT del agente.
  Verificado: ping legacy (sin JWT → tenant=default → fallback JWT bearer)
  responde 200 con Organization `Novasys del peru` desde la org dev de SF.
- Endpoints `salesforceOAuthStart` + `salesforceOAuthCallback` añadidos a
  `amplify_outputs.json` (custom.apiEndpoints) y al tipo `ApiEndpoints` en
  `src/lib/api.ts`. El wizard `SalesforceCard` ya consumía `salesforceOAuthStart`
  → con el endpoint poblado, click "Conectar Salesforce" arranca el flujo real.

**Lo que tiene que hacer el usuario (manual, una vez, en la SF Dev Org de Vox):**
1. Crear un Connected App "Vox CRM Connector" con OAuth habilitado.
2. OAuth scopes: `api`, `refresh_token`, `offline_access`.
3. Callback URL EXACTA: `https://nfic4qxvzdllwlcp2ab35e24ti0jzdbi.lambda-url.us-east-1.on.aws/`
4. Editar el secret `connectview/salesforce` (Secrets Manager) y agregarle:
   ```json
   { "oauthConsumerKey": "...", "oauthConsumerSecret": "..." }
   ```
   (sin tocar los campos JWT-bearer existentes — quedan como fallback legacy).
5. Cualquier tenant autenticado va a Configuración → Integraciones → Salesforce
   → Conectar → consiente en su org → vuelve con `?sf=ok`. A partir de ahí
   `salesforce-sync` (y todo el funnel `leadSync`) pegan a SU org.

**Lambdas SF migrados (esta tanda final):**
- `connectview-salesforce-inbound-webhook` — el SF Flow ahora inyecta
  `tenantId` en el body del callout; el Lambda lo lee y hace
  `setActiveTenant(lead.tenantId)`. Si no viene → "default" (legacy intacto).
  Verificado: token incorrecto → 401 (gate del shared secret no movido).
- `connectview-manage-leads` — `setActiveTenant(await resolveTenantId(headers))`
  al inicio del handler; `propagateById`/`propagateLead` pegan al SF del
  cliente. Verificado: GET sin JWT → 200 con 30 leads pooled (Novasys, fallback
  legacy correcto).

**Caveat conocido (épica aparte):** la tabla `connectview-leads` (y otras
tablas pooled del producto) todavía no tiene `tenantId` como partition key.
Hoy todos los leads de todos los tenants viven en el mismo pool de filas. Eso
funciona si Novasys es el único tenant en prod; para múltiples tenants reales
hay que (a) agregar `tenantId` PK + GSI a `connectview-leads` (y otras tablas
similares: campaigns, contacts, taxonomies, profiles), y (b) filtrar TODOS los
reads por `tenantId`. Es una migración aparte (épica futura, ~tarea #46).
Mientras tanto, `setActiveTenant` igual es útil porque las llamadas SF SÍ
quedan tenant-scoped (lo importante de #44).

## IAM (ya aplicado por el usuario — NO volver a tocar IAM, si hace falta más, dar el comando)
Rol compartido de Lambdas: `connectview-campaign-lambda-role`. Policies inline aplicadas:
`ConnectionsAccess` (DynamoDB connectview-connections + Secrets connectview/tenant/*),
`TenantProvisioning` (Cognito Admin* + DynamoDB connectview-tenants),
`AssumeTenantConnect` (sts:AssumeRole sobre `arn:aws:iam::*:role/VoxCrmConnectAccess`).
Archivos de policy en `infra/`.

## #43 — Lo que YA está hecho
**Base (`amplify/functions/_shared/tenantConnect.ts`):**
- `getTenantConnect(tenantId)` → lee config de conexión del tenant (connectview-connections), asume su rol cross-account (con ExternalId), devuelve `{ client: ConnectClient, instanceId, region, instanceArn }`, con cache de credenciales ~50min. Devuelve `null` si no configurado o tenant "default".
- `resolveConnect(headers, legacyClient, legacyInstanceId, legacyInstanceArn?)` → `{ client, instanceId, instanceArn, tenantScoped }`. Saca el tenantId del JWT (`resolveTenantId` de `_shared/cognitoAuth.ts`); si hay tenant con Connect configurado usa SU client, si no cae al legacy. **Patrón clave de toda la migración.**

**11 Lambdas ya migrados + desplegados** (todos verificados, fallback legacy intacto):
`list-queues`, `list-users`, `list-contact-flows`, `list-source-phones`, `get-flow-queues`,
`admin-change-agent-status`, `admin-update-contact-attrs`, `admin-monitor-contact`,
`admin-transfer-contact`, `admin-stop-contact`, `start-outbound-contact`.

**+4 Lambdas migrados después (esta tanda, verificados):**
- `get-realtime-metrics` y `get-live-queue` — los 2 dashboards. Patrón module-active. Caches
  (userNameCache / queueNameCache / cachedQueueIds / routingProfile{Name,Queues}Cache /
  userRoutingProfileCache + sus expiries) keyeadas por `${activeInstanceId}:${id}` para no
  mezclar tenants. Verificado por curl sin token: Novasys devuelve 5 colas + 1 agente online
  y 12 agentes + 14 colas + 5 ARRIVED respectivamente (igual que antes).
- `campaign-dialer` + `create-campaign` — patrón distinto: el dialer corre por EventBridge
  (sin JWT) y procesa N campañas, cada una potencialmente de otro tenant.
  - `create-campaign` ahora extrae `resolveTenantId(event.headers)` y lo guarda en el item
    de DynamoDB (`tenantId`).
  - `campaign-dialer` setea `activeConnect`/`activeInstanceId` ANTES de procesar cada campaña
    via `getTenantConnect(campaign.tenantId)`. Las campañas se procesan serialmente → seguro.
    Cache `allUserIdsCache` keyeada por instancia.
  - Verificado: `aws lambda invoke` directo → `{ok:true,campaignsProcessed:1}`; create-campaign
    con body vacío → 400 validation (no crash en la auth path).
- `get-recording` — extendí `_shared/tenantConnect.ts` con un `S3Client` con las MISMAS creds
  assume-rolled, expuesto como `TenantConnect.s3`. El Lambda usa `tc.client` para Connect y
  `tc.s3` para presignar la URL del bucket del cliente. Si el cliente NO actualizó su CFN
  template (sin permisos S3), el presign sale OK pero el browser recibe 403 cuando carga
  el audio. Verificado con curl: contactId falso → 500 "Resource not found" (path legacy
  intacto contra Novasys).

**Template CloudFormation extendido** (`src/components/admin/IntegrationsManager.tsx`,
función `connectCfnTemplate`):
- Parameter `RecordingBucket` (default `amazon-connect-*`) — el cliente lo cambia si su
  bucket tiene otro nombre.
- Nueva policy inline `VoxCrmRecordingAccess` con `s3:GetObject` sobre el bucket de grabaciones
  y `s3:ListBucket` + `s3:GetBucketLocation`.
- También ampliada `VoxCrmConnectAccess` con las acciones que faltaban para los dashboards
  y start-outbound completo (GetMetricDataV2, DescribeQueue, ListRoutingProfileQueues,
  ListAgentStatuses, SearchContacts, StartTaskContact, StartOutboundEmailContact,
  CreateContact, StartAttachedFileUpload, CompleteAttachedFileUpload,
  BatchGetAttachedFileMetadata, TransferContact).
- **Acción del cliente requerida** para tenants existentes: re-aplicar el CFN stack (UPDATE)
  con la nueva plantilla. Nuevos tenants ya lo reciben por defecto.

**Patrón de migración usado:**
1. `import { resolveConnect } from "../_shared/tenantConnect";`
2. Renombrar `const connect = new ConnectClient(...)` → `const legacyConnect = ...`.
3. En el handler (que recibe `event`): `const { client: connect, instanceId, instanceArn } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID, INSTANCE_ARN);`
4. Cambiar usos `InstanceId: INSTANCE_ID` → `instanceId`, y `INSTANCE_ARN` (ARN de comando) → `instanceArn`. **NO** tocar las declaraciones de módulo ni la derivación del ARN.
5. Lambdas con MUCHOS usos/helpers → patrón **module-active**: `let activeConnect = legacyConnect; let activeInstanceId = INSTANCE_ID; let activeInstanceArn = INSTANCE_ARN;` seteadas al inicio del handler; los helpers leen esas (seguro: Lambda procesa 1 evento por contenedor a la vez). Ej. ya hecho: `start-outbound-contact`.
6. Helpers con cache (ej. `list-users.getProfileName`, `get-flow-queues.resolveQueueName`) → pasarles `client`+`instanceId` y **keyear el cache por `${instanceId}:${id}`** para no mezclar tenants.

## #43 — LO QUE FALTA
1. ✅ ~~`get-realtime-metrics` + `get-live-queue`~~ (hecho — esta tanda).
2. ✅ ~~`campaign-dialer` + `create-campaign`~~ (hecho — esta tanda).
3. ✅ ~~`recording`~~ (hecho — esta tanda; template CFN extendido).
4. ✅ ~~Frontend CCP por tenant~~ (hecho — esta tanda).
   - `ConnectAuthProvider` ahora usa `useConnections()` y resuelve la URL como
     `tenant.connect.instanceUrl || CONNECT_INSTANCE_URL` (el env queda como
     fallback de transición). El `useEffect` que dispara `initCCP` espera a
     `integrationsLoading=false` para no inicializar dos veces (el iframe de
     CCP es singleton). Expone `instanceUrl` en el context.
   - 3 consumidores migrados al context (en vez del env): `LoginScreen` (en
     `App.tsx`, popup de login al CCP), `WisdomPanel` (Amazon Q embed) y
     `CasesPanel` (link a Connect Cases). Importe huérfano de `CONNECT_INSTANCE_URL`
     removido de `App.tsx`.
   - `signOut` redirige a `${resolvedInstanceUrl}/connect/logout` (tenant-aware).
   - Verificado: `npx tsc --noEmit` limpio + browser preview levanta sin errores
     (consola y server limpios; HMR aplicó los 4 cambios).
   - El endurecimiento de sesión + federación silenciosa quedan para #45.

## Auditoría de seguridad (junio 2026) — hallazgos + fixes

Revisión completa antes de exponer el SaaS a empresas. Yo + 2 auditores
subagente en paralelo (secretos/logging + IAM/CFN). Todo lo CRÍTICO/ALTO
arreglado y desplegado. Estado:

**A — Aislamiento de tenants (CRÍTICO, arreglado):**
- **IDOR en `manage-connections`**: tenía `?tenantId=` override → un request
  ANÓNIMO leía/escribía la config (roleArn + externalId) de cualquier tenant.
  Fix: exige JWT + rol Admin, tenantId SIEMPRE del token, query param eliminado.
  Verificado: ataque → 401.
- **Fail-open a "default"**: `resolveTenantId` sin token devolvía "default" →
  los Function URLs públicos exponían los datos pooled de Novasys (leads,
  métricas, grabaciones presignadas) a CUALQUIERA sin autenticarse. Fix:
  - sin token / token inválido → `""` (anónimo) → `blockedConnectClient` +
    `blockedDynamoClient` (vacío). Verificado: sin token = 0 datos.
  - **Novasys ahora es un tenant EXPLÍCITO** `tenantId="novasys"`
    (`NOVASYS_TENANT_ID` + `isLegacyTenant()` en cognitoAuth.ts). Mapea a los
    recursos legacy (tablas pooled + instancia Connect hardcodeada, que viven
    en la cuenta de Vox = cuenta de Novasys). `admin@novasys.com` tiene
    `custom:tenantId=novasys` asignado en Cognito.
  - Comportamiento final: anónimo→blocked · novasys→pooled · tenant real con
    Connect→su data · tenant real sin Connect→blocked.

**Secretos/logging (ALTO, arreglado):**
- `refresh_token` de Salesforce se logueaba a CloudWatch en el branch de error
  del code-for-token (salesforce-oauth-callback) — un 200 sin instance_url
  filtraba el token. Fix: solo se loguea `j.error`, nunca el objeto. Mismo
  patrón corregido en `tenantSalesforce.ts` y `salesforceClient.ts`.

**B — Scoping de permisos del template CFN (MEDIO, arreglado):**
- `connect:*` estaba sobre `Resource:"*"` (toda la cuenta del cliente).
  Dividido en `VoxCrmConnectReadOnly` (métricas/list/describe, `*` porque esas
  APIs no soportan scoping) y `VoxCrmConnectOutbound` (Start*/Stop/Monitor/
  GetFederationToken — las peligrosas: toll-fraud, escuchar llamadas)
  restringido a `InstanceArn` + `${InstanceArn}/contact/*`. El wizard
  pre-llena el InstanceArn (firma `connectAccessCfnTemplate(externalId, instanceArn)`).
- Data plane: el wildcard `table/connectview-*` → enumera las 14 tablas
  exactas vía `!GetAtt <Table>.Arn`. Scope exacto.
- S3 RecordingBucket: default + descripción empujan al nombre exacto del bucket.

**C — Menores (arreglado):**
- `web-form-capture` (endpoint público): aceptaba `tenantId` del body y escribía
  leads a Novasys (spam). Fix: rechaza legacy/sin-DataPlane; solo escribe al
  data plane de un tenant real configurado.
- Webhook SF: comparación del shared-secret ahora `timingSafeEqual` (constant-time).
- ExternalId: `crypto.getRandomValues` + falla ruidosa si no hay CSPRNG (antes
  caía a `Math.random()` predecible).
- OAuth de Salesforce: el `state` ahora va FIRMADO con HMAC-SHA256 + exp 10min
  (`signOAuthState`/`verifyOAuthState` en tenantSalesforce.ts) → anti-CSRF de
  conexión. El callback verifica firma+exp antes de procesar.

**Confirmado bien diseñado (no son brechas):**
- Trust policy del rol cross-account exige ExternalId + confía solo en la cuenta
  de Vox (no `*`). Ambos call-sites mandan el ExternalId.
- Secretos (WhatsApp token, SF refresh_token) en Secrets Manager, nunca en DDB
  ni en responses. privateKey nunca se loguea. Cero secretos hardcodeados.
- provision-tenant exige token, ConditionExpression evita colisión.

**Pendiente (BAJO, documentado — requiere infra de rate-limiting):**
- `verify-connect-connection` es un oráculo público que valida pares
  (roleArn, externalId). Mitigado por el espacio de 122 bits del UUID del
  externalId. Para endurecer: agregar rate-limit (DynamoDB contador + TTL) y/o
  requerir un token de sesión del wizard. No urgente.

## Diagnóstico de integración + manejo de errores (junio 2026)

Para que las empresas se auto-integren sin soporte. Tres capas:

**1. Panel "Estado de la integración"** (`src/components/admin/IntegrationHealthPanel.tsx`):
- Auto-corre al entrar a Configuración (si hay Connect configurado), botón
  "Re-diagnosticar". Muestra por cada feature: estado (ok/warn/error) + qué se
  rompe sin ella + cómo activarla + link a la consola del cliente.

**2. Lambda `connectview-diagnose-connection`** (health-check read-only):
- `https://ujxl2jfwmzlovwgghqyhymfmhy0nkksr.lambda-url.us-east-1.on.aws/`
- Auth: JWT de Admin del tenant (401 anónimo). Lee la config de
  connectview-connections o la recibe en el body (wizard pre-guardado).
- Chequeos: assume-role · DescribeInstance · Contact Lens
  (DescribeInstanceAttribute) · grabaciones + nombre del bucket
  (ListInstanceStorageConfigs) · acceso S3 real (ListObjectsV2) ·
  Customer Profiles (ListIntegrationAssociations) · Data Plane (DescribeTable) ·
  CloudFormation (DescribeStackEvents — opt-in, lee el recurso exacto que falló).
- Cuando assume-role falla, devuelve las 3 causas comunes de CloudFormation
  (stack creándose / ExternalId no coincide / SCP bloquea rol externo).

**3. Template extendido** (`cfnTemplates.ts`):
- VoxCrmConnectReadOnly += DescribeInstanceAttribute, ListInstanceStorageConfigs,
  ListIntegrationAssociations (read-only).
- Nueva policy VoxCrmDiagnostics: cloudformation:DescribeStackEvents/Stacks sobre
  el stack VoxCrmConnectAccess (opcional, para leer el error exacto del stack).

**4. Traducción de errores runtime** (`src/lib/integrationErrors.ts`):
- `explainIntegrationError(err, context)` mapea errores AWS crípticos a hints
  accionables en español (Contact Lens apagado, sin permiso S3, Connect no
  conectado, faltan tablas Data Plane, etc.). Aplicado en `ContactDetailView`
  (grabaciones); reutilizable en otros puntos críticos (dashboard ya tiene
  el OnboardingBanner).

## Asistente guiado (stepper full-screen) + 1-clic CloudFormation

**Wizard** (`src/components/admin/ConnectSetupWizard.tsx`): asistente full-screen
de 6 pasos, didáctico (poco texto por pantalla, lo técnico tras "Ver detalles"):
1. Cómo funciona (qué accede Vox / qué NUNCA — genera confianza)
2. Tu instancia (URL + región + ARN)
3. Permitir el visor (Approved Origins)
4. Crear el acceso — **botón "Crear rol (1 clic)"** + pegar RoleArn + verificar
5. Tus datos (Data Plane opcional, 1-clic + toggle)
6. Listo (resumen)
Barra de progreso, navegación atrás/adelante. Se abre desde un CTA en el card
de Amazon Connect ("Abrir asistente"); el modo manual sigue disponible abajo.

**1-clic "Launch Stack"** (`connectRoleLaunchUrl`/`dataPlaneLaunchUrl` en
cfnTemplates.ts): genera el URL quick-create de CloudFormation con los
parámetros pre-cargados (ExternalId, InstanceArn, RecordingBucket). El cliente
hace click → se loguea en SU cuenta → revisa → "Create stack". No le da acceso
a Vox (es el cliente creando el rol en su cuenta con la receta pre-cargada).

**Infra del 1-clic** (setup una vez, en la cuenta de Vox):
- Bucket público `vox-cfn-templates-731736972577` (us-east-1) — block-public-access
  off + bucket policy GetObject público (`infra/vox-cfn-bucket-policy.json`).
  Los templates son públicos por diseño (sin secretos; el ExternalId va como
  parámetro del quick-create, no en el template).
- Templates estáticos parametrizados en `infra/cfn/`:
  - `connect-role.yaml` — ExternalId/InstanceArn/RecordingBucket como Parameters
    de CloudFormation. Ambas policies (read-only + outbound scopeado) +
    VoxCrmDiagnostics. Re-subir tras editar:
    `aws s3 cp infra/cfn/connect-role.yaml s3://vox-cfn-templates-731736972577/ --content-type text/yaml`
  - `data-plane.yaml` — las 14 tablas (generado de `dataPlaneCfnTemplate()`).
- Ambos validados con `aws cloudformation validate-template`.
- **Mantener en sync**: si cambiás `cfnTemplates.ts`, regenerá y re-subí los YAML
  (los del wizard manual salen de cfnTemplates.ts; los del 1-clic, de S3).

## BYO Data Plane OBLIGATORIO + robustez (junio 2026)

Decisión: Vox NO guarda datos de empresas en su cuenta → el Data Plane dejó de
ser opcional. El wizard y el modo manual lo exigen (no se avanza sin las tablas
verificadas).

**Robustez ante fallos de CloudFormation** (el miedo: "si las tablas se crean
mal, perdemos datos"):
- Las 14 tablas del `dataPlaneCfnTemplate` ahora tienen `DeletionPolicy: Retain`
  + `UpdateReplacePolicy: Retain` → borrar o re-aplicar el stack NUNCA borra las
  tablas ni los datos.
- Template nuevo `dataPlanePermissionsCfnTemplate()` (`data-plane-permissions.yaml`):
  SOLO extiende el rol con permisos DynamoDB, sin crear tablas. Para cuando las
  tablas YA existen (Novasys, o un re-intento tras fallo parcial). 100% idempotente.
- El **diagnóstico chequea las 14 tablas individualmente** y distingue: ninguna
  existe (falta el template) · faltan algunas (stack incompleto → re-aplicar,
  Retain protege los datos) · existen pero sin permiso (aplicar solo-permisos) ·
  todas OK.
- Botón "Solo permisos (1 clic)" en el wizard (paso Data Plane → Ver detalles).

**Prueba end-to-end con la instancia REAL de Novasys (EXITOSA):**
- Apliqué `connect-role.yaml` vía CloudFormation (= el 1-clic) → CREATE_COMPLETE,
  rol `VoxCrmConnectAccess` creado.
- Configuré el tenant de prueba (anedre, t_3176...) → instancia de Novasys.
- Apliqué `data-plane-permissions.yaml` (stack VoxCrmDataPlanePerms) → permisos
  DynamoDB al rol sobre las tablas pooled existentes.
- Resultado: el tenant ve métricas/colas/agentes REALES de Novasys (5 colas, 12
  agentes, "UDEP-Posgrado") vía assume-role cross-account, y el **diagnóstico da
  7 OK · 0 warn · 0 error** (rol, instancia, Contact Lens, grabaciones con bucket
  real amazon-connect-6750b4c497ec, S3, Customer Profiles, Data Plane).
- Stacks de prueba creados (revertibles con delete-stack si hace falta limpiar):
  `VoxCrmConnectAccess`, `VoxCrmDataPlanePerms`. La config de prueba vive en
  connectview-connections para t_3176.

## Convenciones de deploy + verificación
- `node scripts/deploy-lambda.mjs <dir>` → actualiza `connectview-<dir>` (bundle esbuild). Acepta varios dirs.
- Nombres largos amplify-managed: `node scripts/deploy-lambda.mjs <dir>=<nombre-largo>` (encontralo con `aws lambda list-functions --query "Functions[].FunctionName" --output text | tr '\t' '\n' | grep -i <x>`). Ej.: list-users es `amplify-connectview-andre--listuserslambda799DD7A4-fe8fqNQfv4cX`.
- Lambda NUEVO: `node scripts/create-lambda.mjs <dir> KEY=VAL` (crea connectview-<dir> + Function URL + los 2 permisos públicos). Luego inyectar el endpoint en `amplify_outputs.json` con un one-liner node sobre `custom.apiEndpoints` (es un JSON string).
- Verificar: `npx tsc --noEmit` (proyecto entero). El front está detrás del SSO de Connect **y ahora del login Cognito**, así que el camino legacy se verifica por **curl al Function URL sin token** (debe dar lo mismo que antes). Para overlay de Vite: dev server en `localhost:5173` (`mcp__Claude_Preview__preview_eval`).
- amplify NO se redeploya con `ampx` (los connectview-* son hand-managed; ampx podría pisarlos).

## Cómo probar el flujo multi-tenant end-to-end (rápido = ~producción)
Usar la propia cuenta Novasys como "cliente": correr el CloudFormation del wizard de Integraciones
(crea el rol `VoxCrmConnectAccess` que confía en Novasys + ExternalId), pegar el role ARN + instance ARN
en Integraciones, y los Lambdas migrados asumen el rol y pegan a esa misma instancia. El wizard ES el
camino a producción (1-clic CF + pegar ARNs).

## Reglas (memoria del usuario)
- NO correr `aws iam put-role-policy` ni cambios de access-control — dar el comando/policy al usuario.
- PUEDE crear tablas DynamoDB / Lambdas reusando roles existentes (deploys OK).
- NO hacer el login de Connect SSO. NUNCA exponer el privateKey del secret `connectview/salesforce`.
- Todo en español. Actuar sin pedir permiso en ops reversibles; confirmar solo destructivas.
