# Meta multi-cuenta — "Conectar con Facebook" (auto-servicio)

> Pedido: que el usuario CONECTE y ELIJA sus propias cuentas de Instagram/Messenger/
> Facebook (puede tener varias), como Chattigo/ManyChat/Respond.io. Hoy es 1 cuenta
> por tipo por tenant, cargada por detrás. Objetivo: Embedded Signup / Facebook Login.

## Estado actual (ya construido)
- `meta-messaging-webhook` recibe IG DM + Messenger + comentarios FB/IG (Pilar 6, verificado).
- **Multi-tenant ya cableado**: `findTenant(metaId)` escanea `connectview-connections` por
  `configJson.meta.pageId === metaId || meta.igId === metaId` → enruta al tenant.
- Token por tenant en Secrets Manager (`connectview/tenant/{tenantId}/whatsapp`).
- Reply por canal en `manage-conversations` (Graph API).
- **Límites**: `meta.pageId`/`meta.igId` son SINGULAR (1 cuenta/tipo). No hay UI de conexión
  (Canales dice "Próximamente"). El App de Meta central existe (932893188309221) + token system-user.

## Patrón de referencia
Mercado Libre F4.1: `mercadolibre-oauth-start` (genera URL OAuth) + callback + `MlConn` en
useConnections + tarjeta en IntegrationsManager + `manage-connections` guarda configJson.
→ Replicar ese patrón para Meta (build-ahead, go-live = App config del cliente).

## Arquitectura target
1. **Modelo** (`connectview-connections`.configJson): `meta.accounts: MetaAccount[]` donde
   `MetaAccount = { id (page/ig id), kind: "instagram"|"messenger"|"facebook", name, username?, pageId, igId?, pageToken (→secret), addedAt }`.
   Retrocompat: si existe `meta.pageId/igId` singular, tratarlo como accounts[0].
2. **OAuth Facebook Login**:
   - `meta-oauth-start`: arma `https://www.facebook.com/v21.0/dialog/oauth?client_id=APP_ID&redirect_uri=CB&scope=pages_show_list,pages_messaging,instagram_basic,instagram_manage_messages,pages_manage_metadata&state=tenant` → devuelve URL.
   - `meta-oauth-callback`: code→user token (`/oauth/access_token` con App Secret) → `/me/accounts` (páginas + page tokens) → por página `?fields=name,instagram_business_account{id,username}` → devuelve la LISTA de páginas/IG disponibles (NO guarda todavía; el usuario elige).
3. **Guardar elección**: `manage-connections` action `saveMetaAccounts` (o meta en configJson) →
   guarda las cuentas elegidas + tokens (page tokens en Secrets o en configJson cifrado).
4. **findTenant**: buscar en `meta.accounts[]` (además del singular legacy).
5. **Reply**: `manage-conversations` responde DESDE la cuenta receptora (page/ig id de la conv) con SU page token.
6. **UI** (IntegrationsManager): tarjeta "Instagram y Messenger" → botón "Conectar con Facebook"
   (abre popup OAuth) → tras callback, modal para tildar cuáles cuentas traer → lista de cuentas
   conectadas (nombre/@user/estado, quitar). Y en Canales, IG/Messenger dejan "Próximamente".

## Fases
- **F1 (backend base)**: MetaAccount type + meta-oauth-start + meta-oauth-callback (lista páginas/IG) + manage-connections saveMetaAccounts/list/remove. Deploy.
- **F2 (UI)**: tarjeta + botón OAuth + modal elegir cuentas + lista de conectadas. useConnections MetaConn.
- **F3 (enrutamiento)**: findTenant sobre accounts[] + reply desde la cuenta correcta.
- **F4 (go-live, cliente)**: App Secret en Secrets + redirect URI + productos IG/Messenger + Facebook Login en la App de Meta.

🔑 App ID Meta = 932893188309221. Redirect URI = Function URL de meta-oauth-callback (a registrar en Meta). App Secret → Secrets Manager. Lambdas hand-managed → deploy-lambda.mjs.

---

## ✅ IMPLEMENTADO (2026-07-03) — build-ahead COMPLETO y verificado

