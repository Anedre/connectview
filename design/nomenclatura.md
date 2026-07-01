# Nomenclatura y taxonomía de funciones · ARIA

> Cómo diferenciar, sin renombrar nada, el **Núcleo ARIA** (el producto de Novasys) de
> la **capa de Integraciones/Conectores** (glue a sistemas externos). Se aplica con
> **tags de AWS** (no-disruptivo) vía `scripts/tag-lambdas.mjs` + esta convención para
> lo nuevo. Contexto: no hay funciones "de UDEP" — todo es plataforma genérica
> multi-tenant; UDEP es un tenant que la usa por config/BYO.

## Por qué tags y no renombrar

Renombrar un Lambda desplegado rompe: su Function URL, `amplify_outputs.json`
(`apiEndpoints`), `src/lib/api.ts`, los ARN en las policies de IAM, y las reglas de
EventBridge. Es una migración grande y riesgosa. Los **tags** diferencian en la consola,
en Cost Explorer (cost-allocation tags) y por CLI, **sin tocar el runtime**.

> ⚠️ La cuenta Novasys (731736972577) tiene ~265 Lambdas; solo ~105 son de ARIA
> (`connectview-*` + `amplify-connectview-*`). El resto son otros proyectos (NovaDialer,
> NovaCitas, multisalud, ND-\*, SBS…) y **no** se tocan. El script los ignora.

## Esquema de tags

