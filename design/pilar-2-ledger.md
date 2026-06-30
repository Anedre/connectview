# Pilar 2 — Ledger de interacciones + atribución "golpes→conversión" · Diseño técnico

> Solución completa para R4 (historial de golpes → SF, medir golpes/conversión) y R22 (chat detail en tabla/export). Ver `REQUERIMIENTOS-UDEP-MEJORAS.md`. Aterrizado en el estado actual (mapeo abajo).

## 0. Qué pidió el cliente
Zhenia/Adriana: registrar **cada toque** (llamada/WhatsApp/email) por lead con fecha+programa, medir **"cuántos golpes por conversión"**, ver el **journey completo** del lead, **deduplicar** y que todo viaje a **Salesforce** (fuente de verdad).

## 1. Estado actual (lo que YA existe — no se reconstruye)
- **`lead.history`** (`LeadHistoryEvent`, lista append-only en `connectview-leads`, vía `appendLeadHistory` en `_shared/leadSync.ts`): tipos `gestion | interaccion | stage_change | update | note`; campos `ts, channel, contactId, stageId, valoracion, summary, agent, sfTaskId, untyped`. Lo escriben: `salesforce-sync` (gestión/interacción), `manage-leads` (stage_change/update), `automation-engine`, `whatsapp-meta-webhook` (flow), `salesforce-inbound-webhook`.
- **`HistoryTimelineView.tsx`** (Grabaciones): **ya fusiona** `lead.history` (`manageLeads?phone=`) + actividades de SF (`salesforceSync mode:lead`), dedup por `sfTaskId`, agrupa por día. **Es el timeline reutilizable.**
- **`connectview-hsm-sends`**: envíos de plantillas WhatsApp (PK=`sendId`, `campaignId`, `status:"sent"`). **No** caen en `lead.history`. (El ciclo delivered/read/#14 aún no está desplegado.)
- **`connectview-wrapup-history`** (PK=`contactId`,SK=`savedAt`): historial de wrap-up por contacto.
- **`salesforce-sync`**: escribe un **Task por gestión** (`channelToSf`→Call/Email/Task). **No hay campos rollup** en el Lead de SF.
- **`dispositions.ts`**: `valoracion: inicial|positiva|negativa|cierre`. **`cierre` = conversión** (ancla de atribución).

**Gaps (lo que falta para el Pilar 2):** WhatsApp/email outbound no están en `lead.history`; los eventos no llevan `programId`; **no hay conteo de golpes ni atribución**; SF sin rollup; el timeline solo vive en Grabaciones (no en el detalle del lead); canales con nombres inconsistentes ("Llamada" vs "VOICE").

---

## 2. Decisión de arquitectura (la clave — a confirmar)

**Canonicalizar `lead.history` como EL ledger** (recomendado) vs crear una tabla evento `connectview-interactions`.

- **Canonicalizar `lead.history`** ✅ recomendado: ya existe, ya tiene UI (`HistoryTimelineView`), ya viaja a SF. Hacemos que **todos** los toques caigan ahí (sumar WhatsApp/email outbound), agregamos `programId`/`direction`/`cost` al evento, y computamos golpes/atribución. Cross-lead (golpes por programa/secuencia) se calcula con scan de leads (como el `leadCount` del Pilar 1) — barato a la escala actual.
- **Tabla `connectview-interactions`** (PK=leadId, SK=ts#id, GSI byProgram/byChannel): más limpia y escalable para reportes cross-lead, pero exige instrumentar cada path + backfill. **→ es la evolución "a escala"** cuando el volumen lo pida; el modelo de golpes que definimos acá no cambia.

**Recomendación:** canonicalizar `lead.history` ahora; dejar la tabla-evento como evolución documentada.

**Definición de "golpe" (touch):** un contacto/comunicación real con el lead — **llamada de voz, WhatsApp (out/in), email (out/in), gestión/interacción**. **NO** cuentan `stage_change`, `update`, `note` (son cambios de estado/datos, no toques). *(A confirmar.)*

---

## 3. Modelo

### 3.1 Extender `LeadHistoryEvent` (retrocompatible, campos opcionales)
```ts
interface LeadHistoryEvent {
  ts: string;
  type: "gestion"|"interaccion"|"stage_change"|"update"|"note"
      | "whatsapp_out"|"whatsapp_in"|"email_out"|"call";   // ← tipos de toque explícitos
  channel?: string;          // normalizado: "Llamada"|"WhatsApp"|"Correo"|"Chat"
  direction?: "out"|"in";    // ← nuevo
  programId?: string;        // ← nuevo (del programa activo / membership / campaña)
  cost?: number;             // ← nuevo (opcional: costo del toque)
  templateName?: string;     // ← nuevo (HSM)
  outcome?: string;          // ← nuevo: "delivered"|"read"|"failed"|"answered"|"no_answer"
  // … (resto igual: contactId, stageId, valoracion, summary, agent, sfTaskId, untyped)
}
```
Helper `isGolpe(ev)` (touch types arriba) — única fuente de verdad de qué cuenta.

### 3.2 Rollup de golpes (computado desde `lead.history`)
```ts
interface GolpesSummary {
  total: number;
  byChannel: Record<string, number>;   // {Llamada: 3, WhatsApp: 5, Correo: 1}
  firstTouchAt?: string;
  lastTouchAt?: string;
  converted?: boolean;                  // ¿llegó a una etapa valoracion="cierre"?
  touchesToClose?: number;              // golpes hasta el cierre
  daysToClose?: number;                 // firstTouch → cierre
}
```
- **Lean (board/list):** `manage-leads` GET agrega `golpesCount` por lead (cuenta de toques en `history`) — barato, sin traer todo el history.
- **Detalle:** `GolpesSummary` completo computado del history del lead.

### 3.3 Atribución (cross-lead, reporte)
Scan de leads → por cada lead con `converted`, su `touchesToClose` + secuencia de canales. Agrega: **golpes-promedio-al-cierre**, **conversión por #golpes**, **por canal/secuencia**, **por programa**. (A escala → tabla-evento + GSI.)

### 3.4 Write-back a Salesforce (rollup)
Campos nuevos en el Lead de SF (el cliente los crea, como `VoxLeadId__c`; **degradación elegante** si no existen — mismo patrón `sfWriteLead`/INVALID_FIELD): `VoxTouches__c` (total), `VoxLastTouch__c`, `VoxFirstTouch__c`, `VoxTouchesToClose__c`. Se actualizan en cada toque (además del Task por gestión que ya existe).

---

## 4. Plan por fases

**Fase A — Ledger canónico + golpes — ✅ HECHA y verificada en vivo (2026-06-19):**
- `LeadHistoryEvent` extendido (tipos de toque `whatsapp_out/in`, `email_out`, `call` + `direction/programId/cost/templateName/outcome`). Helpers `isGolpe` + `summarizeGolpes` (total, byChannel, first/lastTouch, converted, touchesToClose, daysToClose) en `leadSync`.
- **WhatsApp se fusiona al ledger por LECTURA** (no por escritura per-send): `manage-leads ?phone=` mergea `connectview-hsm-sends` (por teléfono) en el history → el **timeline y el conteo incluyen los WhatsApp salientes** sin tocar `send-whatsapp-template` ni escanear por envío. El board suma los HSM por teléfono (un solo scan) al `golpesCount`.
- `manage-leads` devuelve `golpesCount` (board lean) + `golpes` (GolpesSummary) + history fusionado (detalle).
- **UI:** badge "🎯 N golpes" en las cards + chip en el hero del modal; el **timeline del journey ya estaba** en el detalle (`SalesforcePanel`) y ahora incluye los WhatsApp. **Verificado:** Yubiry "2 golpes" (2 llamadas en el timeline), Carlos "1 golpe".
- *Optimización futura: escribir el WhatsApp-out como evento en `lead.history` (con GSI por teléfono en `connectview-leads`) en vez de mergear por lectura; el dato ya es correcto con el merge.*

**Fase B — Atribución (golpes→conversión) — ✅ HECHA y verificada (2026-06-19):**
- Endpoint `manage-leads?report=attribution[&programId=]` (scopeable por programa; fusiona WhatsApp HSM por teléfono) → `{ conversionRate, avgGolpesToClose, avgDaysToClose, totalGolpes, byBucket (conversión por #golpes), byChannel }`.
- Componente `AttributionReport.tsx` en `ReportsPage` (respeta el switcher de programa del Pilar 1). **Verificado:** scopeado a Diplomado (3 golpes · Llamada · 0% conv) y "Todos" (21 golpes = **Llamada 11 + WhatsApp 10** · 8% conv) → el merge HSM entra al reporte.
- *Pendiente menor (polish): KPI "golpes promedio al cierre" en `ExecutiveView`.*

**Fase C — R22 export ✅ + SF rollup (diferido):**
- **R22 ✅:** botón "⬇ Exportar journey" en el detalle del lead → CSV del journey (incluye los WhatsApp fusionados). Hecho + typecheck.
- **SF rollup-fields (diferido):** `VoxTouches__c`/`VoxLastTouch__c`/… en el Lead de SF quedan como follow-up — requieren que el cliente cree los campos (igual que `VoxLeadId__c`, aún sin crear). **El core de R4 "cada golpe→SF" YA lo cubre** el Task-por-gestión de `salesforce-sync`; el rollup es un agregado adicional dormido hasta que existan los campos.

> **🎯 PILAR 2 — núcleo COMPLETO (2026-06-19).** Ledger canónico (`lead.history` + merge HSM), golpes por lead (badge + chip + timeline en el detalle), reporte de atribución golpes→conversión (scopeable por programa, cross-canal) y export R22. Pendientes opcionales: KPI en ExecutiveView, SF rollup-fields (cuando el cliente los cree), y escribir WhatsApp-out como evento en `lead.history` con GSI por teléfono (hoy se mergea por lectura).

---

## 5. Decisiones a confirmar
1. **Ledger:** canonicalizar `lead.history` (recomendado) vs tabla-evento `connectview-interactions`.
2. **Definición de "golpe":** llamada + WhatsApp(in/out) + email(in/out) + gestión/interacción; NO stage_change/update/note.
3. **Write-back SF rollup:** ¿incluir campos `Vox*__c` ahora (cliente los crea, degradamos si faltan) o dejar el rollup solo en ARIA por ahora?

### Archivos que toca
- **Backend:** `_shared/leadSync.ts` (LeadHistoryEvent + golpes helpers), `manage-leads` (golpesCount/summary), `send-whatsapp-template` (+appendLeadHistory), `salesforce-sync` (rollup), email/outbound.
- **Frontend:** `LeadsPage` (badge + timeline en detalle), `ReportsPage` (reporte atribución), `ExecutiveView` (KPI), reuso de `HistoryTimelineView`.
