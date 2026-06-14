# Salesforce — Setup del conector Vox (#23)

Conector **bidireccional** entre Vox y Salesforce.
- **Vox → SF:** al cerrar un wrap-up, upsert de Lead (por teléfono/email) + tipificación→Lead Status + un Task con la gestión.
- **SF → Vox:** un Flow en SF dispara un HTTP callout cuando un Lead se crea/actualiza → Vox upserta el Customer Profile.

Org de pruebas: `orgfarm-08ac86e320-dev-ed`
My Domain (API): `https://orgfarm-08ac86e320-dev-ed.develop.my.salesforce.com`

URLs de los Lambda (ya desplegados):
- **sync (Vox→SF):** `https://xbs2jazixr3iyfrhn76hm7ryeu0zjjjv.lambda-url.us-east-1.on.aws/`
- **inbound (SF→Vox):** `https://z3i5dvi7rnmcrtxop5dnl5pf2i0okkia.lambda-url.us-east-1.on.aws/`

---

## Paso 1 — Connected App (OAuth **JWT Bearer Flow**) · lo hacés vos en SF

> El conector usa **JWT Bearer** (server-to-server, sin client secret): el Lambda firma un JWT con una **llave privada** cuyo **certificado** está cargado en la Connected App.

0. **Generá el par de llaves** (terminal): `openssl req -x509 -newkey rsa:2048 -nodes -keyout vox-sf.key -out vox-sf.crt -days 3650 -subj "/CN=Vox Connector"`
1. **Setup → App Manager → New Connected App**. Nombre `Vox Connector`, tu email.
2. ✅ **Enable OAuth Settings**. Callback URL: `https://login.salesforce.com/services/oauth2/callback`
3. ✅ **Use digital signatures** → subí el **`vox-sf.crt`**.
4. **OAuth Scopes:** `Manage user data via APIs (api)` + `Perform requests at any time (refresh_token, offline_access)`. **Save** (esperá ~5-10 min).
5. **Manage → Edit Policies → OAuth Policies → Permitted Users = "Admin approved users are pre-authorized"**. Save.
6. **Manage → Profiles** (o **Permission Sets**) → **Add** el perfil/permset del usuario admin run-as. ⚠️ *Este es el paso que falta hoy (ver Troubleshooting).*
7. **Manage Consumer Details** → copiá el **Consumer Key**.

## Paso 2 — Guardar las credenciales (vos, en tu terminal — NO en el chat)

```bash
aws secretsmanager put-secret-value --secret-id connectview/salesforce --region us-east-1 \
  --secret-string '{"consumerKey":"CONSUMER_KEY","username":"admin@tu-org.com","privateKey":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----","audience":"https://login.salesforce.com"}'
```
> Shape **JWT** (`consumerKey`/`username`/`privateKey`/`audience`), **no** client-credentials. `privateKey` = contenido de `vox-sf.key`. `audience` = `https://login.salesforce.com` (dev/prod) o `https://test.salesforce.com` (sandbox).

Con eso el sync Vox→SF queda activo. Probalo:
```bash
curl -s -X POST "https://xbs2jazixr3iyfrhn76hm7ryeu0zjjjv.lambda-url.us-east-1.on.aws/" \
  -H "Content-Type: application/json" \
  -d '{"customerPhone":"+51953730189","customerName":"Andre Bodega","company":"Bodega Alata","stageLabel":"Interesado","subStageLabel":"Volver a WhatsApp","valoracion":"positiva","notes":"Prueba de sync"}'
```
Esperado: `{"ok":true,"leadId":"00Q...","action":"created","taskId":"00T..."}`

## Paso 3 — Mapear la tipificación → Lead Status (en Vox)

En **Vox → Configuración → Tipificación**, por cada stage llená el campo **"SF Lead Status →"** con el valor EXACTO del picklist `Status` de Lead en tu SF (ej. `Open - Not Contacted`, `Working - Contacted`, `Closed - Converted`, `Closed - Not Converted`). Guardá. Si lo dejás vacío, el Lead se crea sin tocar Status.

## Paso 4 — SF → Vox: Flow + HTTP callout · lo hacés vos en SF

1. **Generá el token de entrada de TU organización** (es per-tenant, no compartido):
   en **ARIA → Configuración → Integraciones → Salesforce → "Webhook de entrada
   (SF → ARIA)" → Generar token**. Copiá el valor (se muestra una sola vez).
   *(Alternativa CLI/ops: `node scripts/set-sf-inbound-token.mjs t_<tu-tenantId>`.)*
