# Pilar 10 — Salesforce schema-aware mapping

**R24:** _"ARIA no crea campos; el cliente indica qué campos de SF se actualizan."_
El mapeo de campos ARIA→Salesforce, antes hardcodeado en `leadSync`, ahora es
**configurable por tenant** sobre el esquema REAL de su org (BYO: cada tenant usa
su propia org vía OAuth, así que el `describe` pega a SU Salesforce).

## El seam

Antes (hardcodeado, `leadSync.ts` pushLeadToSalesforce):
`{ FirstName, Phone, Email, Status, LastName, Company, LeadSource, VoxLeadId__c }`.
El stage↔Status ya era dinámico (taxonomía `salesforceValue`); lo que faltaba era
elegir **a qué campo** del Lead del cliente va cada dato.

## Implementación (commit `6746ea3` + `f559afe`)

### Backend

- **`salesforceClient.describeSObject(sobject="Lead")`** — GET
  `/sobjects/Lead/describe` → campos ESCRIBIBLES (createable|updateable) con
  `name/label/type/custom/picklistValues`. Read-only. + `deleteSObject` (utilidad).
- **`leadSync`** — `setActiveSfMapping(mapping)` (módulo, como setActiveDynamo) +
  `sfTarget(field)` + `put(field,val)`. `pushLeadToSalesforce` arma `fields`
  dinámicamente: cada campo ARIA va a su target SF mapeado; target `""` = no
  escribir (R24). **LastName + Company quedan fijos** (requeridos por SF al crear);
  el External Id (`VoxLeadId__c`) tampoco es remapeable (dedup determinístico).
- **`salesforce-sync`** — `?mode=describe` (alimenta la UI) + carga el
  `fieldMapping` del tenant (`connectview-connections.salesforce.fieldMapping`) y
  `setActiveSfMapping` antes de `propagateLead`.

### Frontend

- **`IntegrationsManager` → `SfFieldMapper`** (en la SalesforceCard, solo si está
  conectado): botón "Descubrir campos de mi org" (→ describe), un `<select>` por
  cada campo ARIA (Nombre/Teléfono/Email/Empresa/Etapa→Status/Origen) poblado con
  los campos reales (estándar + custom, con sus labels), opción "No escribir", y
  "Guardar mapeo" (→ `manageConnections`, config completo para no pisar la conexión).
- `useConnections.SalesforceConn += fieldMapping`.

### Storage

- `connectview-connections[tenantId].configJson.salesforce.fieldMapping`
  (`{ ariaField: sfFieldName }`). El GET de manage-connections lo preserva
  (`{ ...sfPrev, connected }`).

## Verificación en vivo (Browser 1, org real "Novasys del peru")

- **describe:** 42 campos escribibles, 5 custom (ProductInterest**c, SICCode**c…) +
  el picklist de Status. La UI los lista con labels en español. ✓
- **guardar mapeo:** persiste en DynamoDB (toast "Mapeo guardado"). ✓
- **E2E (lead de prueba, creado+borrado):** remapeé `email → SICCode__c`, sincronicé
  un lead → el valor cayó en el campo **custom** `SICCode__c='P10-OK'` y NO en el
  estándar `Email` (vacío); FirstName/LastName/Status mapearon bien; el lead se
  borró (sin rastro). El remapeo redirige el dato al campo elegido. ✓
  (Bonus: con un valor de 16 chars, SF rechazó por `STRING_TOO_LONG` en SICCode\_\_c
  → confirma que escribe en ESE campo y respeta su validación.)

## LE1 — mapeo UNIVERSAL (commit `d19b239`)

El mapeo ya no es solo del wrap-up: `pushLeadToSalesforce` **auto-carga** el
`fieldMapping` del tenant desde `connectview-connections` (vía
`salesforceClient.getActiveTenantId()`, cacheado 5 min). Aplica a TODOS los callers
de `propagateLead` (tablero, webhooks Meta/WhatsApp, web-form, automatización) —
los 7 ya llaman `setActiveTenant`. Verificado E2E con el auto-load (sin setter
manual): email→SICCode\_\_c cayó en el custom. Se quitó el `setActiveSfMapping` manual.

## Pendientes opcionales (Adriana / v2)

- Campos extra mapeables (montoEstimado → currency, attributes.\* → custom).
- Validación pre-flight de tipos/picklists en la UI; backfill con el mapeo nuevo.

> **Pilar 10 COMPLETO** — último pilar grande del roadmap UDEP.
