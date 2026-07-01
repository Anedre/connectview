# Demo del jefe — Runbook

**Duración estimada:** 15 minutos
**Objetivo:** demostrar que (1) el dialer funciona y es reusable por Salesforce, (2) la omnicanalidad funciona, (3) el historial muestra adjuntos y transcripts.

---

## Pre-demo checklist (hacer 30 min antes)

- [ ] Connect Instance `novasys` activa
- [ ] Agente Andre-Alata logueado en CCP y en estado **Available**
- [ ] Vox CRM corriendo en `http://localhost:5173` o ya deployado en Amplify
- [ ] Tener listo el contactId/phone con adjuntos WhatsApp para el cap. 3
- [ ] Test phone para outbound de prueba (tu propio celular)
- [ ] Tener `DIALER_FOR_SALESFORCE.md` abierto en otra pestaña
- [ ] Postman / curl listo para el smoke test de Salesforce

---

## Cap. 1 — "El dialer funciona y es reusable" (5 min)

### 1a. Mostrar que está vivo en producción

Abrir Vox CRM → `/campaigns` → tab **Todas**. Mostrar las 17 campañas existentes con sus estados.

**Decir:**

> "Esto que ven aquí son 17 campañas reales que el dialer procesó. Pueden ver tasas de éxito del 100%, llamadas completadas, fallidos. Todo esto ya está corriendo."

Click en **UDEP Admisión Pregrado · Enero 2026** (Terminada, 100% éxito).

**Mostrar:**

- "Iniciada 10:09 · 2 contactos procesados al 100%"
- Donut chart con 2 cerrados
- Tabla de Andre-Alata con 2/2 atendidas y 100% éxito

### 1b. Mostrar el motor: EventBridge + Lambda

Abrir consola AWS → Lambda → `connectview-campaign-dialer`. Mostrar:

- Trigger: EventBridge rule `connectview-campaign-dialer-tick` con `rate(1 minute)`
- CloudWatch metrics → Invocations en las últimas 24h

**Decir:**

> "Cada minuto este Lambda se despierta, revisa qué campañas están RUNNING, y dispara llamadas. Si bajamos a 0 campañas, el Lambda sigue corriendo pero hace nada — costo prácticamente cero."

### 1c. Reusabilidad para Salesforce

Abrir `DIALER_FOR_SALESFORCE.md` en pantalla. Ir al diagrama de arquitectura.

**Decir:**

> "El dialer es agnóstico de quién lo invoca. Hoy es Vox CRM. Mañana, cuando Salesforce esté listo, hace exactamente la misma llamada HTTP: `POST createCampaign` con su lista de leads. Mismo Lambda, mismo Connect, mismos agentes. No tocamos código."

**Hacer un smoke test en vivo** (abrir Postman o terminal):

```bash
curl -X POST 'https://26bia7kkxupfzfdcsscemnftna0vwaju.lambda-url.us-east-1.on.aws/' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Demo Salesforce '"$(date +%H:%M)"'",
    "sourcePhoneNumber": "+5116433467",
    "contactFlowId": "a40dc527-8348-4694-a389-7b675c0ac3ac",
    "campaignType": "voice",
    "dialMode": "progressive",
    "concurrency": 1,
    "startNow": true,
    "createdBy": "demo-salesforce",
    "contacts": [
      { "phone": "+51XXXXXXXXX", "customerName": "Demo", "attributes": { "lead_source": "salesforce" } }
    ]
  }'
```

**Esperar 30–60s** → la llamada entra al CCP del agente. Atenderla en vivo durante la demo.

**Decir:**

> "Eso que ven es exactamente lo que hará Salesforce. Un POST con leads, y el dialer hace el resto. Sin Salesforce escribir una sola línea de código relacionada a telefonía."

---

## Cap. 2 — Omnicanalidad (5 min)

### 2a. Voz (in/out)

Ya lo demostramos en cap. 1c con la llamada saliente. Mostrar también una entrante:

Pedirle a alguien que **llame al +5116433467 desde su celular**. Aparece en el CCP. El agente acepta. Se ve:

- Pantalla `Cliente 360°` se rellena con datos del cliente (si existe en Customer Profiles)
- Transcripción en vivo en panel central (Contact Lens)
- Amazon Q sugerencias abajo

### 2b. WhatsApp outbound (template)

