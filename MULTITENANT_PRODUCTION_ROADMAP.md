# ARIA · Roadmap a Multi-Tenant Production-Ready + Independiente

> Objetivo: que **cualquier cliente** se onboardee solo, sobre **su propia cuenta AWS**,
> sin código ni datos acoplados a Novasys/UDEP, y que el plano comercial (cobro,
> planes, límites) exista. Hoy la base BYO está; faltan piezas concretas.

**Leyenda de estado:** ✅ hecho · 🟡 en curso · ⬜ pendiente · 🔒 bloqueador funcional
**Responsable:** `[code]` = yo (reversible, CLI/código) · `[aws]` = consola del cliente · `[dec]` = decisión de negocio

---

## ✅ Ya está (base BYO multi-tenant)
- Identidad Cognito + `tenantId` del JWT; provisión de org al primer login.
- Cross-account assume-role (`VoxCrmConnectAccess` + ExternalId) por tenant.
- Resolvers por tenant: Connect / DynamoDB / S3 / CustomerProfiles / WhatsApp / Salesforce / Bedrock.
- Aislamiento **fail-closed**: tenant real sin config → bloqueado (no ve datos de Novasys).
- Wizard de onboarding Connect + CFN 1-clic (rol + 14 tablas) + panel de diagnóstico.
- Config + secretos por tenant (`connectview/tenant/<id>/*`).
- Path WhatsApp Meta-directo (plantillas + bots por webhook).

---

## 1. ✅ Provisión de contact flows por tenant — *bloqueador #1* (FUNCIONAL + probado; resta polish)
Sin flows en la instancia del tenant, **no entra ni un contacto**. Los flows eran UDEP-específicos.
- ✅ `[code]` Inventario: 94 flows en la instancia (compartida, mezcla de clientes). No hay set canónico limpio → se autorea uno genérico. Patrón del Content JSON entendido (Actions + QueueId + TransferToFlow).
- ✅ `[code]` Set canónico **parametrizable** como **builders** (objetos JS → JSON.stringify, sin string-replace → cero líos de escaping/emoji): `ARIA-Inbound`, `ARIA-Outbound`, `ARIA-Disconnect`. Cola = la default del instance resuelta por nombre; textos desde `messaging.*`.
- ✅ `[code]` Lambda **`connectview-provision-contact-flows`** (deployada, Function URL): auth admin (JWT), `getTenantConnect` (cross-account), resuelve cola, crea/actualiza los 3 flows, guarda IDs en `config.contactFlows`. Tiene `dryRun` (default true por seguridad).
- ✅ `[verify]` **Validado contra la instancia real**: resolvió `BasicQueue` (de 14) y Connect **aceptó el `CreateContactFlow` de los 3** (Content válido); creados y borrados limpio.
- ✅ `[code]` Schema `ContactFlowsConfig` + permisos `connect:CreateContactFlow`/`UpdateContactFlowContent`/`DescribeContactFlow` agregados al CFN del rol del tenant.
- ✅ `[code]` Botón "⚡ Provisionar flows" en `IntegrationsManager` (Connect card, tras verificar) + endpoint registrado (`api.ts` + `amplify_outputs.json`). Usa `authedFetch` (JWT admin).
- ✅ `[code]` Permisos aplicados al rol existente de Novasys: política inline `VoxCrmContactFlowProvisioning` (Create/Update/Describe ContactFlow).
- ✅ `[verify]` **Path completo PROBADO end-to-end**: assume-role (ExternalId, trust `:root`) → ListQueues → **CreateContactFlow vía rol assumed OK**. Es exactamente lo que hace el Lambda al tocar el botón. Instancia limpia.
- ⬜ `[code]` (polish) Cablear campañas para *defaultear* al `ARIA-Outbound` provisionado (hoy ya aparece en el dropdown de flows; falta pre-seleccionarlo).
- ⬜ `[code]` (futuro) Flows con Lambda/Lex (bot entrante) + multi-cola por atributo.

