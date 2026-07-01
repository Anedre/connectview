# Fase 5 — Activación con cliente, hardening y go-live · Diseño

> Prender lo que el **código ya soporta pero depende de una acción del cliente** +
> endurecer para producción. Ver [[project_roadmap_v2]], ROADMAP-V2-5-FASES.md §Fase 5.
> Casi todo es **activación/coordinación** con UDEP; poco código nuevo.

## Estado por ítem (2026-07-01)

| Ítem     | Qué es                                      | Estado                                                                            |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| **F5.1** | Write-back de golpes (R4) a `Vox*__c` en SF | ✅ **código HECHO + desplegado** · live cuando el cliente cree los campos         |
| **F5.2** | Deliverability WhatsApp real                | ✅ **código ya completo** (meta-mode) · live = conectar el número meta-standalone |
| F5.3     | IG comments a nivel app                     | ❌ bloqueado (App Secret / App Review de Meta)                                    |
| F5.4     | `agent-channel-adapter` en vivo             | ❌ bloqueado (flip `DRY_RUN=false` + número real)                                 |
| F5.5     | Suite e2e Playwright                        | ⬜ pendiente (buildable; requiere resolver login Cognito)                         |
| F5.6     | Hardening + runbook                         | ⬜ pendiente                                                                      |

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

## Sigue en Fase 5 (no en esta pasada)

- **F5.5 — e2e Playwright:** resolver login Cognito (test user + storageState) + specs de flujos críticos.
- **F5.6 — hardening + `DEMO_RUNBOOK.md`:** repaso IAM, rate limits, runbook al día, e2e en CI.
- **F5.3 / F5.4:** bloqueados en credenciales/número del cliente.