En `/campaigns` → "Nueva campaña" → Paso 3 → toggle "💬 WhatsApp template Meta".

**Mostrar:**

- Dropdown con templates aprobados de Meta
- Mapeo de variables del CSV → `{{1}}, {{2}}, ...`
- Preview del mensaje con header/body/footer/buttons

Crear una campaña con 1 contacto (tu número) y el template `udep_admision_emoji`. Verificar que llega.

### 2c. WhatsApp inbound

Mandar un WhatsApp al número de Connect (`+5116433467`) desde un teléfono.

**Mostrar:**

- El agente recibe el chat en el CCP nativo
- Cliente 360 se rellena automáticamente
- Mensajes en panel `ChatThreadPanel`
- Si el cliente envía un adjunto → aparece en el chat

### 2d. Email outbound

En Agent Desktop → botón **New Email**. Mostrar el formulario:

- Selector "De" con los emails configurados en Connect
- Adjuntos (drag & drop)
- Envío real desde Connect

**Decir:**

> "Voz, WhatsApp, email — un solo agente, una sola interfaz. No necesita 3 herramientas."

### 2e. (Bonus) Live transcription

Si durante una llamada Contact Lens está procesando, mostrar el panel `LiveTranscriptPanel` actualizándose en tiempo real con segmentos POSITIVE / NEGATIVE / NEUTRAL.

---

## Cap. 3 — Historial + adjuntos + transcripts (5 min)

### 3a. Mostrar el histórico de un cliente

Agent Desktop → click en un cliente de "Atendidos recientemente" (Cliente 360°, panel derecho).

**Mostrar:**

- Datos del perfil (nombre, email, teléfono, género, fecha nacimiento)
- **Interacciones recientes** — lista de llamadas, chats, WAs previos

### 3b. Abrir el detalle de una interacción con adjunto

Click en una interacción → abre `ContactDetailModal`.

**Mostrar:**

- Recording presigned URL (si es voz)
- Reproductor de audio integrado
- Transcript completo (Contact Lens) con timestamps
- **Adjuntos** — files con presigned S3 URLs
- Attributes del contact (campaign, customer name, etc.)

**Punto crítico para el jefe:**

> "Cuando un cliente nos manda un PDF por WhatsApp o un audio, el agente ya no tiene que ir al WhatsApp Business Manager a buscarlo. Está aquí, en su mismo CRM, asociado al contacto."

### 3c. Audio + transcript sincronizados

Si hay una llamada con grabación, mostrar:

- Play en el audio
- El transcript se ilumina en el segmento actual
- Sentiment colors

---

## Q&A típicas y cómo responder

**¿Cuántas llamadas simultáneas aguanta?**

> Pacing actual configurable por campaña hasta 50 simultáneas. Limitado por (a) cuántos agentes Available hay y (b) cuánto bandwidth tiene Connect (que es muy alto, no es problema).

**¿Qué pasa si Connect se cae?**

> El dialer entra en backoff (las llamadas a Connect fallan, se reintentan en el siguiente tick). DynamoDB sigue siendo source-of-truth de qué leads están pendientes. Cuando Connect vuelve, retoma sin perder datos.

**¿Cómo manejamos AMD (Answer Machine Detection)?**

> Hoy: con el flow `UDEP-Outbound-Smart` que tiene CheckOutboundCallStatus al inicio. Voicemails se cuelgan antes de llegar al agente.
> Futuro: cuando AWS habilite Outbound Campaigns V2 para Perú, podemos delegar AMD nativo de Connect (es más confiable). Ya está el código preparado con `useNativeCampaign: true`.

**¿Salesforce qué tendrá que hacer exactamente?**

> Cuando un sales rep cierra un lote de leads, en lugar de un export CSV manual, Salesforce hace un POST a nuestro `createCampaign` endpoint con esos leads. Tarea para el dev de Salesforce: 1 clase Apex de ~50 líneas (ya tienes el ejemplo en `DIALER_FOR_SALESFORCE.md`).

**¿Y el costo?**

> Lambdas: pay-per-invocation. Dialer corre 1440 veces al día (cada minuto) ≈ $0 con Free Tier. StartOutboundVoiceContact: $0.018 por llamada conectada. WhatsApp: tarifa Meta por conversación. DynamoDB: pay-per-request, ~$0 con tráfico actual.

**¿Audit trail?**