## 2. Des-Novasys-ificar — *la "independización"* — 🟡 en curso
~183 refs a Novasys/UDEP en 57 archivos (parte comentarios, parte contenido hardcodeado).
- 🟡 `[code]` Esquema de config por tenant: agregado `messaging` (`MessagingConn`) + `contactFlows` a `ConnectionsConfig`. Falta `branding`.
- ✅ `[code]` Despedida de chat (UDEP) → config del tenant. `CCPContext` la lee de `messaging.chatFarewell` (vía `ConnectAuthContext`), con default **genérico sin marca** en código. Novasys conserva su texto UDEP **sembrado en SU config** (no en el código). *(Falta deploy de frontend para que aplique en prod.)*
- ✅ `[code]` **Card "Mensajes"** en Integraciones: el tenant edita su despedida (self-service). Vacío → default genérico.
- ✅ `[code]` `chatTemplates`: `saludo-udep`→`saludo-comercial`, `info-requisitos`→`info-ampliar` (genéricos). El resto ya era genérico.
- ✅ `[code]` `UDEP_DEFAULT`→`DEFAULT_DISPOSITIONS` (símbolo + comentarios; contenido data-safe, overridable por DB). 
- ✅ `[code]` Default de campañas: `UDEP-Outbound-Smart` → prefiere `ARIA-Outbound` provisionado (compat fundador como fallback).
- ✅ `[code]` `AdminPage`: los links "Gestionar/Abrir en Connect" hardcodeados a `https://novasys.my.connect.aws` → ahora usan la instancia del tenant (`useConnectAuth().instanceUrl`).
- 🟡 `[security]` Dominio CP `amazon-connect-novasys` hardcodeado en ~9 Lambdas de Customer Profiles → **leak cross-tenant clase #3** (un tenant real sin CP cae a los perfiles de Novasys). **Flageado como tarea** (`task` Customer Profiles) para fix fail-closed. No explotable hoy (solo vive el fundador, que tiene su CP correcto).
- ⬜ `[minor]` Defaults menores: `get-contact-detail` `INSTANCE_ALIAS || "novasys"` y similares.
- ⬜ `[deep]` `CustomerProfilePanel`: keys de atributos `udep_*` (data-coupled con los flows del fundador → skip; degradan bien).
- ✅ `[code]` `branding.productName` por tenant = **white-label MVP** (sidebar + título). Logo/colores = follow-up. Ver #8.

## 3. ✅ Quitar los fallbacks legacy que filtran (multi-tenant real) — HECHO + deployado
SF / Bedrock caían al recurso **compartido de Novasys** si el tenant no conectó el suyo (Connect/DDB/WhatsApp ya eran fail-closed).
- ✅ `[code]` `resolveSf`/`salesforceClient`: tenant real sin SF propio → **bloqueado** (`SF_NOT_CONNECTED`); `setActiveTenant` mapea ambos alias del fundador (default+novasys) vía `isLegacyTenant`. `propagateLead` lo tolera (best-effort) y el read-mode lo traduce a "no conectado".
- ✅ `[code]` `resolveBedrock`: tenant real sin config → `blockedBedrockClient` (error claro, manejado como AccessDenied). Founder/anónimo → legacy.
- ✅ `[code]` Deployado en 8 Lambdas (bot-runtime, generate-call-summary, salesforce-sync/-inbound-webhook, manage-leads, web-form-capture, create-campaign, edit-campaign-contacts).
- ✅ `[catch]` **Regresión detectada y corregida**: el tenant de producción de Novasys corre como tenant REAL `t_3176…` (instancia `novasys.my.connect.aws`, BYO data plane) pero su Salesforce ES la org master legacy (`connectview/salesforce` = "Novasys del peru"). El fix inicial lo bloqueó → habría roto su SF sync. Solución: allowlist `MASTER_SF_TENANT_IDS` (env, NO hardcode; solo para SF, no toca `isLegacyTenant` global → su data plane BYO sigue intacto). Verificado: ping SF → 200, org "Novasys del peru". Bedrock NO regresionó (usa su rol assumed → cuenta novasys).
- ⬜ `[code]` (pendiente) Tests/asserts de que un tenant real nunca recibe un client legacy.
- ⬜ `[code]` (deuda) Migrar Novasys a OAuth SF per-tenant para retirar el allowlist y el secret master.

## 4. 🟡 Completar BYO en features nuevas
- ✅ `[code]` Detección de números WhatsApp con el **rol asumido del tenant** (antes solo veía la cuenta plataforma). `manage-connections` ahora usa `getTenantConnect(tenantId).socialMessaging`; agregué `social-messaging:ListLinkedWhatsAppBusinessAccounts` (faltaba) al rol de Novasys + al CFN. **Deployado + verificado** (API + rol assumed). Legacy → cliente plataforma.
- 🟡 `[code]` Dominio Customer Profiles: **verificación ✅** (el diagnóstico ya hace `GetDomain` y reporta si falta/sin permiso). Provisión (auto-`CreateDomain`) queda como follow-up (tiene opciones de config: expiración/KMS/DLQ).
- ✅ `[code]` **Diagnóstico Bedrock** (deployado): el panel de salud invoca el modelo actual (Haiku 4.5) con `max_tokens=1` vía el rol del tenant; si falla por acceso → "modelos no habilitados" + remediación (consola Bedrock → Model access). *(De paso: detecté que el modelo de fallback de los bots era Legacy → tarea aparte para cambiarlo.)*

