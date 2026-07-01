# Fase 5 — Activación con cliente, hardening y go-live · Diseño

> Prender lo que el **código ya soporta pero depende de una acción del cliente** +
> endurecer para producción. Ver [[project_roadmap_v2]], ROADMAP-V2-5-FASES.md §Fase 5.
> Casi todo es **activación/coordinación** con UDEP; poco código nuevo.

## Estado por ítem (2026-07-01)

| Ítem     | Qué es                                      | Estado                                                                             |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| **F5.1** | Write-back de golpes (R4) a `Vox*__c` en SF | ✅ **código HECHO + desplegado** · live cuando el cliente cree los campos          |
| **F5.2** | Deliverability WhatsApp real                | ✅ **código ya completo** (meta-mode) · live = conectar el número meta-standalone  |
| F5.3     | IG comments a nivel app                     | ✅ **código listo** (webhook maneja IG comments) · bloqueado en App Review de Meta |
| F5.4     | `agent-channel-adapter` en vivo             | ✅ **YA ACTIVADO** (DRY_RUN=false + IAM + número configurado)                      |
| F5.5     | Suite e2e Playwright                        | ✅ **HECHO + verificado** (login Cognito + 9 rutas críticas montan)                |
| F5.6     | Hardening + runbook                         | ✅ **HECHO** (CI GitHub Actions + hardening-notes + DEMO_RUNBOOK actualizado)      |

---

## F5.1 — Write-back de golpes (R4) a Salesforce · ✅ HECHO

**Insight:** `summarizeGolpes(history)` (Pilar 2) ya calcula `{ total, lastTouchAt, firstTouchAt,
converted, touchesToClose, daysToClose }`. Faltaba **escribirlo al Lead de SF** en campos custom
`Vox*__c` para que Adriana vea "cuántos golpes por conversión" (R4) en su reporte de Salesforce.

**Implementación (`_shared/leadSync.ts`):**

- `LeadInput` gana `history?` (opcional). `pushLeadToSalesforce`, si el lead trae `history`, computa
  `summarizeGolpes` y agrega los campos rollup a `fields`:
  - `VoxTouches__c` ← total · `VoxLastTouch__c` ← lastTouch (fecha) · `VoxFirstTouch__c` ← firstTouch
  - `VoxConverted__c` ← converted (checkbox) · si convirtió: `VoxTouchesToClose__c`, `VoxDaysToClose__c`.
- **Degradación con gracia (patrón `VoxLeadId__c`):** `sfWriteLead` ahora, ante `INVALID_FIELD`,
  identifica el campo ofensor (`invalidFieldName`, parsea "No such column 'X'"), lo descarta y
  reintenta (loop). Solo descarta campos OPCIONALES de Vox (extId + rollup); un campo inválido ajeno
  (mapeo mal del cliente) se propaga. Cachea los faltantes (`voxRollupMissing`) → no reintenta cada vez.
- Cableado en los 2 callers: el sync automático (`propagateLead` usa `stored.history`, trae el golpe
  recién sumado) y el "Enviar a Salesforce" manual (`manage-leads pushSf`).

**Verificación:** `invalidFieldName` unit-testeado (`shared-leadsync-sf.test.ts`, 4 tests) — es el parser
de riesgo (decide qué campo dropear). Los 11 bundlers de `leadSync` re-desplegados. **Live (diferido):**
cuando el cliente cree `VoxTouches__c` etc. en su org, el rollup aparece; hasta entonces el sync degrada
(se probó que el patrón idéntico de `VoxLeadId__c` ya funciona así en producción).

**Bloqueado-cliente:** crear los campos `Vox*__c` (Number/Date/Checkbox) en el Lead de su org SF.

---

## F5.2 — Deliverability WhatsApp real · ✅ código completo, falta activar el número

**Hallazgo (auditoría 2026-07-01): el pipeline ya está entero para meta-mode (BYO Cloud API).** No es
un build, es **activación**. Lo que existe y funciona:

- **Status webhook:** `whatsapp-meta-webhook` procesa `value.statuses[]` (sent/delivered/read/failed) →
  `handleStatus` → `updateHsmStatus(dynamo, id, status, {errors})` (idempotente, solo avanza por rank).
- **Registro por-envío:** `recordHsmSend` (send-whatsapp-template) escribe `connectview-hsm-sends`
  (PK=`sendId`=messageId, status inicial "sent"); `_shared/hsmStatus.ts` categoriza fallas y detecta
  las **permanentes** (131026/130472/131045 = número inválido/bloqueado).
- **Cuarentena automática:** falla permanente → `recordSuppression(status:"quarantined", source:
"status_webhook")` → bloquea envíos futuros (gate del Pilar 3).
- **STOP → opt-out → SF:** palabra clave STOP entrante → `recordOptOut` → supresión + `pushDoNotCall
ToSalesforce` (DoNotCall=true). Simétrico con ALTA. End-to-end.
- **Salud + analytics:** `get-whatsapp-health` (quality rating real, dual-mode aws/meta) +
  `get-whatsapp-analytics` (template_analytics de Meta) con paneles en la app.