> CloudWatch Logs guarda cada invocación del dialer y cada Connect call. Para auditoría más rica hay tabla `connectview-admin-audit` donde se loggean acciones manuales (transferencias, cambios de estado, etc.).

---

## Si algo sale mal en vivo

| Síntoma                          | Quick fix                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Llamada outbound no entra al CCP | Verifica que el agente esté en estado **Available** (no After Call Work)                              |
| WhatsApp template falla          | Revisa que el template esté APPROVED en Meta Business Manager                                         |
| ContactDetailModal vacío         | El contacto puede ser muy reciente (< 5 min); Connect aún no indexó. Espera un par de min y reintenta |
| Reports tarda en cargar          | Es esperado, queryContacts hace SearchContacts en Connect (limitado a ~1 req/s)                       |
| CSV export no descarga           | Chrome puede bloquear downloads silenciosos en preview headless — ábrelo en pestaña normal            |

---

## Lo que NO funciona y debemos admitir si nos preguntan

- ❌ **Mobile/tablet** — la app sí tiene media queries pero no se ha testeado en dispositivos reales. Recomendación: postergar móvil para v2.
- ⚠️ **Outbound Campaigns V2 nativo de AWS** — no soportado en Perú aún. Usamos nuestro dialer custom. Cuando AWS habilite Perú podemos migrar (el código ya lo contempla).
- ⚠️ **Búsqueda de cliente** — requiere nombre completo, no fuzzy. Limitación del endpoint de Customer Profiles. Fixable a medio plazo con índice local.
- ⚠️ **Algunas secciones de Admin (Canales/Colas/Integraciones)** — placeholders por ahora. La gestión real se hace en la consola Connect. Estamos en proceso de portarla al CRM.
- ⚠️ **Algunos datos en DynamoDB tienen mojibake** — fijado en el render-time con sanitizer, pero los bytes corruptos siguen ahí. Hay que rehacer la carga de esos test rows.

---

## Plan B: si el demo falla por red / Connect down

Tener listos screencasts (videos cortos de 30s cada uno) de:

1. Llamada saliente entrando al CCP
2. WhatsApp inbound apareciendo en chat
3. Historial mostrando un adjunto

Guardarlos en `~/Demos/vox-fallback/` la noche antes.

---

## Actualización 2026-07-01 — la plataforma avanzó mucho desde este script

Este runbook es el guión original del **dialer**. Desde entonces se construyeron las Fases 2-5
(ver `ROADMAP-V2-5-FASES.md` y los `design/*.md`). Correcciones a "lo que NO funciona":

- ✅ **Integraciones** ya NO es placeholder: es una superficie completa (Amazon Connect BYO,
  Salesforce OAuth + mapeo schema-aware, WhatsApp, **SSO SAML/OIDC**, **Mercado Libre**, Marca).
- ✅ **Segmentos / Journeys / Scoring / Grading** (Fase 2-3): motor de engagement tipo Pardot
  (drips omnicanal, ramas por score, auto-enroll por segmento).
- ✅ **Canales nuevos** (Fase 4): WhatsApp LIST + Carousel, email tracking (pixel/clicks →
  golpes), Mercado Libre en el inbox (opcional).
- ✅ **Deliverability** (Fase 5): estado por-mensaje + cuarentena automática (verificado en vivo).

**Novedades demostrables extra:**

- **Journeys** (`/journeys`): armar un drip visual (react-flow) y mostrar el embudo por nodo.
- **Leads con score/grade** (`/leads`): temperatura + priorización del dialer por score.
- **Reportes** (`/reports`): dashboard por Programa, reporte del Agente IA, HSM (entrega WhatsApp).
- **Agente IA** (`/bot`): bot RAG con citaciones sobre catálogos/programas/FAQ.

**Para el go-live real con el cliente** (lo que espera acción de UDEP/Meta/SF): ver
**`design/go-live-runbook.md`** — checklist de activaciones (campos SF, número meta, App Review IG,
App de ML, imágenes de carousel, IdP de SSO).

**Red de regresión (F5.6):** `.github/workflows/ci.yml` (typecheck + unit + build bloqueantes) +
suite e2e Playwright (`npm run e2e`; smoke sin-auth siempre, flujos autenticados con
`TEST_EMAIL`/`TEST_PASSWORD`). Hardening: `design/hardening-notes.md`.
