# Auditoría de código — ARIA / Connectview

**Fecha:** 2026-07-04
**Método:** 7 agentes Opus en paralelo (solo-lectura) sobre 6 frentes: seguridad backend (×2, cobertura cruzada independiente), correctitud backend, estado/hooks frontend, performance/UI, infra/config/deploy, deuda transversal.
**Alcance:** `amplify/functions/**` (~111 handlers, ~96 hand-managed) + `src/**` (370 archivos) + config/infra. Sin ejecutar deploys ni ediciones.

> **Cómo leer esto:** los hallazgos están consolidados por **severidad**, no por frente. Los marcados 🔁 fueron reportados por **≥2 agentes independientes** (alta confianza). El matiz **[HOY vs LATENTE]** distingue lo explotable ahora de lo que estalla al onboardear el 2º tenant real o al "arreglar" un token que hoy hace no-op.

---

## Resumen ejecutivo

| Severidad  | Cantidad | Titular                                                                                                                                                        |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 CRÍTICO | 8        | Fuga cross-tenant del inbox; secretos en git; webhooks Meta sin firma; `admin-*` sin auth; dialer sin cap real; supresión cross-tenant                         |
| 🟠 ALTO    | 15       | Filtro de tenant no-op en el feed; RMW sin condición (pierde mensajes/opt-outs/duplica leads); `+51` hardcodeado; iniciales re-divergidas; cero code-splitting |
| 🟡 MEDIO   | ~18      | PII en logs; sin timeout a Salesforce; open redirect; CORS `*`; cron fuera de IaC; CSS monolítico; VirtualList muerto                                          |
| 🟢 BAJO    | ~12      | Comparaciones no constant-time; `America/Lima` hardcodeada; framer-motion `mode=wait`; deps sin usar                                                           |

**Veredicto global:** el **núcleo de aislamiento multi-tenant** (`tenantConnect.ts` fail-closed, anónimo bloqueado, BYO por assume-role, secretos OAuth fuera del navegador) está **bien diseñado**. Los problemas graves se concentran en **tres focos**: (1) las **tablas pooled** (`connectview-conversations`, `connectview-leads`, `hsm-sends`) que no llevan/filtran `tenantId` y rompen ese modelo; (2) la **superficie server-to-server** (webhooks sin firma + un secreto interno en git); (3) el patrón **read-modify-write con `PutItem` del item entero sin condición**, repetido en 3 `_shared`. En frontend, el bundle es deficiente por decisiones de _bundling_ (no de código), y hay **deuda de re-divergencia** (lógica "unificada" que volvió a copiarse y desviarse).

---

## 🔴 CRÍTICO

### SEC-C1 · Fuga cross-tenant TOTAL del inbox omnicanal 🔁

`_shared/conversations.ts:608` (`listConversations`) hace `Scan` sobre la tabla pooled `connectview-conversations` **sin `FilterExpression` de `tenantId`**; el handler (`manage-conversations/handler.ts:654`) filtra solo por `ownerAgentId`. Un Admin/Supervisor de cualquier tenant ve **los WhatsApp/DMs, teléfonos y nombres de todos los tenants**.
**[LATENTE hoy]** (la tabla pooled es efectivamente single-tenant: solo Novasys). Estalla con el 2º tenant real.
**Fix:** `FilterExpression: "tenantId = :t"` + garantizar que todo `appendInbound/appendComment` persista `tenantId`.

### SEC-C2 · IDOR por `conversationId` predecible 🔁

El id es determinístico (`whatsapp#<teléfono>`). Todas las acciones (`GET`, `reply`, `typify`, `assign`, `close`, `link`) hacen `getConversation(id)` **sin comparar `conv.tenantId` contra el del solicitante** (`manage-conversations/handler.ts:625,671,691,737,784,854`). Se puede leer/responder/reasignar el hilo de otro tenant adivinando el id.
**Fix:** tras cada `getConversation`, `if (conv.tenantId && conv.tenantId !== tenantId) return bad(404)`.

### SEC-C3 · Secretos hardcodeados y commiteados a git 🔁 (confirmado por grep del coordinador)

`scripts/create-meta-lead-ads.mjs:33` (`VOX_INTERNAL_SECRET`, literal de 32 chars) y `create-meta-lead-ads.mjs:31`/`create-meta-messaging.mjs:37` (verify tokens de Meta). El `VOX_INTERNAL_SECRET` es la **única** barrera de varios Function URLs `auth=NONE` de alto poder (automation-engine, send-whatsapp-\*, backfill de leads).
**[HOY]** Cualquiera con acceso al repo tiene la llave.
**Fix (acción del usuario):** rotar el secreto y los verify tokens **ya**, moverlos a Secrets Manager / secret de despliegue no versionado, y **purgar del historial git**.

