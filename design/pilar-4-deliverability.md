# Pilar 4 — Deliverability & salud del número · Diseño técnico

> Solución completa para **R5** (estado de entrega real de WhatsApp: sent/delivered/read/failed, P0) y sube **#13** (Quality Rating + Messaging Limits) / **#14** (`whatsapp-status-webhook`). Convierte el estado crudo en **acción** (cuarentena del número malo → puente con Pilar 3, alerta de salud). Ver `REQUERIMIENTOS-UDEP-MEJORAS.md` (Pilar 4) y `REQUERIMIENTOS-UDEP-2026-06-17.md` (R5). Aterrizado en el estado actual (mapeo abajo) — incluye un hallazgo de infra que define la arquitectura.

## 0. Qué pidió el cliente
Adriana: **saber si el mensaje se entregó / falló / número equivocado** — "base de todo reporte de WhatsApp". Chattigo se lo da (captura 05: delivered 91% · read · replied · failed · expired · pending por envío). Hoy ARIA registra solo `sent`.

**Lo que entregamos (no mostrar estados, sino actuar):** ciclo de vida por mensaje cuando el canal lo permite, **cuarentena automática** de números inválidos (los excluye a futuro vía el motor del Pilar 3 — Adriana ya no los caza en el Excel), y un **monitor de salud del número** (quality rating + alerta) que protege la cuenta de Meta.

---

## 1. Estado actual (mapeo) — y el hallazgo de infra que manda

**Lo que existe:**
- **`connectview-hsm-sends`** (PK=`sendId` = el `messageId` del envío): `phone`, `phoneDigits` (Pilar 3), `templateName`, `language`, `campaignId`, **`status` (siempre `"sent"`)**, `sentAt`. **NUNCA se actualiza** — no hay un solo `UpdateItem` contra esta tabla en todo el repo.
- **`get-hsm-report`** ya agrega por plantilla con buckets `["sent","delivered","read","failed","expired","pending"]` + `readRate`/`failRate` — **la lógica está completa, solo faltan los datos** (hoy todo cae en `sent`). `HsmOutboundReport.tsx` suma los 6 como "Enviados" (no muestra columnas por estado) y tiene un comentario honesto: "delivered/read viven en Meta WhatsApp Manager".
- **`manage-leads`** fusiona los HSM al `lead.history` con `outcome = status` (Pilar 2) → cuando el estado avance, el timeline del lead lo refleja solo.
- **`whatsapp-meta-webhook`** procesa **solo `value.messages[]`** (inbound/flows). **Ignora `value.statuses[]`** (los recibos de entrega de Meta) — el loop ni lo mira.
- **Pilar 3** ya expone `recordSuppression(status:"quarantined", channels:["whatsapp"])` — **el puente de cuarentena está listo para enchufar.**
- **`send-whatsapp-template`/`-flow`** mandan vía `sendWhatsApp` (router `_shared/whatsappSend.ts`): modo **`aws`** (End User Messaging, `SendWhatsAppMessageCommand` → `res.messageId`) o **`meta`** (Cloud API directa → `messages[0].id`). `resolveWhatsApp`: legacy/Novasys = **`aws`** por defecto.
- **NO existe** `whatsapp-status-webhook`, ni suscripción SNS/EventBridge, ni `get-whatsapp-health`.

**🚨 Hallazgo de infra (define la arquitectura) — la WABA de UDEP:**
```
WABA "Novasys-Amazon"  wabaId 2370402863397858
  número: +1 555-784-9134  (metaPhoneNumberId 724090737449770)  qualityRating: GREEN
  eventDestinations: [ Amazon Connect instance 2345d564… , role NuevorolMETA ]   ← UNO solo
```
**AWS End User Messaging permite UN (1) event destination por WABA — un SNS topic _O_ una instancia de Connect, no ambos** (docs AWS). UDEP lo tiene en **Connect** (para que el WhatsApp **inbound** entre como contacto de Connect). Los **template sends de campaña salen por `SendWhatsAppMessageCommand`** (fuera del modelo de contactos de Connect) → **sus eventos de estado se publican al event destination = Connect, que no los correlaciona → se pierden.**

