# Pilar 3 — Motor de supresión / consentimiento / frecuencia · Diseño técnico

> Solución completa para **R6** (guard anti-doble-envío de WhatsApp, P0) y eleva **R4** (dedup). Incluye lo que el cliente **NO** pidió pero es **compliance obligatorio** de WhatsApp/Meta (opt-out/STOP, ventana 24h). Ver `REQUERIMIENTOS-UDEP-MEJORAS.md` (Pilar 3) y `REQUERIMIENTOS-UDEP-2026-06-17.md` (R6). Aterrizado en el código actual (mapeo abajo).

## 0. Qué pidió el cliente
Adriana (~49:06): **validar que a un número no se le envió ya** (ese día / esa campaña) antes de un blast, y un **filtro que excluya los ya-contactados** — hoy lo hace **a mano** ("a estos 50 ya les mandé el lunes → mándale a los otros 50"). La regla de oro del doc de mejoras: cuando el cliente describe un trabajo manual (deduplicar), el producto debe **hacerlo solo por política**, no darle otra pantalla para hacerlo a mano.

**Lo que entregamos (no un filtro):** un **servicio central de supresión por el que pasa _todo_ envío** (campaña, automatización, blast manual, callback). Convierte la dedup manual en **garantía por política** + **cumplimiento Meta** (opt-out/STOP, frecuencia, quiet hours), con **preview honesto** antes de enviar. Protege el activo más frágil de WhatsApp: el número (los baneos vienen de blasts a quien no quiere/ya recibió).

---

## 1. Estado actual (lo que YA existe — y lo que NO)

**Paths de envío saliente (cada uno necesita el hook pre-send):**
- **`send-whatsapp-template/handler.ts`** — HSM (plantilla). Disparado por: blast manual (frontend), `campaign-dialer` (campañas WhatsApp), `automation-engine` (`actSendTemplate`). `normalisePhone()` → E.164. Escribe `connectview-hsm-sends` vía `recordHsmSend()` (PK=`sendId`, `phone`, `templateName`, `language`, `campaignId`, `status:"sent"`, `sentAt`). **Sin ningún filtro pre-envío.**
- **`send-whatsapp-flow/handler.ts`** — WhatsApp Flow interactivo. Escribe el **mismo** `connectview-hsm-sends` (`templateName:"flow:…"`). Sin filtro.
- **`campaign-dialer/handler.ts`** (EventBridge `rate(1 min)`) — voz (`StartOutboundVoiceContact`) o ruta a `send-whatsapp-template`. **Ya tiene `isWithinWindow()` (líneas 101–131): quiet hours + días permitidos por campaña, en su timezone** — es el ÚNICO precedente de control horario. Dedup atómico `markAsDialing()` (un tick agarra cada contacto) — no es supresión.
- **`callback-dispatcher/handler.ts`** (EventBridge `rate(1 min)`) — voz (`dispatchVoice`), o email/whatsapp/task → `DUE` (el agente envía a mano). Sin filtro de contacto.
- **`start-outbound-contact/handler.ts`** — email del agente (Connect `StartOutboundEmailContact`, RAW MIME) + voz saliente manual. Sin filtro.
- **`automation-engine/handler.ts`** — `actSendTemplate` (WhatsApp) y `schedule_callback`. Tiene `MAX_FIRES_PER_TICK=25` (paracaídas anti-blast) y marker `autoFired_${ruleId}` en `lead.attributes` (dedup de `lead_inactive`) — no es supresión por número.
- **`create-campaign/handler.ts`** — expande la lista de contactos; **solo** filtra por formato E.164 (líneas 185–199). Aquí va el **preview honesto**.

**Lo que NO existe (confirmado, greenfield):**
- ❌ Tabla `connectview-suppression` (mencionada como futuro en `DIALER_FOR_SALESFORCE.md:294`, no creada).
- ❌ Detección de STOP/BAJA: `whatsapp-meta-webhook/handler.ts` (`handleInbound`, líneas 230–301) pasa el texto al bot, **cero** lógica de opt-out.
- ❌ Campos de consentimiento en el lead (`_shared/leadSync.ts`): no hay `optOut`, `dncAt`, `consent`, etc. Solo `attributes: Record<string,string>` genérico, sin uso para esto.
- ❌ Dedup cross-campaña / "ya contactado": `create-campaign` no chequea contra `hsm-sends` ni otras campañas.
- ❌ Frequency caps (global/por programa), "no contactar tras conversión", ventana 24h.