| Tag            | Valores                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aria:product` | `ARIA` (marca todo lo de la plataforma)                                                                                                                       |
| `aria:layer`   | `core` · `integration`                                                                                                                                        |
| `aria:domain`  | core: `contact-center` `campaigns` `crm` `inbox` `ai` `admin` · integration: `salesforce` `whatsapp` `meta` `mercadolibre` `connect` `email` `web` `webhooks` |

**Criterio core vs integration:** una función es **integration** si su trabajo PRIMARIO es
hablar con un sistema externo/de terceros (Salesforce, Meta Graph, Mercado Libre, la API de
Connect para provisión/federación, SES, webhooks salientes) o preparar una integración de
tenant. Si su trabajo es lógica/datos propios de ARIA (aunque por debajo use una integración),
es **core**. Ej.: `manage-conversations` (el inbox) es core aunque llame a Meta para responder;
`send-whatsapp-template` es integration porque su razón de ser ES llamar a Meta.

## Taxonomía (105 funciones · 74 núcleo + 31 integración)

### Núcleo ARIA

- **`contact-center`** (27) — Agent Desktop, CCP, grabaciones, transcripts, Cliente 360, cola en
  vivo, eventos de contacto: `admin-*-contact`/`admin-change-agent-status`, `get-agent-active-contact`,
  `get-realtime-metrics`, `get-live-queue`, `get-live-transcript`, `get-contact-detail`,
  `get-contact-history`, `get-customer-attachments`, `get-customer-thread`, `get-recording`,
  `query-contacts`, `process-contact-event`, `enrich-contact-lens`, `save-agent-notes`,
  `lookup-customer-profile`, `search-customer-profiles`, `update-customer-profile`,
  `list-recent-customers`, `list-contact-flows`, `list-source-phones`, `list-email-addresses`,
  `list-queues`, `get-flow-queues`, `list-missed-contacts`.
- **`campaigns`** (13) — dialer y campañas: `create/control/update/clone/relaunch/list-campaign(s)`,
  `campaign-dialer`, `get-campaign-*`, `assign-campaign-agents`, `edit-campaign-contacts`,
  `start-outbound-contact`.
- **`crm`** (12) — leads, citas, journeys, automatizaciones, programas, supresión, callbacks:
  `manage-leads`, `manage-appointment`, `journey-runner`, `automation-engine`, `manage-automations`,
  `program-tick`, `manage-programs`, `manage-suppression`, `schedule/list/cancel-callback`,
  `callback-dispatcher`.
- **`inbox`** (1) — bandeja omnicanal: `manage-conversations`.
- **`ai`** (9) — bot RAG, copiloto, salud del agente: `bot-runtime`, `manage-bot`, `get-bot-report`,
  `agent-channel-adapter`, `get-q-suggestions`, `get-churn-risk`, `get-agent-wellness`,
  `get-agent-leaderboard`, `generate-call-summary`.
- **`admin`** (12) — config, identidad, auditoría, exports: `manage-taxonomy/catalog/knowledge/
permissions`, `admin-list-audit`, `manage-scheduled-exports`, `scheduled-export-runner`,
  `provision-tenant`, `invite-user`, `list-team`, `list-users`, `post-confirmation`.

### Integraciones / Conectores

- **`salesforce`** (4) — `salesforce-sync`, `salesforce-oauth-start`, `salesforce-oauth-callback`,
  `salesforce-inbound-webhook`.
- **`whatsapp`** (13) — Meta Cloud API (plantillas HSM, envíos, salud, analytics, webhook):
  `send-whatsapp-template/flow/list-interactive`, `*-whatsapp-template`, `upload-whatsapp-template-media`,
  `list-whatsapp-flows`, `get-whatsapp-health`, `get-whatsapp-analytics`, `get-hsm-report`,
  `whatsapp-meta-webhook`.
- **`meta`** (2) — IG/Messenger/comentarios + Lead Ads: `meta-messaging-webhook`, `meta-lead-ads-webhook`.
- **`mercadolibre`** (2) — `mercadolibre-webhook`, `mercadolibre-oauth-start`.
- **`connect`** (6) — BYO Amazon Connect (provisión, federación, verificación, config de conexiones):
  `verify-connect-connection`, `diagnose-connection`, `create-connect-instance`,
  `provision-contact-flows`, `get-federation-token`, `set-connect-link`, `manage-connections`.
- **`email`** (1) — `email-tracking` (pixel/clicks vía SES).
- **`web`** (1) — `web-form-capture` (formularios web externos).
- **`webhooks`** (2) — webhooks salientes: `webhook-dispatcher`, `get-webhook-deliveries`.

## Convención para funciones NUEVAS

1. **Nombre del recurso:** sigue `connectview-<verbo>-<sustantivo>` en kebab-case (ej.
   `send-whatsapp-list-interactive`). El prefijo `connectview-` lo pone el deploy.
2. **Integración nueva:** nombrá por el sistema externo — `<sistema>-<acción>` (ej.
   `mercadolibre-webhook`, `salesforce-sync`). Va con `aria:layer=integration` y un
   `aria:domain=<sistema>`.
3. **Feature de núcleo:** nombrá por la acción de negocio (`manage-*`, `get-*`, `list-*`). Va
   con `aria:layer=core` y el dominio que corresponda.
4. **Registrá la función** en `scripts/tag-lambdas.mjs` (en `TAXONOMY`) al crearla; el script
   avisa si una función desplegada quedó sin clasificar.

## Aplicar / consultar

```bash
# Aplicar los tags (idempotente; ignora lo ajeno a ARIA):
node scripts/tag-lambdas.mjs            # o --dry-run para solo reportar

# Listar las integraciones desplegadas:
aws lambda list-functions --query "Functions[].FunctionName" --output text \
  | tr '\t' '\n' | while read f; do \
      aws lambda list-tags --resource "arn:aws:lambda:us-east-1:731736972577:function:$f" \
        --query "Tags.\"aria:layer\"" --output text 2>/dev/null | grep -q integration && echo "$f"; \
    done
```

Para **facturación por capa**, activá `aria:layer` y `aria:domain` como _cost allocation tags_
en Billing → Cost allocation tags; después Cost Explorer agrupa el gasto núcleo vs integraciones.

## 🔑 Persistencia de los tags

- **Hand-managed (`connectview-*`, ~91):** conservan los tags — `deploy-lambda.mjs` solo actualiza
  el código, no los borra.
- **Amplify-managed (`amplify-connectview-*`, ~14, las del `backend.ts`):** CloudFormation/CDK
  gestiona esos recursos, así que un `npx ampx pipeline-deploy` **borra los tags puestos a mano**.
  → **Re-correr `node scripts/tag-lambdas.mjs` después de cada `ampx` deploy** (es idempotente).
  Todas las amplify-managed son `core`, así que el drift es acotado y visible en el reporte del script.
