# Fase 4 — Expansión: canales + enterprise · Diseño

> Cierra los ❌ del roadmap ampliado que abren mercado y desbloquean deals grandes.
> Cuatro bloques **independientes**. Ver [[project_roadmap_v2]]. Grounding verificado
> por 3 exploradores (2026-07-01).

## Panorama: verificable ya vs bloqueado-cliente

| Bloque                      | Qué es                                                                    | Verificable en vivo                                           | Bloqueo                                      |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| **F4.4 Email tracking**     | pixel de apertura + wrap de links → golpes `email_opened`/`email_clicked` | ✅ total (abro el pixel → golpe + score)                      | ninguno                                      |
| **F4.2a LIST interactivo**  | mensaje `type:interactive` list (no-template)                             | ✅ total (llega a WhatsApp)                                   | ninguno (sin aprobación Meta)                |
| **F4.2b CAROUSEL template** | componente `CAROUSEL` en templates                                        | ⚠️ builder sí; envío real espera **aprobación Meta (48-72h)** | aprobación Meta                              |
| **F4.1 Mercado Libre**      | canal ML en el inbox omnicanal                                            | ⚠️ backend/skeleton sí; live no                               | **OAuth App ML del cliente**                 |
| **F4.3 SSO SAML/OIDC**      | login federado por-tenant                                                 | ⚠️ config/UI sí; login real no                                | **IdP del cliente + `ampx pipeline-deploy`** |

**Arco recomendado:** F4.4 → F4.2 (verificables, self-contained, F4.4 cierra la última pieza de
Pardot enganchándose con lo de Fase 3). F4.1 + F4.3 = **build-ahead** (backend/config listos,
go-live esperando al cliente). El deploy de F4.3 es **operacional** (ampx, lo corre el usuario/CI).

---

## F4.4 — Tracking de email 1:1 (Pardot P4) — la joya

**Insight clave (integración casi gratis):** un `email_opened` se registra como **golpe** en el
ledger (`leadSync.appendLeadHistory`); los golpes ya suben el **score** (2A, `computeScore` cuenta
6pts/golpe hasta cap 30) que dispara `recomputeLeadScore` automático; el score es campo de
**segmento** (2C) que ya **auto-inscribe en journeys** (3C). ⇒ agrego el tipo de evento y **todo el
motor de engagement reacciona solo**. Esa es la paridad Pardot que faltaba (timeline de aperturas +
clicks como señal de intención).

**Piezas:**

1. **`_shared/leadSync.ts`** (trivial): agregar `"email_opened" | "email_clicked"` a
   `LeadHistoryEvent.type` **y** a `GOLPE_TYPES`. 🔑 re-desplegar los 9 bundlers de leadSync.
2. **Tabla `connectview-email-tracking`** (PK=`token`, TTL 30d): `{token, leadId, tenantId,
campaignId?, journeyId?, url?, emailMessageId?, createdAt, expiresAt}`. Script
   `create-email-tracking.mjs` (molde `create-scoring.mjs`) + IAM (VoxCrmConnectAccess + exec roles).
3. **`_shared/emailTracking.ts`** (nuevo): `newToken()` (nanoid-ish), `storeToken(dynamo, rec)`,
   `buildTrackedHtml(html, {token, base})` → inyecta `<img src="{base}/pixel?t=token">` + reescribe
   `<a href>` a `{base}/click?t=token&u=<enc>`. Puro/testeable la parte de HTML.
4. **Lambda pública `email-tracking`** (Function URL, auth NONE, **2 permisos**):
   - `GET /pixel?t=…` → resuelve token, `appendLeadHistory(leadId, {type:"email_opened",…})`, devuelve
     GIF 1×1 transparente (headers no-cache). Token inválido → 404 silencioso (anti-enumeración).
   - `GET /click?t=…&u=…` → `appendLeadHistory(… "email_clicked", url)` + 302 redirect a `u`.
   - IAM: PutItem/UpdateItem leads (appendLeadHistory) + GetItem tracking-table.
5. **Refactor `journey-runner.sendEmail`**: antes de mandar, `newToken` + `storeToken` (con
   journeyId/leadId/tenantId) + `buildTrackedHtml` sobre el body → HTML con pixel + links envueltos.
   También registra un golpe `email_out` al enviar (hoy no lo hace). El envío ya es SESv2.
6. **(Opción A, default) trigger por engagement sin plumbing nuevo:** el admin crea un segmento
   `score >= X` (o un futuro campo `emailOpens`), y un journey con `entry.segmentId` → los que abren
   suben score → entran al journey en el próximo tick (lag ≤5 min). **Opción B** (trigger
   `email_opened` event-driven inmediato vía `fireAutomation`) = follow-up (necesita refactor del
   automation-engine). Arrancamos con A.

**Verificación:** journey manda email tracked → `curl` al pixel URL → el lead gana golpe
`email_opened` + score sube; `curl` al click URL → 302 + golpe `email_clicked`. Todo por el lead
real (limpiar después).

---

## F4.2 — WhatsApp Carousel + List interactivo

**Estado:** `_shared/waTemplateComponents.ts` arma HEADER/BODY/FOOTER/BUTTONS(+AUTH). `send-whatsapp-
template` ya manda **cualquier** componente (carousel funciona apenas esté aprobado). `send-whatsapp-
flow` ya manda `type:interactive` (flow) — un LIST interactivo es un Lambda chico que copia ese patrón.
El FlowBuilder (Pilar 8) ya tiene nodo `list`; falta nodo `carousel`.

