# F4.1 — Canal Mercado Libre en el inbox omnicanal · Diseño

> Sumar **Mercado Libre** (preguntas de publicaciones + mensajes post-venta) como un canal
> más del inbox omnicanal (Pilar 6). **Build-ahead:** plumbing + UI + tests listos; el go-live
> espera la **OAuth App del cliente** (app_id/secret) + confirmar la URL del webhook en el panel
> de ML. Deploy hand-managed (`deploy-lambda.mjs`). Ver [[project_pilar6_inbox]], design/fase-4.md §F4.1.

## Grounding (verificado 2026-07-01)

- **`_shared/conversations.ts`** — modelo del inbox: `ConvChannel` (hoy `instagram|messenger|whatsapp|
fb_comment`), `Conversation` (`conversationId = channel#senderId`, `messages[]` append cap 200),
  `appendInbound`/`appendOutbound`/`patchConversation`/`listConversations`. Tabla pooled
  `connectview-conversations`. **ML entra como un `ConvChannel` más.**
- **`meta-messaging-webhook`** — molde del webhook inbound: GET verify (challenge), POST parsea
  `entry[]`, `findTenant(metaId)` (scan de connections por `configJson.meta.pageId`), `getTenantToken`
  (secret `connectview/tenant/<id>/whatsapp`), y hace `appendInbound`/`appendComment`.
- **`manage-conversations`** — switch de reply por-canal (`reply`/`replyComment`/`commentToDm`/
  `sendListInteractive`), resuelve token del tenant, escribe por la Graph, `appendOutbound`, y registra
  **golpe** en el lead vinculado (`appendLeadGolpe`, Pilar 2). Acciones `markRead`/`close`/`link`/`unlink`.
- **Inbox UI:** `InboxPage.tsx` (lista + filtros por canal `FILTERS`), `channelMeta.ts`
  (`chipType`/`CH_COLOR`/`CH_LABEL` — el mapeo canal→UI), `ConversationThread.tsx` (composer con
  botones condicionales por canal), `useConversations.ts` (tipo `ConvChannel` espejo + mutations).