**Infra reutilizable:**
- **`_shared/phone.ts`**: `normalizePhone(raw)` → `{e164, digits}`; `samePhone(a,b)` (tolera código de país); `sfPhoneCandidates(raw)`. **El `digits` normalizado es la clave natural de supresión.**
- **`connectview-hsm-sends`**: ya tiene `phone` + `sentAt` por cada WhatsApp → con un **GSI `byPhone`** sirve para contar envíos en ventana (R6 + frecuencia). *(El mismo GSI que el Pilar 2 quería para escribir WhatsApp-out al ledger.)*
- **Patrón de config (Configuración):** `AdminPage.tsx` (array `sections` + render condicional); lambdas `manage-*` con `resolveDynamo(headers, legacy)` para aislar tenant; `authedFetch()` agrega `Bearer idToken`; matriz de permisos en `manage-permissions` (`DEFAULT_MATRIX`, gating con `usePermissions().can(cap)`); hook tipo `useCatalogs` (caché de módulo). Molde de provisioning idempotente: `scripts/create-programs.mjs`.

---

## 2. Decisión de arquitectura (la clave — a confirmar)

### 2.1 ¿Dónde vive el "gate"? — **librería compartida** vs Lambda dedicado
- **(A) `_shared/suppression.ts`** ✅ **recomendado** — librería bundleada por cada sender (igual que `leadSync.ts`/`phone.ts`). Cada handler, ANTES de enviar, llama `evaluateSend({phone, channel, programId, tenantId})` → `{allowed, blockedBy}` **en proceso**, leyendo la lista de supresión + contadores con el **mismo cliente Dynamo del tenant que ya resolvió** (`resolveDynamo`). Cero hop de red, cero cold-start extra, cero Function URL nueva que asegurar. Es el patrón probado del repo. *Costo: cambiar la lib exige redeployar todos los consumidores (igual que `leadSync.ts` hoy — gotcha conocido).*
- **(B) Lambda `suppression-check`** (Function URL, `x-vox-internal`) — centraliza el deploy, pero **suma un hop de red + latencia a CADA envío** (en un tick de dialer que manda decenas, se nota) + otra Function URL + el baile del secreto interno.

**Recomendación:** **(A) librería compartida** para la _enforcement_ (camino caliente, lectura) + un Lambda **`manage-suppression`** delgado solo para la _config/CRUD_ de la lista DNC y reglas (camino frío, escritura, raro) — misma separación que el resto de Configuración. *(A confirmar.)*

### 2.2 ¿Dónde vive el dato? — **lista phone-keyed** (no extender el lead)
Un teléfono puede existir **sin** lead (contacto de CSV de campaña, callback, número que escribe STOP antes de ser lead). El opt-out debe respetarse igual. → **el lead es la PK equivocada; el teléfono es la clave correcta.**
- **Tabla nueva `connectview-suppression`, PK = `phone` (digits normalizados)** — la lista autoritativa "no contactar". Sobrevive a la rotación de leads y deduplica varios leads con el mismo número.
- **Frecuencia = computada, no un store nuevo:** GSI `byPhone` sobre `connectview-hsm-sends` (phone+sentAt) → contar WhatsApp en ventana (cubre R6 dedup-window Y "máx N/semana" con el mismo query). A la escala de UDEP es barato.
- **Reglas/política = doc por tenant** en `connectview-suppression-rules` (PK=`tenantId`, un doc, como `connectview-permissions`): caps, quiet hours por canal, ventana de dedup, lista de keywords STOP.

