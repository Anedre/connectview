# Consumo — calculadora de gasto Connect + Meta por tenant (Configuración → Consumo)

> Pedido (usuario, 2026-07-03): un apartado **"Consumo" en Configuración** que le explique
> al cliente cuánto está gastando en **su Amazon Connect** y en **su Meta** (WhatsApp/IG/
> Messenger conectados), con **estimación vs. lo que realmente se está cobrando**, y que lo
> explique. "¿Se podría? o es imposible?" → **Se puede** (con matices por línea).

## Por qué se puede (y dónde hay matiz)
Como el SaaS es **BYO** (cada cliente paga en SU cuenta AWS + SU cuenta Meta), lo que
mostramos ES su factura estimada, y en varios casos el **real** también es accesible:

| Fuente | Estimado | Real | Cómo se obtiene el real |
|---|---|---|---|
| **WhatsApp (Meta)** | volumen × precio | ✅ **sí** | Graph API del WABA del cliente: `conversation_analytics` (o `pricing_analytics`) devuelve el costo real por conversación/categoría. Token que ya guardamos. |
| **Amazon Connect (AWS)** | volumen × precio | ✅ **sí (build-ahead)** | AWS **Cost Explorer** (`ce:GetCostAndUsage`) sobre la cuenta del cliente, filtrado por servicio `AmazonConnect`. Requiere agregar `ce:GetCostAndUsage` al rol cross-account `VoxCrmConnectAccess` (paso de go-live del cliente). Cuenta BYO = ese costo ES del cliente. |
| **Plataforma ARIA** | volumen × precio | (interno) | Lambda/DynamoDB/Cognito de la cuenta Novasys — no se le cobra al cliente; se muestra como "incluido". |

Matiz: si el tenant NO es BYO (piloto en la cuenta Novasys), el real de AWS está mezclado
con otros tenants → ahí solo mostramos **estimación** y lo explicamos.

## Modelo de precios (fuente única)
`scripts/gen-costos-xlsx.mjs` → objeto `PRICES` (us-east-1, jun-2026). Se copian las constantes
a `_shared/pricing.ts` para que el Lambda y el script compartan los MISMOS números:
- Voz: `connectVoiceMin 0.018`/min, `telephonyInMin 0.0075`, `telephonyOutMin 0.0067`, `amdPerCall 0.0085`, `didPerDay 0.06`.
- Omnicanal: `connectChat 0.004`, `connectEmail 0.05`, `connectWBM 0.01` (WhatsApp vía Connect).
- Analítica: `contactLensMin 0.015`, `contactLensChat 0.0015`, `customerProfilesDaily 0.005`, `qConnectVoiceMin 0.008`.
- Meta: `metaWhatsAppMsg 0.02` (marketing LatAm, VERIFICAR Perú), `eumSocialMsg 0.005`.
- Bedrock (bot IA): `bedrockHaikuIn 0.0008`, `bedrockHaikuOut 0.004` (/1K tok).
- Supuestos (`ASSUME`): min/llamada 5 (in)/3 (out), bot 4 turnos × 1200/350 tok, etc.
🔑 los precios de telefonía Perú están marcados "VERIFICAR" en el modelo → en la UI van con un
disclaimer y son sobreescribibles por tenant (config).

## Volumen medible HOY (por tenant + período)
| Línea de costo | Tabla / fuente | Campo de conteo | tenant |
|---|---|---|---|
| WhatsApp HSM (plantillas) | `connectview-hsm-sends` | filas por `sentAt`, `status` | resolveDynamo |
| Conversaciones (WA/chat, in/out) | `connectview-conversations` | `messages[]` por `channel`/`direction` | pooled (legacy) |
| Bot IA (tokens Bedrock) | `connectview-ai-conversations` | `turns` × tokens supuestos | resolveDynamo |
| Campañas (llamadas marcadas) | `connectview-campaigns` + `-campaign-contacts` | `status="dialed"` por `dialedAt` | tenantId ✓ |
| Voz real (minutos in/out) | Amazon Connect `SearchContacts` | `duration` por dirección | resolveConnect |
| Grabaciones (almacenamiento) | S3 / `connectview-contacts` | tamaño (estimado) | resolveConnect |

Falta capturar (se estima): Contact Lens y Amazon Q no tienen tabla propia (se derivan de
minutos de voz × %); egreso de grabaciones (CloudTrail).

## Arquitectura
- **`_shared/pricing.ts`** (nuevo): `PRICES` + `ASSUME` compartidos (copiados del script) + helpers.
- **`get-cost-report`** (Lambda nuevo, hand-managed): `GET ?from&to` (o `?days=30`). Resuelve el
  tenant del JWT, agrega el volumen de las tablas de arriba, aplica `PRICES`, y arma líneas de
  costo agrupadas **Connect vs Meta vs Plataforma**. Para el **real**: pull WhatsApp
  (`conversation_analytics` del WABA) y Connect (Cost Explorer, si el rol tiene `ce:`; si no,
  `real: null` + motivo). Devuelve `{ lines:[{component, group, volume, unit, unitCost, estimated, real?, note}], summary:{connect,meta,platform,total,realTotal?}, currency:"USD", period }`.