- **API de ML** ([docs](https://developers.mercadolibre.com.ar/en_us/products-receive-notifications)):
  webhook POST `{ resource, user_id, topic, application_id, sent, attempts }` — responder **200 rápido**;
  luego `GET https://api.mercadolibre.com{resource}` con `Authorization: Bearer <token>`.
  - **Preguntas** (topic `questions`): `resource=/questions/<id>` → `{ id, text, item_id, from:{id}, status }`.
    Responder: `POST /answers` `{ question_id, text }`.
  - **Mensajes post-venta** (topic `messages`): `resource=/messages/packs/<packId>/sellers/<sellerId>`.
    Responder: `POST /messages/packs/<packId>/sellers/<sellerId>` `{ from:{user_id}, to:{user_id}, text }`.
  - **OAuth 2.0** (code flow, tokens 6h + refresh single-use): `auth.mercadolibre.com.pe/authorization`
    → `POST /oauth/token`.

## Por qué es build-ahead

No hay OAuth App del cliente (app_id/secret) ni URL de webhook confirmada en el panel de ML, así que
el envío/recepción real no se puede probar en vivo. Construimos: el tipo de canal, el modelo ML en la
conversación, el webhook (parseo + fetch del resource + `appendInbound`), la rama de reply en
`manage-conversations`, la UI del canal, la tarjeta de config con OAuth-start (skeleton), y **tests de
ingesta puros** (parsean una notificación ML → conversación) — eso sí es verificable.

## Modelo de datos (extensión de `Conversation`)

`senderId` = **user_id del comprador** en ML (agrupa la conversación por persona). Campos ML nuevos
(análogos a `commentId/postId` de fb_comment):

```ts
// _shared/conversations.ts
export type ConvChannel = "instagram" | "messenger" | "whatsapp" | "fb_comment" | "mercadolibre";
// en Conversation:
ml?: {
  kind: "question" | "message";
  questionId?: string;   // para responder una pregunta (POST /answers)
  itemId?: string;       // la publicación (contexto)
  packId?: string;       // para responder post-venta (POST /messages/packs/...)
  sellerId?: string;     // = user_id del seller (tenant)
  buyerId?: string;      // = user_id del comprador (= senderId)
};
```

`appendMlInbound(dynamo, {...})` = wrapper fino sobre `appendInbound` (channel `mercadolibre`) que
además setea `conv.ml`. Reusa el resto (unread, preview, identidad).

## `_shared/mercadolibre.ts` (nuevo, puro + testeable)

- `parseNotification(body)` → `{ topic, resource, userId } | null` (valida forma).
- `resourceKind(resource)` → `"question" | "message" | null` + ids parseados del path.
- `mlGet(token, resource)` / `answerQuestion(token, questionId, text)` /
  `sendMlMessage(token, packId, sellerId, buyerId, text)` (fetch a `api.mercadolibre.com`).
- `resolveMlSecret(tenantId)` → lee `connectview/tenant/<id>/mercadolibre` = `{ accessToken,
refreshToken, userId, expiresAt }` de Secrets Manager. (Refresh de token: follow-up — necesita
  app_id/secret del cliente.)
- El parseo (`parseNotification`/`resourceKind`) es **puro** → los tests fijan la ingesta sin AWS.

## Sub-fases (todas HECHAS · 2026-07-01)

- **F4.1-A — modelo + shared: ✅** `ConvChannel += "mercadolibre"`, `MlContext` + `ml` en `Conversation`
  - `appendMlInbound` (`_shared/conversations.ts`); `_shared/mercadolibre.ts` puro
    (`parseNotification`/`resourceKind` + `mlGet`/`answerQuestion`/`sendMlMessage`/`resolveMlSecret`).
    7 tests `shared-mercadolibre.test.ts` (ingesta).
- **F4.1-B — webhook `mercadolibre-webhook`: ✅ DESPLEGADO + verificado en vivo.** GET→200; POST:
  `parseNotification`→`resourceKind`→`findTenant(userId)`→`resolveMlSecret`→`mlGet`→`appendMlInbound`.
  Responde 200 SIEMPRE. Function URL pública (`create-lambda.mjs`, rol campaign-lambda-role). Firma =
  TODO (necesita app secret). **Verificado:** GET `{ok,service}`, POST pregunta sin tenant →
  `{ignored:"tenant no encontrado"}`, POST topic no soportado → `{ignored:"topic no soportado: orders"}`.
- **F4.1-C — reply (`manage-conversations`): ✅ DESPLEGADO + verificado.** Rama `channel==="mercadolibre"`
  en `action:"reply"`: question→`answerQuestion`, message→`sendMlMessage`; `appendOutbound` + golpe.
  **Verificado en vivo:** con una conversación ML sembrada, el reply enruta a ML → "Mercado Libre no está
  conectado para este tenant" (el tenant demo no tiene token; NO cae al path de Meta). Datos limpiados.
- **F4.1-D — UI del inbox: ✅ verificado.** `ConvChannel += "mercadolibre"` (frontend), `CH_COLOR`/
  `CH_LABEL`/`chipType` + `ChannelType` "mercadolibre" (chip amarillo `#ffe600`/`ch--mercadolibre`),
  filtro "Mercado Libre" en `FILTERS`, badge "Pregunta/Post-venta" en el hilo, hint del composer por-canal.
  **Verificado Browser 1:** tab + chip + hilo + badge renderizan con una conversación sembrada.
- **F4.1-E — config: ✅ DESPLEGADO + verificado.** `MercadoLibreCard` (reusa `ConnCard`): país,
  "Conectar con Mercado Libre" (OAuth-start), y **URL del webhook** read-only. `config.mercadolibre` en
  connections. `mercadolibre-oauth-start` Lambda desplegado (skeleton; 500 hasta que exista el secret
  `connectview/mercadolibre` + `ML_OAUTH_CALLBACK_URL`). **Verificado:** la tarjeta muestra la URL real
  del webhook desplegado.

## Verificación

- **Verificado en vivo:** 7 tests de ingesta; webhook desplegado (GET/POST 200, ruteo por topic/tenant);
  reply enruta a ML (no a Meta); UI del canal (tab/chip/hilo/badge) con conversación sembrada; tarjeta de
  config con la URL del webhook real. tsc/eslint/build verdes, 47/47 tests.
- **Diferido (cliente):** OAuth real (app_id/secret → secret `connectview/mercadolibre` + callback Lambda),
  refresh de token, validación de firma, y el reply/inbound REAL contra ML. Endpoints ya desplegados y
  cableados en `amplify_outputs.json`.

## Decisiones a confirmar

1. **Alcance de tipos ML:** ¿**preguntas + mensajes post-venta** (canal completo) o **solo preguntas**
   (el caso pre-venta/lead, más simple)?
2. **OAuth:** ¿construyo el **skeleton de OAuth-start** (`mercadolibre-oauth-start` + tarjeta con
   "Conectar", bloqueado sin credenciales) o dejo la config mínima (solo pegar tokens/webhook a mano)
   por ahora?
3. **Deploy de infra nueva:** el webhook necesita `create-*.mjs` (Function URL) + IAM (VoxCrmConnectAccess
   dynamo conversations + SM read del secret ML). ¿Lo **despliego yo** (infra en cuenta Novasys, como el
   resto) o lo dejo escrito para que lo corra el usuario?