2. **Setup → Named Credentials → External Credential** nueva (Auth Protocol: *Custom*), y una **Named Credential** apuntando a la URL del inbound webhook:
   `https://z3i5dvi7rnmcrtxop5dnl5pf2i0okkia.lambda-url.us-east-1.on.aws/`
   - Agregá un *Custom Header*: `x-vox-token` = `<EL TOKEN QUE GENERASTE EN EL PASO 1>`
   (Alternativa rápida: **Remote Site Setting** con esa URL + mandar el header desde el Flow.)

   > 🔐 El token es **exclusivo de tu organización** (`voxsf.<tenantId>.…`). El
   > webhook resuelve el tenant DESDE el token e ignora cualquier `tenantId` del
   > body, así que con tu token sólo se puede escribir en TUS datos. Si se filtra,
   > rotalo desde el mismo botón (invalida el anterior). El viejo secret GLOBAL
   > (`SF_WEBHOOK_SECRET`) quedó retirado/revocado.
3. **Setup → Flows → New → Record-Triggered Flow** sobre **Lead**, al *crear y actualizar*.
4. Acción: **HTTP Callout** (o "Action: Call External Service") POST a la Named Credential, body JSON:
   ```json
   {
     "phone": "{!$Record.Phone}",
     "mobilePhone": "{!$Record.MobilePhone}",
     "firstName": "{!$Record.FirstName}",
     "lastName": "{!$Record.LastName}",
     "email": "{!$Record.Email}",
     "company": "{!$Record.Company}",
     "status": "{!$Record.Status}",
     "leadId": "{!$Record.Id}",
     "source": "{!$Record.LeadSource}"
   }
   ```
5. Activá el Flow. Cuando un Lead cambie en SF, Vox actualiza el Customer Profile del teléfono.

> **Nota anti-loop:** Vox→SF crea Leads con `LeadSource = "Vox"`. Si querés evitar que esos disparen el Flow de vuelta, agregá una condición de entrada al Flow: `LeadSource != "Vox"`.

---

## Estado de verificación (2026-06-01, verificado por Claude)
- ✅ **Vox-side OK:** ambos Lambdas desplegados (Function URLs vivas), secret `connectview/salesforce` con shape JWT correcto (`consumerKey`/`username`/`privateKey` PEM/`audience`), y la **firma JWT es aceptada por SF** (el cert coincide con la llave).
- ✅ **Outbound Vox→SF: OAuth verificado FUNCIONANDO (2026-06-01).** Se resolvió `invalid_grant: user hasn't approved this consumer` pre-autorizando el perfil **"Administrador del sistema"** + **Permitted Users = "Admin approved users are pre-authorized"**. Verificado con `?mode=ping` (SOQL read-only) → org **"Novasys del peru"** respondió OK, sin crear registros. El upsert real de Lead+Task se dispara al guardar un wrap-up en Vox. *(Health-check: `curl -X POST <sync-url> -d '{"mode":"ping"}'`.)*
- ⏳ Inbound SF→Vox: depende del Flow en SF (paso 4). Ahora requiere el **token
  per-tenant** en el header `x-vox-token` (generalo en Integraciones / con
  `set-sf-inbound-token.mjs`); el secret global `SF_WEBHOOK_SECRET` ya no aplica.
- ✅ Mapeo stage→Lead Status: editable en Configuración → Tipificación.

## Troubleshooting — `invalid_grant: user hasn't approved this consumer`
Es el **bloqueo actual**. En JWT Bearer significa que el **usuario run-as no está pre-autorizado** en la Connected App. Fix (lado SF):
1. **App Manager → Vox Connector → Manage → Edit Policies → OAuth Policies → Permitted Users = "Admin approved users are pre-authorized"** → Save.
2. **Manage → Profiles** (o **Permission Sets**) → **Add** el perfil/permset del usuario `username` del secret.
3. Reintentá el `curl` del Paso 2 → debe devolver `leadId`.

*(No es el certificado: si no coincidiera, el error sería de firma/assertion, no "user hasn't approved".)*

## Seguridad
- Las credenciales SF viven en Secrets Manager (`connectview/salesforce` para la
  app compartida; `connectview/tenant/<id>/salesforce` para el OAuth de cada
  tenant), nunca en código ni en el repo.
- **Inbound webhook — token per-tenant.** El header `x-vox-token` es un token
  DISTINTO por organización (`voxsf.<tenantId>.<secret>`, en
  `connectview/tenant/<id>/sf-inbound`). El webhook resuelve el tenant DESDE el
  token (comparación constant-time contra el secret guardado) y **fuerza** ese
  tenantId, ignorando el body — un token sólo escribe en los datos de SU tenant.
  Sin token válido → 401; tenant real sin BYO Data Plane → 403.
- **El secret GLOBAL `SF_WEBHOOK_SECRET` quedó RETIRADO.** El valor que estuvo en
  versiones previas de este archivo (`vox_5038…`) está **revocado** (fue commiteado
  y vive en el historial de git → tratarlo como comprometido). Cada tenant debe
  usar su token per-tenant (paso 1 del Paso 4). Rotación: botón "Rotar token" en
  Integraciones o `scripts/set-sf-inbound-token.mjs` (invalida el anterior).