**Consecuencia:** para el número AWS-mode de UDEP, **capturar el estado por-mensaje y mantener el inbound-por-Connect son mutuamente excluyentes**. Cambiar el destino a SNS daría el estado pero **rompería el inbound de WhatsApp en Connect** (habría que re-implementar el inbound en ARIA — territorio del Pilar 6). Esto es lo que el comentario de `HsmOutboundReport` ya intuía.

**Lo que SÍ se puede leer sin tocar nada (clave):** `GetLinkedWhatsAppBusinessAccount` devuelve **`qualityRating` por número** (hoy GREEN) + estado de registro + display name. → el **monitor de salud (#13) es desplegable para UDEP ya**.

---

## 2. Decisión de arquitectura (a confirmar)

Dado el lock del event destination, el estado por-mensaje para el número de UDEP NO sale "gratis". Tres caminos para las **métricas de entrega de UDEP**:

- **(A) Pull de analytics de Meta + salud del número** ✅ **recomendado.** No se toca el event destination (inbound sigue en Connect). Dos lecturas:
  1. **Salud (#13):** `GetLinkedWhatsAppBusinessAccount` → quality rating + alerta (YELLOW/RED). Ya legible.
  2. **Entrega agregada (R5/R16):** Meta Graph API `template_analytics`/`analytics` de la WABA (con un **token Cloud API** que provee Novasys) → **sent/delivered/read por plantilla** en una ventana — exactamente la "HSM Shipment Summary" de Chattigo (delivered%, read%), **sin** eventos por-mensaje ni conflicto con Connect. La granularidad por-mensaje queda en Meta WhatsApp Manager.
  - *Costo:* requiere un token de Meta (system-user) con permiso sobre la WABA. Si Novasys no lo da, queda solo la salud + el pipeline para BYO (abajo).
- **(B) Pipeline de estado por-webhook (el #14 diseñado) — para tenants meta-mode/BYO.** Procesar `value.statuses[]` en `whatsapp-meta-webhook` → actualizar `hsm-sends`. Funciona para cualquier tenant que use **Meta Cloud API directa** (no AWS End User Messaging). **No** ilumina a UDEP (AWS-mode), pero es correcto, deja el motor listo, y enciende las columnas del reporte para BYO. + salud del número.
- **(C) Mover el inbound de WhatsApp fuera de Connect** (destino SNS → ARIA maneja inbound + estado). Da todo, pero es una re-arquitectura grande (inbox propio = Pilar 6). **No ahora.**

**Recomendación:** construir **(A) + (B) juntas** (son complementarias y comparten el mismo `updateHsmStatus` + UI): salud del número (UDEP-visible ya) + pipeline de estado por-webhook (BYO/futuro) + pull de analytics de Meta (UDEP, si hay token) + el puente de cuarentena. Verificable en vivo por la salud (real) y por un evento de estado simulado (pipeline).

**Cuarentena (a confirmar):** un `failed` con causa de **número inválido/bloqueado** → ¿**auto-cuarentena dura** (Pilar 3 lo excluye a futuro, como un opt-out) o **marcar-para-revisar** (lo muestra, Adriana decide)?

---

## 3. Modelo

### 3.1 Estado en `hsm-sends` (UpdateItem por `sendId` = messageId)
```ts
// Campos nuevos (opcionales, retrocompat — el record ya existe con status:"sent")
status: "sent" | "delivered" | "read" | "failed" | "expired" | "pending";
statusAt?: string;        // ISO del último cambio de estado
failureReason?: string;   // categorizada: "número inválido" | "bloqueado" | "fuera de ventana 24h" | "plantilla pausada" | …
failureCode?: string;     // code crudo de Meta (131026, 131047, 470, …) para auditoría
```
Helper `updateHsmStatus(dynamo, messageId, status, {error})` — `UpdateItem` idempotente que **solo avanza** el estado (no retrocede read→delivered). Categoriza `failureReason` desde el code de Meta.

### 3.2 Salud del número (`get-whatsapp-health`, on-read, sin tabla)
```ts
interface WhatsAppHealth {
  numbers: { displayPhoneNumber: string; displayName: string;
             qualityRating: "GREEN"|"YELLOW"|"RED"|"UNKNOWN";
             registrationStatus: string; metaPhoneNumberId: string; }[];
  wabaName: string; wabaId: string;
  alert?: { level: "warning"|"critical"; message: string };  // si algún número ≠ GREEN
}
```

### 3.3 Causa de falla → acción (la tabla del "actuar")
| Causa (Meta code) | Estado | Acción |
|---|---|---|
| Número inválido (131026/131047…) | `failed` | 🔴 **cuarentena** (Pilar 3 `recordSuppression`) + marca el teléfono "a corregir" |
| Bloqueado por el usuario | `failed` | cuarentena (opt-out de hecho) |
| Fuera de ventana 24h | `failed`/`expired` | NO cuarentena (transitorio) — reintento como plantilla |
| Plantilla pausada/rechazada | `failed` | alerta al admin (no es culpa del número) |
| delivered / read | avanza | alimenta reporte + `lead.history` (Pilar 2) |

---

## 4. Plan por fases

**Fase A — Monitor de salud del número (#13) — el win UDEP-visible:**
- `get-whatsapp-health` Lambda (tenant-aware vía `resolveWhatsApp`/socialmessaging) → `GetLinkedWhatsAppBusinessAccount` → quality rating + registro. `api.ts` `getWhatsAppHealth`.
- UI: panel "Salud de WhatsApp" (Configuración → Canales) — número(s), chip GREEN/YELLOW/RED, alerta si ≠ GREEN, link a Meta Manager.
- *Entrega: UDEP ve la salud de su número en vivo (GREEN) con alerta si cae — protege el activo.*

**Fase B — Pipeline de estado + reporte + puente de cuarentena (el #14, meta-mode/BYO + futuro):**
- `updateHsmStatus` + `value.statuses[]` en `whatsapp-meta-webhook` → avanza `hsm-sends`. Categoriza fallas.
- **Cuarentena:** `failed`+inválido → `recordSuppression(quarantined)` (Pilar 3).
- **Encender el reporte:** columnas delivered/read/failed + readRate/failRate en `HsmOutboundReport` (el backend ya agrega) + estado por-mensaje en el timeline del lead (ya mapeado a `outcome`).
- *Entrega: para meta-mode, ciclo completo + cuarentena automática; el reporte muestra los estados.*

**Fase C — Entrega agregada de UDEP (pull de Meta) + reintentos (según token):**
- `get-whatsapp-analytics`: Meta Graph `template_analytics` (con token Cloud API de Novasys) → delivered/read por plantilla → llena el reporte para UDEP sin eventos por-mensaje.
- Auto-retry de fallas transitorias (fuera de ventana) como plantilla; cuarentena de permanentes.
- *Entrega: UDEP ve delivered%/read% por plantilla (estilo Chattigo) sin tocar Connect.*

> Esfuerzo: **M**. Fase A es el valor visible inmediato para UDEP; B es el motor correcto (BYO + futuro + cuarentena); C cierra la entrega agregada de UDEP si hay token de Meta.

---

## 5. Decisiones a confirmar
1. **Métricas de entrega de UDEP** dado el lock del event destination: **(A)** pull de analytics de Meta (necesita token Cloud API de Novasys) + salud del número — *recomendado* — vs **(B)** solo el pipeline webhook (BYO/meta-mode; UDEP no se ilumina) + salud, dejando el agregado de UDEP en Meta Manager, vs **(C)** mover inbound fuera de Connect (no ahora).
2. **Cuarentena en `failed`/inválido:** auto-cuarentena **dura** (Pilar 3 lo excluye, como opt-out) vs **marcar-para-revisar** (soft).
3. **#13 salud del número:** confirmar que el monitor de quality rating + alerta es el entregable de la **Fase A** (UDEP-visible ya).

## 6. Decisiones tomadas ✅ (2026-06-19, confirmadas con el usuario)
1. **Modelo dual-mode explícito (como Chattigo/Kommo).** El modo de WhatsApp es de primera clase por conexión:
   - **Anclado a Amazon Connect** (`mode:"aws"`): inbound integrado en Connect, pero **deliverability por-mensaje NO disponible** (el único event destination de la WABA es Connect). La UI lo **comunica claramente** y ofrece la alternativa.
   - **Meta standalone** (`mode:"meta"`, no anclado a Connect): **deliverability completa** — ARIA es dueña del webhook → `value.statuses[]` → ciclo completo. Es el camino "full".
   - **Salud del número** (quality rating) funciona en **ambos** modos (lectura por API, no depende del event destination).
2. **Cuarentena = auto-dura:** `failed`/número inválido → `recordSuppression(quarantined)` (Pilar 3), excluido a futuro como un opt-out. Reversible desde Configuración → Supresión.
3. **Orden: arrancar por el pipeline de estado (#14)** — Fase A. La salud del número (#13) + la UX dual-mode van en la Fase B.

**Plan revisado por fases:**
- **Fase A — Pipeline de estado (#14) — ✅ HECHA y verificada en vivo (2026-06-19):** `_shared/hsmStatus.ts` `updateHsmStatus` (UpdateItem condicional por `statusRank` → solo avanza, no crea rows fantasma; `categorizeFailure`/`isPermanentNumberFailure` desde el code de Meta) + `value.statuses[]` en `whatsapp-meta-webhook` (`handleStatus`: resuelve tenant por `phone_number_id`, fallback pooled) + **cuarentena automática** (failed+131026 → `recordSuppression(quarantined)`, Pilar 3) + columnas delivered/read/failed + tasas en `HsmOutboundReport` (embudo: leído⊇entregado). IAM: `UpdateItem` sobre hsm-sends en la managed policy. **Verificado:** evento simulado de Meta sobre `sendId` reales → `74a5b455` avanza delivered→**read**; `65ef3ed0` → **failed**+`failureReason:"número inválido"`(131026) → **+51900000009 auto-cuarentenado** (`source:status_webhook`) → un envío posterior a ese número devuelve `{suppressed:true, blockedBy:"quarantine"}`. Reporte HSM en vivo: **Entregados 1 · Leídos 1 · Fallidos 1 · tasa lectura 100% · tasa fallo 7%**. *(UDEP es AWS-mode/Connect-anclado → en producción estos eventos requieren un número Meta-standalone; el pipeline se validó con el webhook real + payload Meta.)*
- **Fase B — Salud del número (#13) + UX dual-mode — ✅ HECHA y verificada en vivo (2026-06-19):** `get-whatsapp-health` Lambda (`ListLinked`+`GetLinkedWhatsAppBusinessAccount` → numbers con `qualityRating`, `anchoredToConnect` desde el event-destination, `mode` vía `resolveWhatsApp`, alerta si ≠GREEN). `scripts/create-whatsapp-health.mjs` (Function URL + managed policy social-messaging read en campaign-lambda-role + VoxCrmConnectAccess). `useWhatsAppHealth` + `WhatsAppHealthPanel` montado en `ChannelsManager` (Configuración → Canales). **Verificado:** panel muestra "Novasys-Amazon · 🔗 Anclado a Amazon Connect · +1 555-784-9134 · GREEN" + la nota dual-mode ("estado por-mensaje no disponible para este número anclado a Connect; conectá un número Meta standalone"). El endpoint devuelve el quality rating real (GREEN) sin tocar el event destination.
- **Fase C — Pull de analytics de Meta — ✅ HECHA y verificada en vivo (2026-06-19):** `get-whatsapp-analytics` (lee el token de Secrets Manager + WABA env → Meta Graph `message_templates` + `template_analytics` por plantilla [sent/delivered/read] + `analytics` WABA-level). `scripts/create-whatsapp-analytics.mjs` (Function URL + IAM secretsmanager read). Panel "WhatsApp · Entrega directo de Meta (Cloud API)" en Reportes (`WhatsAppAnalyticsPanel` + `useWhatsAppAnalytics`). **Número Meta standalone real conectado:** +51 908 825 660 (metaPhoneNumberId `409805222211985`, WABA `422335910956659` "Novasys" Cloud API, GREEN; token en el secret `WhatsAppKeyPin`). **Verificado:** el panel trae datos reales de Meta — actividad del número 3 enviados / 3 entregados (100%); per-template 0 (esos fueron mensajes de sesión, no plantillas) mostrado con empty-state. La capacidad funciona sin tocar el event destination ni el webhook. *(Reintentos de fallas transitorias → follow-up.)*

> **🎯 PILAR 4 · FASE A — HECHA y verificada en vivo (2026-06-19).** Pipeline de estado de WhatsApp (#14): `updateHsmStatus` + `value.statuses[]` en el webhook + **cuarentena automática de números inválidos** (puente Pilar 3) + columnas delivered/read/failed en el reporte HSM. **Verificado:** delivered→read avanza; failed(131026)→cuarentena→envío posterior bloqueado (`blockedBy:"quarantine"`); reporte muestra el embudo. Modelo **dual-mode** decidido (Connect-anclado = sin estado por-mensaje + aviso; Meta-standalone = deliverability completa).

> **🎯 PILAR 4 · FASE B — HECHA y verificada en vivo (2026-06-19).** Monitor de salud del número (#13): `get-whatsapp-health` (quality rating real + `anchoredToConnect`) + panel "Salud del número de WhatsApp" en Configuración → Canales con la UX dual-mode (capacidades por modo). **Verificado:** +1 555-784-9134 · GREEN · 🔗 anclado a Connect, con la nota de capacidades.

> **🎯 PILAR 4 · FASE C — HECHA y verificada en vivo (2026-06-19).** Pull de analytics de Meta: `get-whatsapp-analytics` (token de `WhatsAppKeyPin` + WABA Cloud API de Novasys `422335910956659` → `template_analytics` por plantilla + `analytics` WABA-level) + panel en Reportes. **Verificado:** datos reales (3 enviados/3 entregados del número +51 908 825 660). **PILAR 4 COMPLETO (A+B+C).**

> **🎯 PILAR 4 · TAKEOVER del número Meta standalone — HECHO y verificado en vivo (2026-06-19).** El usuario eligió "takeover completo". **+51 908 825 660** (metaPhoneNumberId `409805222211985`, WABA Cloud API `422335910956659`, token en `WhatsAppKeyPin`) conectado a ARIA como número **meta-mode con deliverability completa REAL**: ① config del tenant `t_3176dacd…` → `whatsapp.mode=meta` (+ backup `whatsappAwsBackup` reversible) + token en el secret `connectview/tenant/{tenant}/whatsapp`. ② Webhook repuntado vía **`POST /{waba}/subscribed_apps` con `override_callback_uri`** = el webhook de ARIA + verify_token `aria-wa-…` → Meta GET-verificó y enruta SOLO este WABA a ARIA (no tocó la Meta App ni otros números). ③ **Verificado E2E real:** ARIA envió `hello_world` por Cloud API → wamid real de Meta → el **status webhook real (delivered) llegó a ARIA** → hsm-sends `delivered` → el reporte HSM muestra `hello_world · Entregados 1`. El pipeline de Fase A ahora corre con eventos REALES de Meta. *(⚠️ se envió a un número adivinado que resultó real — de acá en más SOLO al número del usuario +51953730189, ver feedback. Tras el takeover el tenant manda por el número Perú.)*

> **Follow-ups del Pilar 4 (2026-06-19):** ✅ **salud en meta-mode** — `get-whatsapp-health` ahora pulea el **quality rating real de Meta Graph** para números Cloud API (token del tenant); verificado: +51 908 825 660 → GREEN, `anchoredToConnect:false` → el panel muestra "Meta standalone · deliverability completa". ⏸️ **auto-retry de fallas transitorias** — DIFERIDO a backlog: valor marginal bajo (las fallas permanentes ya se cuarentenan; Meta reintenta muchas transitorias internamente) y costo alto (re-enviar una delivery fallida necesita guardar los params del envío + un scheduler). No es "menor".

### Archivos que toca
- **Backend nuevo:** `_shared/hsmStatus.ts` (`updateHsmStatus`), `get-whatsapp-health` (Fase B), (`get-whatsapp-analytics` Fase C), `scripts/create-whatsapp-health.mjs` (Lambda + Function URL + IAM socialmessaging read).
- **Backend editado:** `whatsapp-meta-webhook` (`value.statuses[]`), puente Pilar 3 (`recordSuppression`).
- **Frontend nuevo:** panel "Salud de WhatsApp" + `useWhatsAppHealth`; columnas de estado en `HsmOutboundReport`.
- **Frontend editado:** `ChannelsManager`/Configuración, `HsmOutboundReport.tsx`, `api.ts`, `amplify_outputs.json`.
- **IAM:** rol de `get-whatsapp-health` necesita `social-messaging:GetLinkedWhatsAppBusinessAccount`/`ListLinked…` (read). Cuarentena reusa la managed policy del Pilar 3.
