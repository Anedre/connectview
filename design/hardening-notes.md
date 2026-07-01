# Hardening / pase de seguridad (F5.6)

> Repaso de seguridad pre-go-live: IAM, superficie pública, secretos, rate-limits,
> aislamiento de tenant. Estado actual + TODOs. No es un audit formal; es la lista
> de lo que hay que mirar antes de producción. Ver design/fase-5.md §F5.6.

## IAM / roles

- **`connectview-campaign-lambda-role`** es el rol compartido de casi todos los Lambdas.
  Está **saturado** (10 managed + ~10 KB de inline). ⇒ accesos nuevos se **foldean** en un
  inline existente (patrón `LeadsAccess`), NO se crean policies nuevas. Permisos scopeados por
  ARN donde importa (ej. `WhatsAppSend` = `social-messaging:SendWhatsAppMessage` sobre UN
  `phone-number-id`; `TenantSecrets` = `connectview/tenant/*`).
- **`VoxCrmConnectAccess`** (rol asumido del tenant) hace las llamadas a DynamoDB del tenant en
  BYO. Las pruebas con curl anónimo NO ejercen sus permisos (caen antes) → verificar con fetch
  autenticado. [[reference_new_lambda_iam]]
- **TODO:** cuando el inline del campaign-role llegue al límite de 10 KB, partir el rol
  (rol de "data-plane" vs "connect-ops"). Hoy no bloquea.

## Superficie pública (Function URLs auth NONE)

Los webhooks son **públicos a propósito** (los llaman servicios externos). Mitigaciones por endpoint:

| Endpoint                                           | Protección                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `meta-messaging-webhook` / `whatsapp-meta-webhook` | verify token (GET) + resuelve tenant por page/phone id                  |
| `mercadolibre-webhook`                             | URL secreta · **TODO: validar firma** (necesita app secret del cliente) |
| `email-tracking` (pixel/click)                     | token opaco · 404 silencioso anti-enumeración                           |
| `*-oauth-start` / `salesforce-oauth-callback`      | state firmado (HMAC + exp) anti-CSRF                                    |

Los endpoints **de datos** (manage-_, get-_) exigen **Bearer de Cognito** (`resolveTenantId`); un
invoke anónimo cae a tenant vacío y es no-op de escritura. [[reference_lambda_anonymous_write_noop]]

- **TODO:** rate-limit en los webhooks públicos (reserved concurrency o WAF) para acotar abuso.
  Hoy los handlers son **idempotentes** (updateHsmStatus avanza por rank, appendInbound upsert,
  incrementCampaignConversion idempotente) → un reintento/duplicado no corrompe estado.

## Secretos

- Todo lo sensible vive en **Secrets Manager**: `connectview/tenant/<id>/{whatsapp,salesforce,
mercadolibre,sf-inbound}`, `connectview/salesforce`, `connectview/mercadolibre`. **Nunca** en
  DynamoDB ni en el navegador — el `configJson` guarda solo flags (`tokenSet`, `clientSecretSet`).
- Tokens OAuth mostrados **una sola vez** (SF inbound token, etc.) con aviso.

## Aislamiento de tenant

- Tablas pooled keyed por `tenantId` (o `channel#senderId` con `tenantId` en el item). Los
  handlers resuelven `tenantId` del JWT y filtran. BYO: assume-role a la cuenta del tenant.
- **Supresión / opt-out**: gate `fail-open` (si el check falla, no bloquea el negocio) —
  aceptable para marketing; el gate de VOZ es más estricto. [[project_pilar3_supresion]]

## CI / gate de regresión (F5.6)

- `.github/workflows/ci.yml`: **quality** (typecheck + **lint** + unit + build) **bloqueante**;
  **e2e** no-bloqueante (autenticado gateado por secretos `TEST_EMAIL`/`TEST_PASSWORD`).
- **Deuda de lint quemada:** los ~97 errores de `eslint .` se fueron a 0 (dead code removido +
  `no-unused-vars` con patrón `^_`). Las reglas advisory del React Compiler
  (`set-state-in-effect`, `purity`, `exhaustive-deps`…) quedaron como **warning** (87, visibles, no
  fallan el build) — son guía, no bugs de correctitud. El lint ya es parte del gate bloqueante.