### SEC-C4 · `automation-engine` confía en `tenantId` del body

Function URL `auth=NONE`; solo valida `x-vox-internal === INTERNAL_SECRET` (no constant-time, `handler.ts:1122`) y usa `body.event.tenantId` sin JWT (`:1129`). Con el secreto de SEC-C3, un atacante dispara envíos de WhatsApp/email y muta leads **de cualquier tenant**.
**Fix:** rotar secreto + `crypto.timingSafeEqual`; a mediano plazo firmar los eventos internos o pasar el Function URL a auth IAM.

### SEC-C5 · Los 3 webhooks de Meta no validan `X-Hub-Signature-256` 🔁

`whatsapp-meta-webhook`, `meta-lead-ads-webhook`, `meta-messaging-webhook` procesan el POST sin verificar la firma HMAC del App Secret (el único `createHmac` del repo está en el feed y en tenantSalesforce). El `phone_number_id`/`page_id` que resuelve el tenant viene del body no autenticado.
**[HOY]** Forjar mensajes/leads entrantes, disparar bienvenidas a números arbitrarios, o **cuarentenar números legítimos** con `statuses[].status:"failed"` falso (DoS de deliverability).
**Fix:** validar `X-Hub-Signature-256 = HMAC-SHA256(appSecret, rawBody)` sobre el **body crudo** (ojo `isBase64Encoded`) con `timingSafeEqual`, antes de procesar.

### SEC-C6 · Handlers `admin-*` sin autenticación ni chequeo de rol