## 5. Billing / metering / planes — *lo comercial*
No existe sistema de cobro/medición.
- ⬜ `[code]` Metering de uso por tenant (agentes activos, mensajes, llamadas IA).
- ⬜ `[code]` Entitlements por plan (Starter/Pro/Enterprise) que gateen features.
- ⬜ `[dec]` Cobrador (Stripe/etc.) o facturación manual al inicio.
- ⬜ `[code]` Límite de agentes/uso por plan + enforcement.

## 6. 🟡 Aislamiento (defense-in-depth) — auditado
- 🟡 `[audit]` Rol compartido `connectview-campaign-lambda-role`: confirmado `secretsmanager:GetSecretValue` sobre `connectview/tenant/*` (wildcard = TODOS los tenants). **Mitigado en código**: el tenantId sale SIEMPRE del JWT verificado y nombra el secret → leer otro tenant exige forjar el JWT (inviable). Es el patrón estándar de compute pooled. *Hardening futuro*: ABAC (session tags + condición `ResourceTag/tenantId == PrincipalTag/tenantId`).
- ✅ `[audit]` Tabla *pooled*: **NO es riesgo**. `resolveDynamo` da las tablas pooled SOLO al tenant legacy (Novasys); un tenant real sin BYO data plane → `blockedDynamoClient` (nunca escribe en pooled). Las pooled son **mono-tenant (Novasys)** por diseño → no necesitan partición por tenantId.

## 7. Operacional / lifecycle
- ⬜ `[code]` Observabilidad por tenant (logs/métricas/alertas etiquetadas).
- ⬜ `[code]` Lifecycle: suspender / eliminar tenant (con borrado de datos + secretos).
- ⬜ `[code]` Throttling por tenant.
- ⬜ `[code]` Migraciones del data plane (cómo actualizar las 14 tablas en todas las cuentas BYO).
- ⬜ `[dec]` Multi-region (hoy todo `us-east-1` hardcodeado).

## 8. 🟡 Branding / white-label — MVP hecho
- ✅ `[code]` **Nombre de producto por tenant** (`branding.productName`): la **sidebar** + el **título de la pestaña** muestran la marca del tenant (default "ARIA"). Config (`BrandingConn`) + `ConnectAuthContext` (expone `productName` + setea `document.title`) + card **"Marca y mensajes"** en Integraciones. Post-login solamente.
- ⬜ `[code]` **Logo por tenant** — necesita storage/upload (S3 + presigned).
- ⬜ `[code]` **Color de acento por tenant** — theming de la paleta `--accent-*` (override de CSS vars).
- ⬜ `[dec]` **Custom domain por tenant** → habilitaría branding también en el **login/splash** (hoy son pre-login: no sabemos el tenant antes de autenticar).

## 9. 🔴 Onboarding asistido: ARIA crea Connect EN LA CUENTA DEL CLIENTE — *bloqueador comercial #1*
Descubierto al probar una 2da cuenta (525033346104, sin Connect). Hoy el onboarding es **BYO manual** (asume que el cliente YA tiene Connect montado → casi nadie).
**DECISIÓN (fundador):** ❌ NADA pooled / nada de la empresa vive en ARIA/Novasys. ✅ Todo SIEMPRE en la cuenta del cliente; ARIA solo **automatiza la creación** de Connect dentro de SU cuenta vía el rol cross-account. Aislamiento 100%. *(Coincide con lo ya construido: el BYO data plane ya mantiene los datos de los tenants reales en su cuenta; las tablas pooled son solo del fundador.)*
- ✅ `[dec]` **Modelo definido:** un solo carril → **provision-into-client-account** (no pooled, no managed-en-Novasys).
- ⬜ `[code]` **Rol con permisos de provisión**: el CFN del tenant debe conceder `connect:CreateInstance` + reclamar número + `connect:CreateQueue/CreateRoutingProfile/CreateHoursOfOperation` + S3 (instance storage). Hoy el rol es read + Create/Update ContactFlow.
- ⬜ `[code]` **Pipeline de provisión** (Lambda): `CreateInstance` → esperar Active → reclamar/asignar número → colas/RP/horarios → **flows ✅** (`provision-contact-flows`) → data plane (CFN ya existe).
- ⬜ `[req]` **Lo mínimo que queda en el cliente:** tener una cuenta AWS **verificada** (con método de pago — Connect y reclamar números no andan en free/unverified, lo vimos) + aplicar el CFN (1 clic). Crear/verificar la cuenta AWS es de ellos; ARIA lo guía pero no lo hace.

---

## Orden de ejecución sugerido
1. **#1 contact flows** (sin esto el BYO no arranca solo).
2. **#2 des-Novasys-ificar** (config de branding/templates por tenant).
3. **#3 quitar fallbacks legacy** (aislamiento real).
4. **#4 completar BYO** en features nuevas.
5. **#5 billing + entitlements**.
6. **#6–8** aislamiento fino, lifecycle, white-label.

_Última actualización: 2026-06-07_
