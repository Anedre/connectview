# Pilar 5 — Ingesta nativa de leads + speed-to-lead (matar Zapier) · Diseño técnico

> Solución completa para **R12** (formulario Meta FB/IG → dispara WhatsApp, sin Zapier · P0), **R8** (crear lead al vuelo desde la llamada · P1) y el web-form (#25). El análisis profundo (Zapier↔Pardot, qué absorber/dejar) está en `design/zapier-pardot-analysis.md` — este doc es el **plan de build aterrizado**. Ver también `REQUERIMIENTOS-UDEP-MEJORAS.md` (Pilar 5).

## 0. Qué pidió el cliente
UDEP capta con **Meta Lead Ads (FB/IG)** y hoy mueve los leads con **Meta → Zapier → Pardot → Salesforce**. Dolor: *"algunos leads no llegan"* (Zapier frágil: fallos silenciosos, latencia, costo/tarea). Quieren que un formulario de Meta **dispare WhatsApp automático** y **eliminar Zapier**, conservando Pardot solo para email masivo.

**Lo que entregamos:** una **tubería de ingesta nativa** — webhook directo de Meta Lead Ads → `propagateLead` (reusa tabla leads + Customer Profile + Salesforce con dedup) → `fireAutomation("lead_created")` (speed-to-lead sub-minuto) — + **monitor de salud de fuentes** (los leads por fuente en vivo: si un form deja de entrar, se ve al instante) + **alta inline desde la llamada** (R8).

## 1. Estado actual (mapeo) — el 90% ya existe

- **`propagateLead`** (`_shared/leadSync.ts`): punto único de entrada. `propagateLead({phone,name,email,company,source,attributes,programId}, {origin:"vox"})` → upsert en `connectview-leads` (dedup por teléfono) + Customer Profile + **Salesforce** (push idempotente por `VoxLeadId__c`) + **auto-tag de programa** (`resolveProgramIdFromAttributes` lee `utm_campaign`/`programa`). Devuelve `{leadId, voxAction:"created"|"updated"|"unchanged"}`.
- **`fireAutomation`** (`_shared/automationHook.ts`): `fireAutomation({type:"lead_created", tenantId, lead:{leadId,phone,name,source}})` → POST a `automation-engine` (header `x-vox-internal`). El `automation-engine` matchea reglas `lead_created` + condiciones (`source eq …`) → acción `send_whatsapp_template` (**speed-to-lead**). Ya funciona.
- **Moldes de webhook:** `web-form-capture` (#25, "the middleware replacement": form→`propagateLead`→`fireAutomation` si `created`) y `salesforce-inbound-webhook` (token `x-vox-token` per-tenant). Y el **GET-verify hub.challenge** de `whatsapp-meta-webhook` (con `WHATSAPP_VERIFY_TOKEN`).
- **Frontend leads:** `LeadsPage` tiene `source` (chip + filtro "Fuente" con conteos); `SOURCE_LABEL` es un dict simple (agregar `meta_lead_ads`/`facebook`/`instagram` y aparece solo en chip/filtro/tabla). Alta manual vía `manage-leads` POST (acepta cualquier `source`). `AutomationsPage` ya permite crear la regla speed-to-lead (trigger lead_created + condición source + acción send_whatsapp_template). **No existe** panel de salud de fuentes ni quick-capture desde la llamada.

**Gap (lo que falta):** el `meta-lead-ads-webhook` (la pieza que hace Zapier), el monitor de salud de fuentes, y el alta inline R8.

## 2. 🔑 Credenciales Meta — ya las tenemos (no depende del cliente)
Del takeover del Pilar 4 tenemos acceso al **Meta App "Novasys del Perú"** (`932893188309221`) vía el token de `WhatsAppKeyPin`, que resultó ser un **SYSTEM_USER permanente** (`expires:0`) con scopes que incluyen **`leads_retrieval`**, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_ads`, `business_management`, `instagram_basic`. Y `/me/accounts` → **Page "Novasys del Perú S.A.C." (`188013051209705`)** con tasks MANAGE/ADVERTISE.

→ **Podemos:** leer un lead por `leadgen_id` (Graph, `leads_retrieval`), listar los `leadgen_forms` del Page, y **suscribir el leadgen del Page a ARIA**. La conexión real de Lead Ads NO depende de pasos del cliente.

## 3. Arquitectura — "matar Zapier" (del análisis §6)
```
Meta Lead Ads ──webhook(leadgen)──▶ meta-lead-ads-webhook ─▶ propagateLead ─┬─▶ connectview-leads
 (campo leadgen, tiempo real)        (Function URL, GET-verify)              ├─▶ Customer Profile 360°
        │  leadgen_id                       │                               └─▶ Salesforce (dedup) ─▶ sync nativo SF↔Pardot
        └─ lee el lead por Graph            └─▶ fireAutomation("lead_created")        (email masivo sigue en Pardot)
           (field_data → phone/name/…)            └─▶ automation-engine
                                                        └─ send_whatsapp_template (speed-to-lead sub-minuto)
```
- **Webhook subscription:** suscribir el `leadgen` del Page a ARIA. Dos vías: **(A)** `override_callback_uri` a nivel Page en `subscribed_apps` (como hicimos con el WABA, con el token — preferido, no necesita app-secret) o **(B)** el webhook `page` del App apuntando a ARIA (App Dashboard). Reuso `WHATSAPP_VERIFY_TOKEN` o uno nuevo `META_LEADGEN_VERIFY_TOKEN`.
- **Pardot intacto:** ARIA escribe el lead a SF; SF→Pardot por su sync nativo. El email masivo no se toca (análisis §5).

## 4. Modelo / piezas nuevas
- **`meta-lead-ads-webhook`** (Function URL): GET hub.challenge verify; POST `entry[].changes[]` con `field:"leadgen"` → por cada `value.leadgen_id`: `GET /{leadgen_id}?fields=field_data,form_id,ad_id,created_time` (token del tenant) → mapear `field_data` (full_name/phone_number/email + custom) a `{phone,name,email,attributes,source:"Facebook"|"Instagram"}` → `propagateLead(...,{origin:"vox"})` → si `created`, `fireAutomation("lead_created")`. Resuelve programa por `utm`/form (auto-tag).
- **Salud de fuentes:** `manage-leads ?report=sources[&period=today]` → `{bySource:{web_form:18, meta_lead_ads:8, …}, today, trend}` (scan de leads, barato a la escala actual) + componente `SourceHealthBar` en `LeadsPage` (conteo en vivo por fuente, refresco ~60s; resalta si una fuente cae a 0).
- **Quick-capture R8:** `QuickCaptureLeadModal` en el panel de cliente del Agent Desktop (teléfono pre-cargado del contacto activo) → `manage-leads` POST `{phone,name,company,source:"referral"|"call",programId,contactId}` → candidato SF al toque (propagateLead ya empuja a SF). Cadena de referidos: `attributes.referredBy = leadId/contactId`.
- **Vocabulario de fuente:** agregar a `SOURCE_LABEL` (`meta_lead_ads`/`facebook`/`instagram`/`referral`/`call`).
- **Speed-to-lead métrica:** time-to-first-touch (del `lead_created` al 1er golpe) — KPI en la salud de fuentes / Reportes.

## 5. Plan por fases
**Fase A — `meta-lead-ads-webhook` + salud de fuentes (el "matar Zapier" core) — ✅ HECHA y verificada en vivo (2026-06-19):** `meta-lead-ads-webhook` (Function URL `yqpim5vbtywjhdmfvmf3zzxvjy0pyrsr…`; GET-verify + POST leadgen → `findTenantByPageId` (scan connections `meta.pageId`) → lee el lead por Graph con el token del tenant → `propagateLead(origin:vox, source:facebook/instagram)` → `fireAutomation("lead_created")` si created) + `scripts/create-meta-lead-ads.mjs`. **Page `188013051209705` suscrito a ARIA** (`subscribed_apps` + `override_callback_uri`, aditivo — Zapier sigue). `SourceHealthBar` ("Ingesta en vivo" por fuente + hoy) en LeadsPage + `SOURCE_LABEL` (facebook/instagram/meta_lead_ads/referral/call). **Verificado E2E real:** creé un test lead de Meta (form DRAFT, luego archivado) → el webhook lo ingirió → lead **"Lead Prueba ARIA" · +51953730189 · source `facebook` · `sfLeadId:00QgL…` (pusheado a Salesforce con dedup) · attrs meta_leadgen_id/meta_form_id**; la barra muestra **Facebook 1** entre las fuentes. Meta Lead Ads → ARIA → leads + SF, sin Zapier.

**Fase B — Speed-to-lead + quick-capture R8 — ✅ HECHA y verificada en vivo (2026-06-19):** plantilla de regla **"Speed-to-lead · Meta (FB/IG)"** en `src/lib/automations.ts` (lead_created + source=facebook → send_whatsapp_template, one-click en AutomationsPage). **R8 `QuickCaptureLeadForm`** (5º pill "Capturar lead" en `OutboundActionsMenu` del Agent Desktop): teléfono + nombre + empresa + toggle Referido/De-la-llamada + referido-por + programa → `manage-leads` POST → `propagateLead` → candidato SF. **Verificado:** alta inline "Referido Prueba R8" +51900000300 source=referral → **`sfLeadId 00QgL…` (candidato en Salesforce)**, sin campaña/CSV. *(Métrica time-to-first-touch → follow-up menor.)*

**Fase C — Backfill + corte de Zapier — ✅ HECHA y verificada en vivo (2026-06-19):** la conexión técnica (suscripción del Page) ya quedó en Fase A; la **doble-ingesta es inherente** (ARIA recibe por webhook + Zapier sondea por su lado el mismo Page → coexisten, dedup por teléfono en SF). **Backfill** (`POST {action:"backfill", tenantId, days}` al webhook, gated `x-vox-internal`): lista los `leadgen_forms` del Page → trae los leads históricos por Graph → `propagateLead` (dedup) — para reconciliar lo que Zapier ya procesó. **Verificado:** backfill → `{forms:1, leads:1, updated:1}` (trajo el lead del form de prueba, dedup). **Plan de corte:** correr ARIA + Zapier en paralelo, mirar la barra "Ingesta en vivo" (cuenta de Facebook sube); cuando ARIA ingiere ≥ lo que llega a SF por Zapier durante N días → apagar el Zap. El backfill cubre los históricos.

> Esfuerzo: **L** (coincide con el doc). Fase A es el corazón (mata Zapier); B suma speed-to-lead visible + R8; C es el corte operativo.

> **🎯 PILAR 5 — COMPLETO (A+B+C), verificado en vivo (2026-06-19).** Mata Zapier: **A** — `meta-lead-ads-webhook` (leadgen → propagateLead → fireAutomation) + Page de Novasys suscrito a ARIA (aditivo, Zapier sigue) + `SourceHealthBar` "Ingesta en vivo"; un test lead de Meta entró a ARIA (leads + Salesforce, source facebook). **B** — plantilla speed-to-lead Meta + **R8 quick-capture** en el Agent Desktop (alta inline de referido → candidato SF, verificado). **C** — backfill de leads históricos (dedup) + plan de corte (doble-ingesta ARIA-webhook/Zapier-polling, dedup por teléfono). Follow-up menor: métrica time-to-first-touch.

## 6. Decisiones a confirmar
1. **Conexión real del Page ahora vs simulada:** tenemos el token + el Page de Novasys. ¿**conecto el `leadgen` real del Page** a ARIA en la Fase A (override del Page, como el WABA) — así un form real de Meta entra de verdad — o dejo el webhook **wired + verificado por simulación** y la conexión del form real se hace cuando el cliente confirme cuál formulario? *(Recomiendo conectarlo: ya tenemos todo y prueba el valor de punta a punta.)*
2. **Salud de fuentes — dónde:** **barra "Ingesta en vivo" en LeadsPage** (conteo por fuente arriba del board — recomendado, mínimo y donde se mira) vs **página nueva `/ingesta`** (hub dedicado con más detalle). 
3. **Alcance:** ¿incluyo **R8 (quick-capture desde la llamada)** en este pilar (Fase B) o me enfoco solo en la ingesta Meta P0 y dejo R8 para después? *(R8 es P1, independiente; se puede incluir o diferir.)*

## 7. Decisiones tomadas ✅ (2026-06-19, confirmadas con el usuario)
1. **Conectar el Page real ahora** (aditivo): suscribo el app de ARIA al `leadgen` del Page `188013051209705` con el token system-user → un form real de Meta entra a ARIA; Zapier sigue en paralelo (su propio app) → habilita la doble-ingesta del corte.
2. **Salud de fuentes = barra en LeadsPage** ("Ingesta en vivo" arriba del board, conteo por fuente + resalte si cae a 0).
3. **R8 incluido** en la Fase B (quick-capture desde la llamada + referidos).

**Resolución de tenant en el webhook:** por `page_id` del evento → scan de `connectview-connections` por `meta.pageId` → tenant → token del secret `connectview/tenant/{tenantId}/whatsapp`. Para Novasys ya está el tenant `t_3176…` con el token (del takeover Pilar 4); se le agrega `meta.pageId=188013051209705`.

### Archivos que toca
- **Backend nuevo:** `amplify/functions/meta-lead-ads-webhook/`, `scripts/create-meta-lead-ads.mjs`.
- **Backend editado:** `manage-leads` (`?report=sources`), `manage-leads` POST (source referral/call + referredBy).
- **Frontend nuevo:** `SourceHealthBar.tsx`, `QuickCaptureLeadModal.tsx` (R8).
- **Frontend editado:** `LeadsPage.tsx` (SOURCE_LABEL + barra), `AgentDesktopPage`/panel cliente (quick-capture), `api.ts`/`amplify_outputs.json`.
- **Meta:** suscripción `leadgen` del Page `188013051209705` (token system-user de `WhatsAppKeyPin`).