- **`ConsumptionManager.tsx`** (nuevo, en AdminPage `section:"consumo"`): selector de período,
  KPIs (Connect / Meta / total), desglose por línea con columnas **Estimado | Real | Δ** + la
  explicación de cada línea, y un aviso claro cuando el real no está disponible (falta permiso
  `ce:` o número Meta) con el CTA de cómo activarlo.

## Fases
- **F1 (estimación)**: `_shared/pricing.ts` + `get-cost-report` (solo estimación) + UI. 100% verificable hoy.
- **F2 (real WhatsApp)**: `conversation_analytics` del WABA del tenant → columna "real" de Meta.
- **F3 (real Connect)**: Cost Explorer (build-ahead: `ce:GetCostAndUsage` en `VoxCrmConnectAccess`).

## Go-live (cliente)
- Real Connect: agregar `ce:GetCostAndUsage` al rol cross-account (una policy) — el CFN del rol se
  extiende (como se hizo con Bedrock/WhatsApp en [[project_byo_multitenant]]).
- Real WhatsApp: ya funciona con el token/WABA del tenant si está conectado.
- Validar precios de telefonía Perú (marcados en el modelo).

---

## ✅ CONSTRUIDO + VERIFICADO (2026-07-03) — F1 (estimación) + F2 (real WhatsApp)
- `_shared/pricing.ts` (PRICES + ASSUME compartidos) + `get-cost-report` (Lambda hand-managed,
  `connectview-get-cost-report`, campaign-lambda-role, Function URL, timeout 45s) + UI
  `ConsumptionManager` en AdminPage `section:"consumo"` + `getCostReport` en amplify_outputs.
- **Verificado en vivo (Browser 1, t_3176)**: 200 con datos reales — 30d: Connect+AWS $1.06 (voz 25
  llamadas/28 min $0.98 vía SearchContacts real, WBM 3 msg, bot 20 turnos), Meta $0.14 (7 plantillas),
  **real WhatsApp = Graph conversation_analytics** (devolvió $0.00 en el nº demo → columna Real + Δ).
  Degradación por línea OK (voz 0 en 90d por timeout cold-start → subí timeout).
- 🔑 al tocar `_shared/pricing.ts` → re-deploy `get-cost-report`. Precios = espejo de `gen-costos-xlsx.mjs`.

## ✅ F3 real de Connect (Cost Explorer) — HECHO + VERIFICADO (2026-07-03)
- `get-cost-report` → `connectRealCost()`: BYO asume el rol del tenant (`VoxCrmConnectAccess`) y
  llama `ce:GetCostAndUsage` (Granularity DAILY, filtro SERVICE = Amazon Connect + End User
  Messaging + Contact Lens) sobre SU cuenta; fundador/legacy → creds del Lambda. Global endpoint
  us-east-1. `summary.connectReal` + `realAvailable.connect`. Datos AWS con ~24h de retraso.
- **SDK**: `@aws-sdk/client-cost-explorer@3.1030.0` (NO está en el runtime) → se BUNDLEA solo en
  get-cost-report vía `EXTERNAL_OVERRIDE` (agregué soporte a `deploy-lambda.mjs`, como create-lambda).
  Redeploy: `EXTERNAL_OVERRIDE="@aws-sdk/client-dynamodb,...,node:*" node scripts/deploy-lambda.mjs get-cost-report`
  (lista TODO menos cost-explorer). Bundle 15KB→273KB.
- **IAM**: `ce:GetCostAndUsage`+`ce:GetCostForecast` en el rol cross-account `VoxCrmConnectAccess`
  (inline `VoxCrmCostExplorer`, cuenta Novasys) → el fundador t_3176 (que tiene roleArn) funciona.
  Para BYO nuevos: agregado al CFN (`cfnTemplates.ts` + `infra/cfn/connect-role.yaml`, policy
  `VoxCrmCostExplorer`) → 🔒 go-live = re-subir el yaml a S3 + tenants existentes re-aplican el CFN.
  (El rol del Lambda `campaign-lambda-role` tenía las inline/managed llenas → el ce: para legacy fue
  a la managed `connectview-whatsapp-analytics-access` v2, pero el path real usa el rol asumido.)
- **Verificado vivo (t_3176, 30d)**: estimado Connect **$1.06** vs **real $1.98** (Cost Explorer),
  `realAvailable.connect=true`, footer "Cobro real de AWS" en la UI.