`admin-monitor-contact` (SILENT_MONITOR/**BARGE**), `admin-stop-contact`, `admin-transfer-contact`, `admin-change-agent-status`, `admin-update-contact-attrs` **no llaman `getIdentity` ni chequean `groups`**; toman `contactId`/`supervisorUserId`/`actor` del body. El frontend (`useAdminActions.ts`) hoy **no manda `Authorization`** → cae a `blocked-anonymous` → no-op.
**[LATENTE]** En cuanto se adjunte el token (paso obvio para que el botón funcione), **cualquier Agente podría escuchar/interceptar llamadas en vivo, cortarlas o transferirlas**; el `actor` del audit-trail es forjable.
**Fix:** `getIdentity` + `groups.includes("Supervisors"/"Admins")`; derivar `actor` del sub del JWT; ignorar identidad del body. Patrón de referencia correcto: `send-whatsapp-template:128-152`.

### BUG-C1 · `journey-runner` evalúa supresión sin `tenantId` → reglas de compliance cruzadas

`journey-runner/handler.ts:402` llama `evaluateSend(dynamo, {phone, channel})` **sin `tenantId`** → `getRules(undefined)` cachea bajo la pseudo-clave `_legacy` (`suppression.ts:125`). El runner procesa enrollments de todos los tenants en un contenedor caliente compartiendo quiet-hours, freq-caps y `suppressAfterConversion` del pseudo-tenant.
**Fix:** pasar `tenantId: enr.tenantId` (como ya hace `automation-engine:588`).

### BUG-C2 · `countAgentInFlight` no pagina → el dialer rompe el cap de concurrencia

`campaign-dialer/handler.ts:263` usa `Select:"COUNT"` + `FilterExpression` **sin bucle de `LastEvaluatedKey`** → `Count` es solo de la primera página (≤1 MB pre-filtro). El dialer subestima las llamadas en vuelo y **sobre-marca**, violando `maxConcurrency`/`maxPerAgent` → calienta el número y **arriesga baneo de Meta**.
**Fix:** paginar acumulando `Count`, o contador atómico por agente en la fila de campaña.

---

## 🟠 ALTO

### SEC-A1 · El filtro de tenant del feed de analytics es un no-op 🔁

`get-analytics-feed/handler.ts:94` usa `if (row.tenantId && row.tenantId !== tenantId) continue` sobre el `dynamo` plano de la cuenta plataforma, pero **los leads y hsm-sends se escriben SIN `tenantId`** (`leadSync.ts:969`, `manage-leads:990`, `send-whatsapp-template:34`). Con `row.tenantId` siempre `undefined`, el guard **nunca filtra** → cualquier holder de un token de feed recibe todos los leads/HSM/conversaciones pooled. Mismo defecto en `get-cost-report:401` (para HSM).
**Fix:** escribir `tenantId` en cada fila de leads/hsm-sends/conversations y filtrar con `if (row.tenantId !== tenantId) continue` (rechazando también las sin tenant).

### SEC-A2 · `bot-runtime` acepta `tenantId` arbitrario del body

`bot-runtime/handler.ts:759` — Function URL `auth=NONE`; `resolveDynamo/resolveBedrock` reciben `body.tenantId` sin JWT. `tenantId="novasys"` (legacy) devuelve los clientes reales → ejecutar los bots de Novasys (leer knowledge/catálogos vía RAG) y **consumir su cuota Bedrock** sin auth.
**Fix:** exigir el secreto interno (como automation-engine) para invocaciones por Function URL pública; no permitir `tenantId` legacy desde el body.

### SEC-A3 · Token del feed en query string, sin expiración ni revocación 🔁

`get-analytics-feed` — el token (HMAC fuerte, constant-time) viaja en `?token=` de un endpoint `auth=NONE` → queda en logs de acceso/proxy/referrer, y es una credencial de solo-lectura de **todo el CRM del tenant** sin `exp` ni revocación por-token (solo rotación global de `FEED_SECRET`).
**Fix:** `exp` firmado + versión de token por-tenant revocable; idealmente moverlo al header `Authorization`.

### SEC-A4 · Open redirect en `email-tracking`

`email-tracking/handler.ts:92` valida **solo el esquema** de `?u=` (`/^https?:\/\//`), no el host ni lo ata al token → `GET /click?u=https://evil` hace 302 al sitio del atacante (tu dominio como hop de phishing).
**Fix:** firmar `u` con HMAC (como el OAuth state) o resolver el destino desde el registro del token.

### SEC-A5 · `manage-suppression` y `manage-scheduled-exports` sin chequeo de rol

Aislamiento por-tenant correcto, pero **cualquier usuario autenticado** (no solo Admin) puede tocar la lista Do-Not-Contact (compliance Meta) o **programar/`runNow` un export de leads a un email externo arbitrario** (exfiltración).
**Fix:** gate `Admins` + validar dominio de `recipients`.

### BUG-A1 · Read-modify-write sin condición en `conversations.ts` (pierde mensajes) 🔁-patrón

Todo `_shared/conversations.ts` hace `get` → mutar en memoria → `PutItem` del item entero (`:249`) sin `ConditionExpression`/versión. El reaper (cron 5 min) y un `appendInbound` simultáneo se pisan: el Put del reaper (snapshot viejo) sobrescribe con `status=closed` → **se pierde el mensaje entrante** y la conversación queda cerrada sin atender. Simétrico para `appendOutbound`/`typify` concurrentes.
**Fix:** `UpdateItemCommand` con `SET`/`list_append` por campo; para el cierre, `ConditionExpression` sobre `status`/`updatedAt`.

### BUG-A2 · El reaper cierra conversaciones reactivadas

`manage-conversations/handler.ts:556` — entre el `scanOpenConversations` y el `closeConversation` (sobre muchos, con `Promise.all`) otro proceso puede tocar el hilo; el cierre **no re-verifica** la inactividad → cierra conversaciones donde el cliente acaba de escribir.
**Fix:** condicionar el cierre a `updatedAt <= :cutoff`.

### BUG-A3 · `upsertVoxLead` escanea toda la tabla + carrera de duplicados

`_shared/leadSync.ts:737,760` — cada upsert hace un `Scan` completo de `connectview-leads` + dedup en memoria por `samePhone`. Dos webhooks del mismo número casi simultáneos → ambos escanean, ninguno ve al otro → **lead duplicado** (el comentario `:762` lo admite). Además O(n) en el hot path de cada lead entrante.
**Fix:** GSI por teléfono normalizado + `PutItem` con `attribute_not_exists`.

### BUG-A4 · El marcador de automatización se escribe DESPUÉS de enviar y se traga el error

`automation-engine/handler.ts:1083` — `writeFiredMarker` corre tras las acciones y su fallo se traga en `.catch` (`:1102`). Si falla el marcador (o el lead se toca en medio), la regla **re-dispara en el próximo tick → re-envía WhatsApp/email**.
**Fix:** escribir el marcador antes de las acciones (o condicional) y no tragar el error.

### DEBT-A1 · `normalizePhone` re-duplicado con `+51` (Perú) hardcodeado

`salesforce-inbound-webhook/handler.ts:72` y `web-form-capture/handler.ts:56` reimplementan `normalizePhone` sellando `+51` a los números de 9 dígitos. El canónico `_shared/phone.ts:19` es país-agnóstico a propósito → **todo lead entrante de un tenant no-peruano queda con +51**, corrompiendo dedup, matching con SF y supresión.
**Fix:** usar `_shared/phone.ts`; país por defecto desde `configJson` del tenant si hace falta.

### DEBT-A2 · La lógica de iniciales re-divergió (bug "LE vs LA" reabierto)

Pese a la unificación en `lib/initials.ts`, hay **≥5 reimplementaciones** locales con algoritmos distintos: `QueuesPanel:57`, `CampaignMonitoringPanel:11`, `AgentActionsDialog:23` ("Ana"→"A" vs "AN"), `RecordingsShowcase:56`, `RecordingsWorkspace:80` (sin trim) → el mismo usuario con avatar distinto según la vista.
**Fix:** reemplazar por `import { initials } from "@/lib/initials"` + regla lint/grep en CI que prohíba `function initials` fuera de ese archivo.

### HOOK-A1 · `useOmnichannelNotifier` recablea listeners en cada snapshot → dings/badges duplicados

`useOmnichannelNotifier.ts:174` — el efecto depende de `[contacts]` (cambia cada ~1 s) y en cada corrida crea `new connect.Agent()` y re-suscribe `chatSession.onMessage`. Si chatjs recrea el media controller, se apilan listeners → N× `setUnreadCount`/`playDing`. Además `focusRef` se usa (`:212`) antes de declararse (`:273`).
**Fix:** suscribir una sola vez vía el event bus; dep sobre los IDs de contacto, no el array.

### HOOK-A2 · `useKeyboardShortcuts` re-suscribe el listener global por tecla + timeout sin limpiar

`useKeyboardShortcuts.ts:37` — el efecto depende de `gPending` → quita/reagrega el `keydown` global con cada cambio; el `setTimeout(800ms)` del prefijo `g` no se limpia en unmount → `setState` tras desmontar.
**Fix:** `gPending` en un `useRef`; registrar `keydown` una vez con `[]`; limpiar el timeout en cleanup.

### INFRA-A1 · Doble gestión IaC/manual: un `ampx` deploy pisa hotfixes hechos con el script

17 de 18 Lambdas registradas en `defineBackend()` también bundlean `_shared/*`. Como ambos caminos actualizan el mismo ARN, un hotfix vía `deploy-lambda.mjs` sobre una Lambda IaC (p.ej. `campaign-dialer`, `save-agent-notes`) se **revierte** al próximo `ampx pipeline-deploy`, y viceversa. Deriva silenciosa. _(Mitigado en parte: `amplify.yml` solo buildea el frontend, no corre `ampx` → un push no dispara el pisón automáticamente.)_
**Fix:** un dueño por función; no hotfixear Lambdas IaC con el script; documentar los ARNs "IaC-only".

### INFRA-A2 · `_shared/tenantConnect.ts` lo bundlean 81 Lambdas sin tooling de fan-out

El header de `deploy-lambda.mjs:12` documenta `--all-changed` pero **no lo implementa**. Tocar `tenantConnect.ts` (81 consumidores), `cognitoAuth.ts` (33), `leadSync.ts` (12) y olvidar uno = esa Lambda queda con `resolveConnect`/supresión viejos → **falla silenciosa por tenant** (RAG vacío, perfiles "blocked", verdict de supresión viejo).
**Fix:** implementar `--all-changed` real (git-diff de `_shared/*` → set transitivo de handlers) o un `redeploy-shared.mjs`.

### PERF-A1 · Cero code-splitting → chunk `index` de 5.8 MB

`App.tsx:20` importa estáticamente las 30+ páginas (0 `React.lazy` en el repo). Todo colapsa en un chunk. Lazy por ruta (FlowBuilder, Reports, Recordings, Journeys, Admin, Campaigns) → **initial load estimado −60/−70%** (~1.65 MB gz → ~500-600 KB gz).
**Fix:** `lazy(() => import(...))` por `<Route>` + `<Suspense>`.

### PERF-A2 · `echarts` completo (~330 KB gz) en el chunk inicial

`charts/EChart.tsx:2` importa `echarts-for-react` (carga todos los tipos de gráfico) y lo usa `ExecutiveView` en la home `/`. **−330 KB gz** con `echarts/core` + registro selectivo o `React.lazy` del componente.

### PERF-A3 · ~28 MB de PNGs de marca sin optimizar en `public/brand/`

`aria-avatar.png` 4.6 MB, `aria-app-icon.png` 4.5 MB, `aria-banner.png` 4.4 MB, etc. `sharp` ya está instalado. Recomprimir a WebP ≤200 KB o mover fuera de `public/` si son solo assets fuente (la app usa `aria-mark.png` 12 KB, que está bien).

---

## 🟡 MEDIO

**Seguridad**

- **SEC-M1 · PII en logs** 🔁 (seguridad + deuda): teléfonos E.164 crudos en `console.log` de `whatsapp-meta-webhook` (~8×), `meta-lead-ads-webhook:164`, `meta-messaging-webhook:250`, `campaign-dialer:594,774` → PII en CloudWatch. **Fix:** helper `maskPhone` (`+51•••••189`). _(No se loguean tokens/secretos — verificado.)_
- **SEC-M2 · Mercado Libre webhook sin firma** 🔁 (seguridad + deuda): `mercadolibre-webhook:104` `TODO(cliente): validar la firma`; `mercadolibre.ts:65` `mlFetch` haría fetch a una URL del body con el Bearer del tenant si `resource` fuera absoluta (hoy gateado por regex). ML es opcional/no usado por UDEP.
- **SEC-M3 · CORS `*` en las 89 Function URLs** (`backend.ts:371`, `create-*.mjs`): defensa en profundidad perdida. **Fix:** restringir a dominio de app.
- **SEC-M4 · Comparaciones no constant-time** en gates internos (`automation-engine:1122`, `meta-lead-ads-webhook:277`, verify tokens). **Fix:** `timingSafeEqual`.
- **SEC-M5 · Config handlers sin rol**: `manage-bot`, `manage-catalog`, `manage-knowledge`, `manage-programs`, `manage-taxonomy` — un Agente puede reescribir flujos de bot/taxonomía/catálogos de su tenant (intra-tenant).
- **SEC-M6 · Validar `leadgenId`/`pageId` como `^\d+$`** antes de interpolar en la URL de Graph; no loguear URLs con `access_token`.
- **SEC-M7 · `actor`/`updatedBy` forjable (sistémico)**: casi todos los writes de auditoría toman `actor` del body → derivar del JWT.

**Correctitud**

- **BUG-M1 · `recordSuppression` RMW pierde opt-outs**: un STOP inbound + un status-webhook de cuarentena concurrentes se pisan (Put del item entero) → puede perderse el opt-out (lo más grave en compliance). `suppression.ts:487`. **Fix:** `UpdateItem` con `ADD` a un set de canales.
- **BUG-M2 · `sfFetch`/`pushDoNotCallToSalesforce` sin timeout** (`salesforceClient.ts:167,194`): si SF cuelga, bloquea el Lambda hasta el timeout global (y puede reventar el 200 rápido que exige Meta). **Fix:** `AbortController` 5-10 s (como `actWebhook:536`).
- **BUG-M3 · `writeWaSecret`/`writeMetaSecret` TOCTOU** (`whatsappNumbers.ts:147`, `metaAccounts.ts:109`): dos guardados concurrentes de números/páginas se pisan (PutSecretValue reemplaza el mapa entero) → se pierde un token.
- **BUG-M4 · `matchesKeyword` de opt-out**: los bordes de puntuación (`suppression.ts:205`) no cubren `?;:` ni emojis → falsos negativos/positivos en STOP (compliance).

**Hooks**

- **HOOK-M1 · `useRealtimeMetrics` stale closure** (`:35`): el `catch` lee un `metrics` congelado → puede mostrar datos inconsistentes tras un fallo transitorio. **Fix:** updater funcional.
- **HOOK-M2 · `announcedRef` crece sin límite** (`useOmnichannelNotifier:127`): `Array.from(set).some()` O(n) por contacto + leak lento en sesiones largas.
- **HOOK-M3 · Doble poll de 60 s**: la campana se monta en topbar y dock → dos `useNotifications` → dos `listCallbacks`/min. **Fix:** contexto compartido o React Query.
- **HOOK-M4 · `useConnections.save()` optimista sin rollback** (`:307`): si el POST falla, la UI muestra "guardado" y revierte sola en el próximo refetch.

**Infra**

- **INFRA-M1 · Todo el cron fuera de IaC**: `journey-runner`, `program-tick`, `conversation-reaper`, warmer, `webhook-retry`, `scheduled-exports` viven en `scripts/create-*.mjs`, no en `backend.ts` → un rebuild desde IaC (DR/cuenta nueva) produce un sistema **degradado sin error visible** (journeys sin ticar, sin auto-cierre, sin warmer). **Fix:** manifiesto de infra hand-managed o migrar cron a `backend.ts`.
- **INFRA-M2 · `amplify_outputs.json` versionado y editado a mano** (89 Function URLs + IDs de Cognito): si `ampx` regenera URLs y nadie recommitea, el frontend apunta a endpoints viejos. **Fix:** tratarlo como generado en build.
- **INFRA-M3 · CI no cubre las hand-managed ni escanea secretos**: `ci.yml` = tsc/eslint/vitest/build; sin bundle-smoke de los ~96 handlers ni secret-scan (gitleaks). **Fix:** job `esbuild` dry-run + gitleaks en PR.
- **INFRA-M4 · `npm install` en `amplify.yml` vs `npm ci` en CI**: deriva entre build de Hosting y CI ante lock desactualizado.

**Performance / Deuda**

- **PERF-M1 · `index.css` monolítico** (14.7k líneas / 303 KB, todo global): `.fb-*` (235 reglas), `.vox-*`, `.camp-*`, `.rec-*` de features de 1 sola ruta cargadas siempre. **Fix:** CSS co-ubicado por feature + lazy de ruta.
- **PERF-M2 · `VirtualList` existe pero es código muerto** 🔁 (perf + deuda): bien hecho (`@tanstack/react-virtual`) pero solo lo usa su `.stories`. `LeadsPage` (board), `ContactsTable` e Inbox montan todos los ítems. **Fix:** conectarlo.
- **PERF-M3 · `vite.config.ts` sin `manualChunks`**: vendor no separado → cualquier cambio invalida el caché del vendor.
- **PERF-M4 · `@sentry/react` eager** (`main.tsx:5`): ~50-80 KB gz aunque no haya DSN. **Fix:** `await import()` dentro del `if (dsn && PROD)`.
- **DEBT-M1 · Cluster muerto `pipeline/` + `queue/`** (~24 archivos): `src/components/pipeline/*` (13) + 2 de `queue/` se importan entre sí pero nada llega desde `main.tsx`. Más `components/aria/*` (~80 exports sin uso — posible 2ª librería de UI abandonada) y sueltos: `SoftphoneDialer.tsx`, `use-mobile.ts`, `integrationErrors.ts`, `types/admin.ts`, `_shared/scoring.ts`.
- **DEBT-M2 · `pricing.ts` es copia manual 1:1 del script de costos, sin test de drift** (`_shared/pricing.ts:1`): la calculadora de Consumo que ve el cliente puede desincronizarse del modelo de negocio en silencio. **Fix:** test que compare ambas tablas.
- **DEBT-M3 · 21 deps de producción sin usar** (varios `@aws-sdk/client-*` en `dependencies` del frontend): inflan el bundle si el tree-shaking falla; superficie de supply-chain. **Fix:** mover al backend/devDeps.

---

## 🟢 BAJO (defensa en profundidad / pulido)

- **SEC-B**: `web-form-capture` sin rate-limit/CAPTCHA (spam de leads por tenant conocido); config-objects editables por no-admins (intra-tenant); IDOR intra-tenant por id (`manage-appointment`, `update-customer-profile`) — mismo tenant, bajo.
- **BUG-B1 · `wait untilRule` sin timeout** (`journeys.ts:192`): enrollments girando cada 5 min para siempre → fuga de costo lenta.
- **BUG-B2 · `journey-runner scanLeads` sin cap de páginas** (`:105,177`): con un CRM grande puede pasar el timeout y no procesar nada.
- **BUG-B3 · `hsmStatus` `expired` y `failed` comparten rank 5** (`hsmStatus.ts:22`): un `failed` tras `expired` no actualiza el `failureReason` → dato inconsistente en deliverability.
- **HOOK-B**: `CampaignActivity` key con `index` en feed prepend (`:287`); `useLiveTranscript` rama de error vacía (`:49`); `useActiveContact` `rules-of-hooks` disabled (`:996`, latente).
- **PERF-B**: framer-motion `AnimatePresence mode="wait"` (doble reconciliación por navegación) → considerar `LazyMotion`; `import * as Ph` de Phosphor (tree-shakea igual, cosmético); fuentes con **subsets no-latinos** + Geist duplicado (self-host + Google CDN) + **2 familias importadas y nunca usadas** (`index.css:9-10` ibm-plex-sans, hanken-grotesk).
- **DEBT-B**: 6+ formateadores de fecha locales con `America/Lima` hardcodeada → un tenant en otra TZ ve horas mal; toast en inglés en app española (`CommandPalette.tsx:74`); `event:any` generalizado en handlers (body no tipado).
- **INFRA-B**: push directo a `master` sin branch protection; e2e `continue-on-error` (nunca bloquea merge).

---

## Convergencias multi-agente (alta confianza)

| Hallazgo                                                       | Reportado por            |
| -------------------------------------------------------------- | ------------------------ |
| Webhooks Meta sin firma (SEC-C5)                               | seguridad ×2             |
| Inbox cross-tenant + IDOR (SEC-C1/C2)                          | seguridad ×2             |
| Filtro del feed débil / raíz sin `tenantId` (SEC-A1)           | seguridad ×2             |
| Token del feed en query string (SEC-A3)                        | seguridad ×2             |
| PII (teléfonos) en logs (SEC-M1)                               | seguridad + deuda        |
| Mercado Libre sin firma (SEC-M2)                               | seguridad + deuda        |
| Código muerto (`VirtualList`, `scoring.ts`, `components/aria`) | perf + deuda + infra     |
| RMW sin condición (patrón)                                     | correctitud (3 archivos) |

---

## Lo que está BIEN (no romper al remediar)

- `tenantConnect.ts`: clientes bloqueados fail-closed (`blockedDynamo/Connect/Profiles/Bedrock`) — la razón por la que la mayoría de gaps son intra-tenant y no anónimos/cross-tenant.
- OAuth CSRF: `salesforce-oauth-callback:185` y `meta-oauth-callback:170` verifican `state` firmado (HMAC + exp 10 min + `timingSafeEqual`).
- `sfInboundToken.ts`: token per-tenant, resuelve el tenant DEL token (constant-time), ignora `body.tenantId`.
- Higiene de secretos en runtime: **ningún token/secret se loguea ni se devuelve al navegador** (page tokens y refresh_tokens solo en Secrets Manager).
- `send-whatsapp-template:128-152`: gate anti-impersonación ejemplar (patrón a replicar en `admin-*`).
- `get-recording`: `contactId` scopeado a la instancia Connect del tenant → sin IDOR cross-tenant.
- Data-fetching: React Query con `signal`/`refetchInterval` limpio; `useMicLevels`/`softphoneTabLock`/`useCustomerNamesByPhone` con cleanup y anti-carrera correctos.
- `npm audit`: 0 vulnerabilidades; lock sincronizado; 0 `@ts-ignore`.

---

## Plan de remediación por olas

### Ola 0 — Acción del usuario (urgente, no-código)

- **Rotar `VOX_INTERNAL_SECRET` y los verify tokens de Meta** (SEC-C3); moverlos a Secrets Manager / secret de despliegue; purgar del historial git.
- Activar **branch protection** en `master` exigiendo el job `quality` verde.

### Ola 1 — CRÍTICO explotable (código, delegable a Opus)

- SEC-C5: firma `X-Hub-Signature-256` en los 3 webhooks (+ manejar `isBase64Encoded`).
- SEC-C1/C2: `FilterExpression` de tenant + check `conv.tenantId` en `manage-conversations`.
- SEC-C6: `getIdentity` + rol en los `admin-*`; `actor` del JWT.
- SEC-C4/M4: `timingSafeEqual` en los gates internos.
- BUG-C1: `tenantId` a `evaluateSend` en `journey-runner`.
- BUG-C2: paginar `countAgentInFlight`.

### Ola 2 — ALTO (código)

- SEC-A1: escribir `tenantId` en leads/hsm-sends/conversations + arreglar el filtro del feed y de `get-cost-report`.
- SEC-A2: gate del secreto interno en `bot-runtime`. SEC-A4: firmar `?u=`. SEC-A5: rol en suppression/scheduled-exports.
- BUG-A1/A2/M1: RMW → `UpdateItem` con condición en `conversations.ts` y `suppression.ts`.
- BUG-A3: GSI por teléfono para dedup de leads. BUG-A4: orden del marcador de automatización. BUG-M2: timeout a Salesforce.
- DEBT-A1: unificar `normalizePhone`. DEBT-A2: unificar `initials` + guarda de lint.
- HOOK-A1/A2: arreglar `useOmnichannelNotifier` y `useKeyboardShortcuts`.

### Ola 3 — Performance y limpieza (bajo riesgo, alto ROI)

- PERF-A1: lazy de rutas. PERF-A2: echarts selectivo. PERF-A3: recomprimir imágenes. PERF-B: podar fuentes no usadas/subsets + Geist duplicado.
- DEBT-M1: borrar el cluster muerto (~24 archivos). PERF-M2: conectar `VirtualList`. PERF-M3/M4: `manualChunks` + Sentry lazy.
- SEC-M1: `maskPhone` en todos los logs de webhooks/dialer.

### Ola 4 — Infra y proceso

- INFRA-A2: tooling `--all-changed` real + manifiesto de infra hand-managed. INFRA-M1: migrar cron a IaC.
- INFRA-M3: secret-scan + bundle-smoke en CI. DEBT-M2: test de drift de `pricing.ts`. Tests de backend para los caminos críticos (`tenantConnect`, `conversations`, `suppression`).

---

## Estado de remediación (2026-07-04)

### ✅ Ola 1 — CRÍTICOS (cerrada, desplegada, verificada)

13 Lambdas redeployados; TSC/ESLint/Build en verde. Verificación en vivo: la bandeja de Novasys sigue cargando sus conversaciones (el aislamiento no regresionó al legacy).

- **SEC-C1/C2** (aislamiento inbox), **SEC-C4/M4** (constant-time), **SEC-C6** (auth `admin-*` + `useAdminActions`), **BUG-C1** (journeys `tenantId`), **BUG-C2** (dialer paginado): hechos y desplegados.
- **SEC-C5** (firma webhooks): código desplegado, **build-ahead** — valida al crear el secret `connectview/meta` + attachear la managed policy `connectview-meta-secret-access` (ya creada) al rol. Ver `project_blocked_on_client` #6.
- **SEC-C3** (secretos en git): **acción del usuario** (rotar + purgar historial), no es código.

### 🔶 Diferidos (invasivos — requieren decisión/infra)

- **BUG-A3 (GSI de leads):** el dedup por Scan sigue; un GSI por teléfono es cambio de esquema con costo/backfill → tarea de infra aparte.
- **BUG-A1 (RMW→UpdateItem completo):** en la Ola 2 se hace solo el `ConditionExpression` del cierre; el refactor total del patch de `conversations.ts` a `UpdateItem`/`list_append` queda para un cambio dedicado (alto riesgo en un `_shared` muy bundleado).
- **Deuda de IAM:** `connectview-campaign-lambda-role` está en el límite (10 managed + inline 10240 B) → consolidar policies es prerequisito de varios go-lives.

### ✅ Ola 2 — ALTOS (cerrada, desplegada, verificada)

24 Lambdas redeployados (+ `save-agent-notes` amplify-managed con su long-name). Verificado en vivo: el feed del tenant real `t_3176` devuelve leads=38, hsm=16 (SEC-A1 activo **sin** regresión gracias al backfill).

- **SEC-A1** (tenantId en filas pooled + filtro + backfill de 37 leads/16 HSM a `t_3176`), **BUG-A2** (cierre condicional + integración del reaper), **BUG-M1** (opt-out con `ADD` a String Set + migración List→SS), **SEC-A5** (rol Admins en suppression/scheduled-exports), **BUG-M2** (timeout SF), **DEBT-A2** (iniciales unificadas), **HOOK-A1/A2**: hechos y desplegados.
- **SEC-A2** (bot-runtime gate) y **SEC-A4** (email open-redirect firmado): desplegados en **modo degradado** (sin `VOX_INTERNAL_SECRET`/`EMAIL_TRACKING_SECRET` → inertes, no rompen). Se activan al cablear el secreto + los callers/firma.
- **Descubrimiento**: `anedre123` es tenant **real** `t_3176` (no legacy) → el aislamiento no es hipotético; sus conversaciones ya llevaban `tenantId`, sus leads/HSM no (por eso SEC-A1 era real).

### 🔶 Diferidos añadidos en Ola 2

- **DEBT-A1 (`normalizePhone`)**: revertido — quitar el `+51` regresionaría a UDEP (peruano). Fix correcto = `defaultCountry` por-tenant (nuevo campo en la config del tenant) antes de onboardear un tenant no-Perú.
- **SEC-A2/A4 activación**: cablear `VOX_INTERNAL_SECRET` en bot-runtime + que los webhooks (`whatsapp-meta-webhook:519`, `agent-channel-adapter:149`) manden el header; firmar el link en `_shared/emailTracking.ts buildTrackedHtml` + setear `EMAIL_TRACKING_SECRET`. (Va junto con la rotación del secreto — Ola 0.)

### ✅ Ola 3 — perf/limpieza (cerrada, desplegada, verificada)

- **PERF-A1/A2/M3/M4/B**: bundle entry **1656→215 KB gz (−87%)**, CSS **752→398 KB (−47%)**; lazy routes, echarts selectivo, Sentry lazy, manualChunks, poda de 2 fuentes. Verificado en vivo (ruta lazy `/reports` carga bajo demanda, sin errores).
- **DEBT-M1**: 26 archivos muertos borrados (`tsc` 0). `scoring.ts` NO era muerto (lo usa `leadSync`, infra Fase 2 — la auditoría lo marcó mal en 2 frentes).
- **SEC-M1**: `maskPhone` en 14 logs de 4 handlers (redeployados).
- **PERF-A3**: imágenes `public/brand` 26.6→0.88 MB (aligera el repo; los masters no se sirven al navegador).

### Follow-ups abiertos (documentados, no aplicados)

- **Perf**: `index.html` Geist Mono duplicado (Google Fonts + self-host); `@xyflow`/echarts aún eager por `DashboardPage` (ruta `/`).
- **Correctitud**: `defaultCountry` por-tenant (para reactivar la unificación de `normalizePhone` sin `+51`); GSI de leads (BUG-A3); RMW→UpdateItem completo en `conversations.ts`.
- **Seguridad — activación** (van con la rotación del secreto): cablear `VOX_INTERNAL_SECRET` (bot-runtime + webhooks), firmar el link de email + `EMAIL_TRACKING_SECRET`, crear `connectview/meta` + policy para la firma de webhooks.

## Balance final

**3 olas, 41 Lambdas redeployados (con solapes), 8 commits, bundle −87%.** Todo lo desplegable quedó desplegado + verificado en vivo (aislamiento del inbox, feed 38/16, rutas lazy). Lo NO hecho es **consciente**: acciones del usuario (rotar secreto), fixes invasivos (GSI, RMW completo, `defaultCountry`), y activaciones build-ahead (SEC-A2/A4/C5) que esperan cableado de secretos. Ningún CRÍTICO ni ALTO quedó sin abordar salvo por decisión explícita registrada arriba.