- **Reporte HSM:** `HsmOutboundReport` muestra enviados/entregados/leídos/fallidos + tasas.

**Dual-mode:** en **aws-mode** (Connect-anclado, como el número legacy de UDEP) el event-destination es
la instancia de Connect → los `statuses[]` NO llegan (mutex con el inbound). El estado por-mensaje solo
se ilumina en **meta-mode** (número standalone `+51 908 825 660` conectado por Cloud API).

**Verificación (lo que SÍ se puede sin el número en vivo):** simular un `statuses[]` webhook contra
`whatsapp-meta-webhook` con un `hsm-send` sembrado → confirmar que el estado avanza (sent→delivered) y
que una falla permanente dispara la cuarentena. (Datos de prueba sembrados y limpiados.)

**Bloqueado-cliente (go-live):** conectar el número meta-standalone (`whatsapp.mode="meta"` +
metaPhoneNumberId + token en el secret del tenant) y confirmar la URL del webhook en Meta →
deliverability por-mensaje + cuarentena + STOP en vivo. Ventana coordinada (repuntar webhook es
disruptivo).

---

---

## F5.3 — Comentarios de Instagram a nivel app · ✅ código listo, falta App Review de Meta

**El código YA maneja comentarios de IG.** `meta-messaging-webhook` (líneas 169-198) procesa
`changes[]` con `field === "comments"` → `platform: "instagram"` → `appendComment` → entran al inbox
como conversación `fb_comment` (responder público / pasar a privado). No hay nada que construir.

**Bloqueado-cliente (activación en el panel de Meta):**

1. En la **Meta App** → Webhooks → suscribir el objeto **`instagram`** con el campo **`comments`**
   (hoy la Página tiene el override_callback_uri unificado; falta el objeto instagram).
2. **App Review** del permiso **`instagram_manage_comments`** (Meta exige revisión para comentarios de
   IG en producción). Con eso, los comentarios de IG del cliente empiezan a caer al inbox solos.

## F5.4 — `agent-channel-adapter` en vivo · ✅ YA ACTIVADO

Auditoría 2026-07-01: **ya está prendido.** El adapter (`connectview-agent-channel-adapter`) tiene
`DRY_RUN=false`, `WHATSAPP_PHONE_NUMBER_ID=phone-number-id-720bc945…` configurado, y el rol
`campaign-lambda-role` tiene la inline `WhatsAppSend` = `social-messaging:SendWhatsAppMessage` sobre ese
mismo `phone-number-id`. ⇒ el agente IA responde por WhatsApp real cuando lo invoca un contact flow.
Para **tenants BYO** (número propio, como UDEP) ni siquiera aplica el gate DRY_RUN: envían desde SU
número apenas cargan su End User Messaging (`getTenantConnect`). No queda nada para F5.4.

> Nota: no hicimos un envío real de prueba (guardrail de envíos externos); la verificación es de
> configuración (env + IAM + número). Un smoke-test de envío requiere pedido explícito.

---

## F5.5 — Suite e2e Playwright · ✅ HECHO + verificado

`playwright.config.ts` con 3 proyectos: **smoke** (sin auth, corre siempre), **setup**
(`e2e/auth.setup.ts` loguea vía el Authenticator de Amplify → guarda `storageState`) y **authed**
(`*.authed.spec.ts`, reusa la sesión). Gateado por env `TEST_EMAIL`/`TEST_PASSWORD` → sin creds
solo corre el smoke (CI/máquinas sin usuario de prueba). `e2e/app-shell.authed.spec.ts`: la sesión
sigue activa + **9 rutas críticas** (leads, campaigns, journeys, inbox, reports, automations,
programs, bot, admin) montan sin crashear, sin caer al login, sin errores de página.
**Verificado en vivo:** creé un usuario Cognito de prueba (scopeado al tenant demo), corrí la suite
→ 11/11 verde (login real + navegación); borré el usuario. Specs read-only (no ensucian datos).
**Follow-up:** flujos de mutación (alta de lead con cleanup) + fixture de sesión Connect.

## F5.6 — Hardening + runbook + CI · ✅ HECHO

- **CI (`.github/workflows/ci.yml`):** job **quality** bloqueante (typecheck + unit + build) +
  **lint** no-bloqueante (deuda pre-existente ~97 en archivos viejos; husky ya exige que lo nuevo
  pase) + **e2e** no-bloqueante (smoke siempre; authed si hay secretos `TEST_EMAIL`/`TEST_PASSWORD`).
  Fix: `eslint.config.js` ignora ahora `.amplify`/`dist-lambda`/`coverage`/reportes.
- **Hardening:** `design/hardening-notes.md` — IAM (rol saturado, scoping por ARN), superficie
  pública (webhooks auth NONE + mitigaciones, TODO rate-limit), secretos en SM, aislamiento de tenant.
- **Runbook:** `DEMO_RUNBOOK.md` actualizado (sección 2026-07-01: novedades Fase 2-5 + corrige claims
  viejos) + `design/go-live-runbook.md` (checklist de activaciones del cliente).