Todo el código está escrito, type-clean y lint-clean; los 3 Lambdas EXISTENTES afectados
desplegados; los 2 Lambdas NUEVOS quedan listos para el go-live (no desplegados: gated en la
App de Meta del cliente). Verificado end-to-end en el app real (Browser 1, tenant t_3176).

### Decisiones de arquitectura (importantes)
1. **Los page tokens NUNCA tocan el navegador** (mismo criterio que el refresh_token de
   Salesforce). El callback guarda las páginas + tokens en el secret del tenant bajo `pending`;
   el front lista las páginas SIN tokens (`listMetaAccounts`) para tildar; al confirmar
   (`saveMetaAccounts`) el backend mueve solo los tokens elegidos a definitivos y limpia el
   pending. `removeMetaAccount` borra metadata + token.
2. **Los 2 Lambdas nuevos son hand-managed** (NO resource.ts/backend.ts/ampx). El patrón real del
   repo para OAuth/webhooks es `scripts/create-*.mjs` (`aws lambda create-function` + rol
   `campaign-lambda-role` + Function URL) — igual que salesforce-oauth-start/-callback y
   mercadolibre. → `scripts/create-meta-oauth.mjs` (idempotente) provisiona ambos. **NO correr
   hasta el go-live.**
3. **Retrocompat**: `_shared/metaAccounts.ts` `normalizeMetaAccounts()` trata el legacy singular
   (`meta.pageId/igId`) como accounts[0]. El frontend lo espeja con `effectiveMetaAccounts()`.
   Verificado: t_3176 (que tenía `meta.pageId` de "Novasys del Perú S.A.C." + su IG) aparece como
   1 cuenta conectada sin migrar nada.

### Modelo
- `configJson.meta.accounts: MetaAccount[]` (`{ id=pageId, pageId, pageName?, igId?, igUsername?, addedAt? }`).
- Secret `connectview/tenant/<id>/meta` = `{ pending?: {at, pages:[{...pageToken}]}, pageTokens: {[pageId]:token} }`.
- Conversación: nuevo campo `metaAccountId` (= entry.id del webhook = page/ig id RECEPTOR) para
  responder desde la cuenta correcta.

### Archivos
- **Nuevos**: `_shared/metaAccounts.ts` (modelo + helpers de secret + normalización);
  `functions/meta-oauth-callback/handler.ts` (F1b); `scripts/create-meta-oauth.mjs` (provisión).
- **F1a previo**: `functions/meta-oauth-start/handler.ts`.
- **EXISTENTES tocados + redesplegados** (bundlean metaAccounts.ts): `manage-connections`
  (acciones list/save/removeMetaAccounts), `meta-messaging-webhook` (findTenant sobre accounts[]
  + metaAccountId), `manage-conversations` (getTenantMeta + `resolveMetaAccount()` → reply/media/
  read-receipt/survey/cortesía desde la página receptora). `_shared/conversations.ts` (+metaAccountId).
- **Frontend**: `useConnections.ts` (MetaConn/MetaAccountRef + `meta?`), `lib/api.ts`
  (metaOAuthStart/Callback), `IntegrationsManager.tsx` (`InstagramMessengerCard`: Conectar con
  Facebook → modal tildar → lista conectadas/quitar), `ChannelsManager.tsx` (IG/Messenger activos,
  ya no "Próximamente"; solo SMS queda).

### 🔒 Go-live (cliente + operacional, NO código)
1. `aws secretsmanager create-secret --name connectview/meta --secret-string '{"appId":"932893188309221","appSecret":"<SECRET>"}'`.
2. `node scripts/create-meta-oauth.mjs` (con el sandbox de amplify off) → imprime las 2 Function URLs.
3. Pegar las URLs en `amplify_outputs.json` → `custom.apiEndpoints.metaOAuthStart`/`metaOAuthCallback` (commit + build front).
4. En la App de Meta: activar *Facebook Login for Business* + registrar el callback URL como "Valid OAuth Redirect URI".
   (En dev, ajustar `APP_URL` en el script al host del front.)

🔑 Al tocar `_shared/metaAccounts.ts` → re-desplegar los 3 (manage-connections, meta-messaging-webhook,
manage-conversations) con `node scripts/deploy-lambda.mjs <folder>`.