### 2.3 Definición de "supresión" (qué bloquea y con qué dureza)
| Causa | Dureza | Fuente |
|---|---|---|
| **Opt-out / STOP / BAJA** | 🔴 **bloqueo duro, sin override** (compliance) | inbound keyword, manual admin |
| **Cuarentena de número** (inválido/baneado, Pilar 4) | 🔴 bloqueo duro | `whatsapp-status-webhook` (#14) |
| **DNC manual** (admin/agente marca "no contactar") | 🔴 bloqueo duro | UI |
| **Anti-doble-envío** (ya enviado en N días — R6) | 🟡 política, configurable | `hsm-sends` byPhone |
| **Frequency cap** (máx N/semana, por canal/programa) | 🟡 política, configurable | `hsm-sends` byPhone |
| **Quiet hours / ventana** (no tras 10pm — Miguel) | 🟡 política, configurable + override supervisor | reglas |
| **No contactar tras conversión** | 🟡 política | `lead.stageId` valoracion=cierre |

### 2.4 Alcance de canales en v1 — **WhatsApp-first**
WhatsApp es el activo frágil (baneo de número) **y** el ask literal de R6. Voz ya tiene quiet-hours parcial. El **email masivo se queda en Pardot con SU gestión de bajas** (`zapier-pardot-analysis.md:187` — deliverability/compliance CAN-SPAM es dominio propio); ARIA solo manda email **transaccional del agente**.
- **v1 hace gate completo en WhatsApp** (HSM + flow): opt-out + anti-doble-envío + frecuencia + quiet hours + preview.
- **Voz**: respeta DNC/opt-out + generaliza quiet-hours; frecuencia de voz → v2.
- **Email del agente**: respeta DNC duro (warning + bloqueo si opt-out total).

---

## 3. Modelo

### 3.1 Tabla `connectview-suppression` (PK = phone digits)
```ts
interface SuppressionEntry {
  phone: string;              // PK — digits normalizados (de _shared/phone.ts)
  e164?: string;              // forma legible
  status: "opted_out" | "quarantined" | "dnc";  // por qué está
  channels: string[];         // ["whatsapp"] | ["voice"] | ["whatsapp","voice","email"] | ["all"]
  reason?: string;            // "STOP keyword" | "número inválido" | "manual: pidió no contacto"
  source: "inbound_keyword" | "status_webhook" | "manual" | "import";
  tenantId?: string;          // BYO multi-tenant
  leadId?: string;            // si se pudo ligar a un lead (conveniencia)
  createdAt: string; createdBy?: string;
  expiresAt?: string;         // opcional (cuarentena temporal); opt-out = permanente
}
```
- "¿Puedo contactar a este número por este canal?" → `GetItem(phone)` + chequear `channels` ∩ canal. O(1).

### 3.2 Reglas/política `connectview-suppression-rules` (PK = tenantId, un doc)
```ts
interface SuppressionRules {
  tenantId: string;                 // PK (=configId)
  // Anti-doble-envío + frecuencia (WhatsApp v1)
  dedupWindowDays?: number;         // R6: no reenviar HSM al mismo número en N días (default 1 = "mismo día")
  freqCaps?: { channel: string; maxPerDays: number; windowDays: number }[]; // ej. WA máx 3 / 7 días
  freqCapsByProgram?: Record<string, { maxPerDays: number; windowDays: number }>;
  // Quiet hours / ventana (por canal, generaliza el isWithinWindow del dialer)
  quietHours?: { channel: string; startHour: number; endHour: number; timezone: string; daysOfWeek: number[] }[];
  suppressAfterConversion?: boolean;   // no contactar leads en etapa valoracion="cierre"
  // Opt-out
  stopKeywords?: string[];          // default: ["STOP","BAJA","CANCELAR","NO MOLESTAR","DAR DE BAJA","UNSUBSCRIBE"]
  optOutScope?: "channel" | "all";  // STOP por WhatsApp → ¿suprime solo WA o todo? (default "channel")
  optOutAutoReply?: string;         // confirmación de baja
  updatedAt?: string; updatedBy?: string;
}
```

### 3.3 La función central (en `_shared/suppression.ts`)
```ts
interface SendCheck { phone: string; channel: "whatsapp"|"voice"|"email"; programId?: string;
                      tenantId?: string; ignoreFrequency?: boolean; /* override supervisor */ }
interface SendVerdict { allowed: boolean;
  blockedBy?: "opt_out"|"quarantine"|"dnc"|"dedup_window"|"frequency"|"quiet_hours"|"converted";
  detail?: string; }

async function evaluateSend(c: SendCheck): Promise<SendVerdict>;     // un número
async function evaluateBatch(list: SendCheck[]): Promise<{ verdicts: SendVerdict[];
  summary: { willSend: number; excluded: Record<string, number> } }>; // preview honesto
async function recordOptOut(phone, {channels, reason, source, tenantId}): Promise<void>;
async function recordSuppression(phone, entry): Promise<void>;
function matchesStopKeyword(text: string, keywords: string[]): boolean;
```
Orden de evaluación: opt-out/dnc/cuarentena (duro) → converted → dedup-window → frequency → quiet-hours. Devuelve la **primera** causa (para el preview se cuentan todas las categorías).

### 3.4 Preview honesto (lo que ve Adriana antes del blast)
`evaluateBatch` sobre la lista del wizard → `{ willSend: 77, excluded: { alreadySent: 12, optOut: 7, frequency: 0, quietHours: 4 } }` → render "**de 100 se excluyen 23**". Nunca más dedup a mano.

---

## 4. Plan por fases

**Fase A — Núcleo de supresión + opt-out/STOP (backbone de compliance) — ✅ HECHA y verificada en vivo (2026-06-18):**
- Tabla `connectview-suppression` (PK=phone) + `_shared/suppression.ts` (`evaluateSend` con solo las causas duras: opt-out/dnc/quarantine; `recordOptOut`/`recordSuppression`/`removeSuppression`/`listSuppression`/`getSuppression`/`matchesStopKeyword`/`matchesOptInKeyword`). El cliente Dynamo se pasa EXPLÍCITO (sin estado de módulo). Fail-open en lectura.
- **STOP/BAJA en `whatsapp-meta-webhook`**: detecta keyword en inbound → `recordOptOut(channel=whatsapp)` + auto-reply de confirmación + evento en `lead.history` (`type:"note"`); **ALTA/START → re-alta** (`removeSuppression` + confirma). Helper nuevo `getLeadByPhone` en `leadSync` para ligar el opt-out al timeline. *(Wired+desplegado; el E2E con inbound real depende de tenant en modo `meta`.)*
- **Hook pre-send duro** en `send-whatsapp-template` + `send-whatsapp-flow`: `evaluateSend(dynamo,{phone,channel:"whatsapp"})` ANTES del send; si bloquea → no envía, responde `{sent:false, suppressed:true, blockedBy}` (no reintenta).
- `manage-suppression` (Lambda CRUD: GET list / POST upsert / POST remove / DELETE) — Function URL `v3fficzgbvia6…` + `manageSuppression` en `api.ts`/`amplify_outputs.json`. Provisioning idempotente `scripts/create-suppression.mjs` (tabla + managed policy `connectview-suppression-access` adjunta a **VoxCrmConnectAccess** + `connectview-campaign-lambda-role` + `connectview-admin-lambda-role`). Sección **"Supresión y cumplimiento"** en `AdminPage` (`SuppressionManager` + `useSuppression`, banner explicativo + KPIs + alta manual + lista con quitar) + capability `manage_suppression` en `DEFAULT_MATRIX`.
- **Verificado en Chrome (Browser 1, logueado Admin):** la sección carga (GET autenticado OK, empty state); bloqueo manual de `+51900000001` → toast + KPIs (Suprimidos 1 / Bloqueos manuales 1) + fila "No contactar". Gate E2E contra el endpoint real `send-whatsapp-template`: número en DNC → `{sent:false, suppressed:true, blockedBy:"dnc"}` (ningún mensaje sale a Meta); número NO listado → `{sent:true, suppressed:false}` (no sobre-bloquea). El gotcha IAM (VoxCrmConnectAccess) quedó resuelto — el write autenticado funciona, el curl anónimo lo habría enmascarado.
- *Entrega visible: un STOP por WhatsApp suprime futuros HSM; lista DNC en Configuración; ningún HSM sale a un opt-out.*

**Fase B — Anti-doble-envío + frecuencia + preview honesto (corazón de R6) — ✅ HECHA y verificada en vivo (2026-06-19):**
- **GSI `byPhone`** en `connectview-hsm-sends` (`phoneDigits` HASH + `sentAt` RANGE, INCLUDE status) → conteo en ventana. Los 2 senders escriben `phoneDigits` (normalizado) en cada record. *(Backfill async; los HSM nuevos ya lo llevan.)*
- `connectview-suppression-rules` (1 doc/tenant, PK=tenantId) + **`getRules` cacheado 60s** (default `dedupWindowDays:1` = R6 out-of-the-box). CRUD en `manage-suppression` (`?rules=1` GET / `saveRules` POST). UI de reglas (tab "Reglas") en `SuppressionManager`: anti-doble-envío (días), tope de frecuencia (máx/ventana), horario permitido (start/end/TZ).
- `evaluateSend` completo: hard (Fase A) + **quiet-hours** (`outsideContactWindow` por TZ, generaliza el `isWithinWindow` del dialer) + **dedup-window R6** + **frequency** (1 query al GSI byPhone, buckets por ventana). `tenantId` lee las reglas; `ignoreFrequency` = override. (Converted = preview-only por ahora; enforce per-send necesita join lead/taxonomía → Fase C.)
- **`evaluateBatch`** + endpoint `manage-suppression action:previewBatch {phones,channel,programId}` → desglose `{willSend, excluded:{optOut,quarantine,dnc,dedupWindow,frequency,quietHours,converted}}`. **Preview honesto** (`SuppressionPreview` + `previewSuppression`) en `CampaignCreatePage` (rama WhatsApp, debounced) → "de N se excluyen M".
- **Gate cableado** en `campaign-dialer` (path WhatsApp: `sendWhatsAppTemplate` devuelve `{suppressed}` → `markWhatsAppSuppressed`, estado TERMINAL "suppressed", no retry) + `automation-engine actSendTemplate` (suppressed = skip benigno, no error).
- **Verificado en Chrome (Browser 1):** ① tab Reglas carga el default (dedup 1) y guarda (dedup→2, toast + "Última actualización · usuario"). ② Preview en el wizard: lista de 5 con el DNC `+51900000001` → **"De 5 se excluyen 1 → 4 recibirán · 1 no contactar"**. ③ **Anti-doble-envío E2E** (GSI activo): 1er envío a `+51900000077` → `sent:true`; 2º (2s después) → `{sent:false, suppressed:true, blockedBy:"dedup_window"}`. ④ `previewBatch` con `[77(ya enviado), 01(DNC), 55, 56]` → `{total:4, willSend:2, excluded:{dnc:1, dedupWindow:1}}` — cuenta dnc + dedup juntos vía GSI.
- *Entrega: el wizard muestra "X excluidos" antes de enviar; el doble-envío es imposible por política.*

**Fase C — Quiet hours voz/global + cuarentena + email + SF (parcial/diferido):**
- Generalizar quiet-hours a `callback-dispatcher` (voz) y como override global/por-programa del `isWithinWindow` per-campaña del dialer.
- **Cuarentena automática**: `whatsapp-status-webhook` (#14, Pilar 4) → número inválido/baneado → `recordSuppression(status:"quarantined")`. Puente con Pilar 4.
- DNC duro en `callback-dispatcher` + `start-outbound-contact` (email/voz del agente: warning + bloqueo).
- **SF write-back de opt-out (diferido):** campos estándar SF `HasOptedOutOfEmail`/`DoNotCall` o `Vox*__c` — degradación elegante si no existen (patrón del rollup del Pilar 2, dormido hasta que el cliente mapee campos).
- *Entrega: una sola política de contacto across canales; números malos en cuarentena sin que Adriana los cace en el Excel.*

> Esfuerzo total: **M–L** (coincide con el doc de mejoras). Cada fase es desplegable y verificable en Chrome de forma independiente. WhatsApp-first concentra el valor (R6 + activo frágil) en A+B.

> **🎯 PILAR 3 · FASE A — HECHA y verificada en vivo (2026-06-18).** Lista DNC + opt-out/STOP (compliance backbone): tabla `connectview-suppression`, lib `_shared/suppression.ts`, gate duro en los 2 senders de WhatsApp, STOP/BAJA→opt-out + ALTA→re-alta en el webhook, `manage-suppression` + sección "Supresión y cumplimiento" en Configuración. **Verificado:** ningún HSM sale a un número en DNC (`suppressed:true, blockedBy:"dnc"`), y los no-listados pasan.

> **🎯 PILAR 3 · FASE B — HECHA y verificada en vivo (2026-06-19).** Anti-doble-envío + frecuencia + preview honesto: GSI `byPhone` en `hsm-sends` (+`phoneDigits` en los senders), `connectview-suppression-rules` + `getRules` cacheado, `evaluateSend` completo (dedup R6 + frecuencia + quiet-hours), `evaluateBatch`/`previewBatch`, UI de Reglas en Configuración, **preview "de N se excluyen M" en el wizard de campañas**, y el gate cableado en `campaign-dialer` (estado terminal "suppressed") + `automation-engine`. **Verificado:** Reglas guardan (dedup 1→2); preview en el wizard "De 5 se excluyen 1 → 4 recibirán · 1 no contactar". **Sigue → Fase C:** quiet-hours en voz/callback + cuarentena automática (puente Pilar 4 #14 status-webhook) + DNC en email/voz del agente + "no tras conversión" enforce per-send (join lead/taxonomía) + SF opt-out (diferido).

---

## 5. Decisiones a confirmar
1. **Arquitectura del gate:** librería `_shared/suppression.ts` en proceso (recomendado, patrón `leadSync`) vs Lambda `suppression-check` con hop de red. + `manage-suppression` delgado para la config.
2. **Alcance del opt-out:** un STOP por WhatsApp → ¿suprime **solo WhatsApp** (channel-scoped, default recomendado, con opción "extender a todo") o **todo contacto proactivo** (voz+email+WA)? Y confirmar: opt-out = **bloqueo duro sin override**, frecuencia/quiet-hours = **política con override de supervisor**.
3. **Canales v1:** **WhatsApp-first** (gate completo en WA; voz = DNC + quiet-hours; email = respeta DNC) — recomendado — vs todos los canales por igual desde el día 1.
4. *(menor)* **Frecuencia:** GSI `byPhone` sobre `hsm-sends` (computar, recomendado) vs tabla de contadores dedicada.

## 6. Decisiones tomadas ✅ (2026-06-18, confirmadas con el usuario)
1. **Gate = librería compartida `_shared/suppression.ts`** en proceso (patrón `leadSync`/`phone`), sin hop de red; la config/CRUD va en un `manage-suppression` delgado aparte.
2. **Opt-out channel-scoped, extensible a todo:** un STOP por WhatsApp suprime **solo WhatsApp** por default (el admin puede extender a todos los canales por número). Opt-out/cuarentena/DNC = **bloqueo duro sin override**; frecuencia/quiet-hours = **política con override de supervisor**.
3. **WhatsApp-first en v1:** gate completo en WhatsApp (A+B); voz = DNC + quiet-hours; email del agente = respeta DNC. Frecuencia de voz → v2.
4. *(menor, no preguntada — se construye así salvo objeción):* frecuencia computada con **GSI `byPhone` sobre `connectview-hsm-sends`** (no tabla de contadores).

### Archivos que toca (referencia rápida)
- **Backend nuevo:** `amplify/functions/manage-suppression/`, `_shared/suppression.ts`, tablas `connectview-suppression` + `connectview-suppression-rules`, GSI `byPhone` en `connectview-hsm-sends`, `scripts/create-suppression.mjs` (molde `create-programs.mjs`).
- **Backend editado:** `send-whatsapp-template`, `send-whatsapp-flow`, `whatsapp-meta-webhook` (STOP), `campaign-dialer`, `automation-engine`, `create-campaign` (preview), `callback-dispatcher` + `start-outbound-contact` (Fase C), `manage-permissions` (`DEFAULT_MATRIX`).
- **Frontend nuevo:** sección "Supresión/Cumplimiento" en `AdminPage.tsx` (editor de reglas + lista DNC), `useSuppression` hook, preview de exclusiones en el wizard de campañas.
- **Frontend editado:** `AdminPage.tsx` (sección), `CampaignCreatePage.tsx` (preview honesto), `src/lib/api.ts` (`manageSuppression`), `amplify_outputs.json`.
- **IAM (gotcha):** dar permisos DynamoDB de las tablas nuevas al rol asumido **`VoxCrmConnectAccess`** (no solo al exec role); `connectview-campaign-lambda-role` al límite de inline → **managed policy** adjunta a AMBOS roles (ver `reference_new_lambda_iam`). Verificar SIEMPRE en el browser autenticado (curl anónimo enmascara AccessDenied).