**F4.2a — LIST interactivo (no-template, SIN aprobación) — ✅ SENDER HECHO Y VERIFICADO:**

- Lambda `send-whatsapp-list-interactive` (molde `send-whatsapp-flow`, mismo auth/BYO/gate/registro):
  payload `{type:"interactive", interactive:{type:"list", header, body, footer?, action:{button, sections:[{rows:[{id,title,description}]}]}}}`.
  `buildSections` recorta a los límites de Meta (≤10 filas, título ≤24, desc ≤72). Reusa `sendWhatsApp()`
  (router BYO) + gate de supresión + `recordSend` a hsm-sends (`list:<n>opts`). Function URL pública
  (auth NONE) vía `create-whatsapp-list.mjs` (copia el env del flow sender, sin hardcodear el secreto).
  **Verificado E2E:** dryRun = payload Meta correcto; envío real (x-vox-internal + tenantId real) =
  `sent:true` + messageId de Meta → la lista de 3 opciones llegó a +51953730189 como menú tappable.
- **Sigue (UI hook):** endpoint `sendWhatsAppList` en api.ts + botón "Enviar lista" en el composer del
  inbox (`manage-conversations` acción `sendListInteractive`) + cablear el nodo `list` del bot-runtime
  al envío real. La elección vuelve como `interactive.list_reply` al whatsapp-meta-webhook.

**F4.2b — CAROUSEL template — ✅ BACKEND HECHO + TESTEADO:**

- `waTemplateComponents.ts`: `CarouselCardIn` + `cards` en `BuildInput`; construye
  `{type:"CAROUSEL", cards:[{components:[HEADER(IMAGE), BODY, BUTTONS]}]}`. `buildButtons`/`countVars`
  extraídos y reusados por-tarjeta. Valida 2-10 tarjetas + body por tarjeta; **salta el header raíz**
  (los headers van por-tarjeta). 3 tests (`shared-wa-carousel.test.ts`) fijan la estructura Meta exacta.
- `create-whatsapp-template` acepta `cards`; `list-whatsapp-templates` extrae `cards` (body/header/
  botones por tarjeta). Los 3 Lambdas (create/update/list) re-desplegados. El sender/dialer no cambian
  (mandan el template genérico ya aprobado).
- **Sigue (para el envío real):** el UI composer con editor de tarjetas + picker de imagen (usa
  `upload-whatsapp-template-media` → `headerHandle`), y **mandar el template a aprobación de Meta**
  (queda PENDING 48-72h). El builder ya produce el payload correcto (probado); falta la UI + subir las
  imágenes de sample.

---

## F4.1 — Canal Mercado Libre (build-ahead)

**Reusa:** `_shared/conversations.ts` (`ConvChannel`, PK `channel#senderId`, `appendInbound/Outbound`),
el webhook unificado + `manage-conversations` (switch de reply por-canal), secretos de tenant
(`connectview/tenant/<id>/mercadolibre`). **Nada de ML existe hoy** en el repo.

**Construible sin cliente:** extender `ConvChannel += "mercadolibre"`; modelo de pregunta/mensaje ML
(questionId + itemId); skeleton del webhook de ML (topics `questions`/`messages`) + la rama de reply
por la REST API de ML; UI del canal en el inbox; tests de ingesta.
**Bloqueado-cliente:** OAuth 2.0 real (app_id/app_secret), URL de webhook confirmada en el dashboard
de ML, validación de firma, reply real. **Deploy:** `deploy-lambda.mjs` (hand-managed).

---

## F4.3 — SSO SAML/OIDC (build-ahead + deploy operacional)

**Estado:** `amplify/auth/resource.ts` = solo `email:true` (sin `externalProviders`). El login
(`VoxAuthContext` → `<Authenticator>`) no tiene `signInWithRedirect`. El footer ya _dice_ "SSO SAML
2.0" pero es claim de UI. La metadata del IdP viviría en `connectview-connections` (`configJson.idp`),
como el resto de la config de tenant.

**Construible sin cliente:** `externalProviders` SAML/OIDC en el auth resource (detrás de flag);
branch de login "Entrar con tu empresa" (`signInWithRedirect`); Lambda helper que resuelve la metadata
del IdP por-tenant; doc de setup para el cliente (ACS URL, entityId).
**Bloqueado-cliente:** metadata XML / OIDC discovery, certificados, Client ID/Secret, autorización en
su dashboard. **🔑 Deploy:** `amplify/auth/resource.ts` es CDK-managed → **`npx ampx pipeline-deploy`**
(regenera `amplify_outputs.json`), NO `deploy-lambda.mjs` → **operacional, lo corre el usuario/CI**
(igual que F1.1). Por eso F4.3 no se "termina" en esta sesión aunque el código quede listo.

---

## Decisiones a confirmar

1. **Alcance de esta pasada:** ¿solo lo verificable-en-vivo (F4.4 + F4.2), dejando F4.1/F4.3 como
   build-ahead para cuando el cliente dé credenciales? ¿O construir también los skeletons de ML/SSO
   ahora (aun sin poder probarlos vivos)?
2. **F4.2b Carousel:** ¿construyo el builder + mando un template a aprobación de Meta ya (para que
   corra el reloj de 48-72h en paralelo), o me quedo solo en F4.2a LIST (verificable hoy) y dejo
   carousel para cuando haya con qué probar?
3. **F4.4 trigger:** arranco con **Opción A** (segmento por score → auto-enroll, lag ≤5 min, cero
   plumbing) y dejo el trigger inmediato `email_opened` (Opción B) como follow-up. ¿OK?
