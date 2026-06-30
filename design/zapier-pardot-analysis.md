# ARIA vs. Zapier + Pardot — análisis y plan de absorción

**Cliente:** UDEP (Universidad de Piura) · **Producto:** ARIA by Novasys (codename Vox/Connectview) · **Fecha:** 2026-06-18

## Contexto y tesis

UDEP capta alumnos con **Meta Lead Ads (Facebook/Instagram)** y hoy mueve esos leads con esta cadena:

```
Meta Lead Ads  →  Zapier  →  Pardot  →  Salesforce
```

- **Zapier** es el *pegamento*: escucha el formulario de Meta y empuja el lead a Pardot/Salesforce.
- **Pardot** es su **sistema de record de email masivo** (nurturing, blasts a la base).
- **Salesforce** es la **verdad de identidad** (Leads/Contacts, conversión a matrícula).

**Dolor declarado:** *"algunos leads no llegan"*. Es el síntoma clásico de un middleware frágil (Zapier) — fallos silenciosos, latencia, límites de tareas. UDEP quiere **eliminar Zapier** y **conservar Pardot solo para email masivo**.

**Tesis del documento:** ARIA ya tiene casi todas las piezas para reemplazar a Zapier de forma nativa (ingesta + motor de automatización + conector SF bidireccional). Pardot se queda **acotado a su único trabajo defendible**: el envío de email masivo a la base. ARIA se queda con lo que Pardot no hace bien: **conversacional (WhatsApp/voz), dialer, atribución de golpes→matrícula y omnicanalidad**.

> **Encuadre comercial:** no vendemos "otro Zapier". Vendemos *quitar la pieza que falla* y *medir lo que Pardot nunca midió* (qué secuencia de toques convierte una matrícula).

---

## Inventario de capacidades de ARIA (base del análisis)

Lo que sigue **ya existe** en el repo. No se propone reconstruirlo; se mapea encima.

| Capacidad ARIA | Implementación | Qué hace |
|---|---|---|
| **Motor de automatización** | `connectview-automation-rules` + `automation-engine` (Lambda) | Triggers → acciones. Triggers: `lead_created`, `lead_stage_changed`, `lead_inactive` (tick EventBridge 5 min), `wrapup_saved`, `whatsapp_flow_completed`. Acciones: `send_whatsapp_template`, `move_stage`, `schedule_callback`, `webhook`. Condiciones (`eq`/`neq`) por campo. Tope anti-blast por regla/tick. |
| **Webhooks salientes durables** | `automation-engine` (acción `webhook`) → SQS `WEBHOOK_QUEUE_URL` → dispatcher (`connectview-webhook-deliveries`) | Reintento con **backoff exponencial multi-día**, registro de entregas. Reemplaza el "webhook by Zapier" con durabilidad real. |
| **Conector Salesforce bidireccional** | `salesforce-sync` (Vox→SF) + `salesforce-inbound-webhook` (SF→Vox) | OAuth client-credentials. Dedup determinístico (External Id `VoxLeadId__c` → teléfono E.164 → email), maneja Leads convertidos (Task contra el Contact), anti-eco (`LeadSource="Vox"`). |
| **Hub de leads / dedup** | `_shared/leadSync.ts` (`propagateLead`, `bulkUpsertVoxLeads`) | Punto único de entrada: abanica cada lead a 3 superficies (tabla `connectview-leads` / Customer Profile 360° / Salesforce). Dedup por teléfono normalizado. |
| **Captura de formularios web** | `web-form-capture` (Function URL) | Form HTML/JSON → lead + Customer Profile, sin middleware. En el código está rotulado explícitamente como *"the middleware replacement (roadmap #25)"*. |
| **WhatsApp HSM + Flows** | campañas + plantillas + `connectview-hsm-sends` (tracking) + WhatsApp Flows (forms in-chat) | Envío masivo de plantillas con tracking por mensaje; formularios conversacionales que disparan `whatsapp_flow_completed`. |
| **Email 1:1** | Amazon Connect SMTP (MIME, adjuntos) | Correo transaccional/personal del agente (no masivo). |
| **IA** | Bedrock/Claude | Coach, copiloto, auto-clasificación de tipificaciones. Base para scoring y para journeys "inteligentes". |
| **Ingesta nativa de Meta (planeada)** | **Pilar 5** (`meta-lead-ads-webhook`, por construir) | Suscripción directa al webhook de Lead Ads para *matar Zapier*. Es el gap principal. |

---

## 1) Zapier — qué es y cómo lo usa UDEP

### Qué es
Zapier es una plataforma **no-code de automatización entre apps** (iPaaS ligero). Un flujo ("Zap") es **un trigger + una o más acciones**; conecta ~8.000 apps sin escribir código.

### Funciones núcleo
- **Triggers / Actions:** un evento en App A (ej. *nuevo lead de Facebook*) dispara acciones en App B/C (*crear prospect en Pardot*, *crear Lead en Salesforce*).
- **Zaps multi-step:** una cadena de varias acciones encadenadas tras un solo trigger.
- **Filters:** el Zap continúa **solo si** el dato cumple una condición (ej. solo leads de cierto formulario).
- **Paths (branching):** ramifica hasta en **5 caminos** según reglas (if/else encadenado).
- **Formatter:** transforma datos (fechas, texto, números, split de nombres) sin código.
- **Webhooks:** "Catch Hook" (recibir POST) y "POST/GET" (enviar) — el modo genérico para apps sin conector nativo. (Requiere plan de pago).
- **Delay / Schedule:** esperar X tiempo o correr en cron.
- **Tables / Interfaces:** almacén de datos ligero y mini-UIs/forms (producto más nuevo).

### Modelo de precio (el punto de fricción)
Se cobra **por tarea**: cada acción ejecutada = 1 tarea. Los planes traen cuotas (ej. Professional ~$30/mes, 750 tareas) y al excederlas se paga el extra a ~1.25×. Las herramientas internas (Filter, Paths, Formatter, Delay, Tables) **no** cuentan como tarea, pero **cada lead que se empuja a Pardot y a SF sí**. A volumen de captación (Meta a escala), el costo por-tarea escala linealmente con los leads.

### Cómo lo usa UDEP (el rol concreto)
Zapier es **solo el conector Meta→Pardot/SF**. Probablemente:

```
[Trigger]  Facebook Lead Ads: "New Lead"
   │  (opcional Filter: por formulario/campaña)
   ├─ [Action] Pardot: Create/Upsert Prospect   ← entra a la base de email
   └─ [Action] Salesforce: Create/Upsert Lead    ← entra al CRM
```

No usan Zapier como orquestador rico (paths, tables); lo usan como **tubería de entrega de un evento**. Esa es justamente la parte más reemplazable.

### Debilidades reales (por qué "algunos leads no llegan")
1. **Fallos silenciosos:** si una acción falla (timeout de Pardot, rate-limit de SF, campo inválido), el lead se cae y nadie se entera salvo que alguien mire el historial de Zaps. → *"algunos leads no llegan"*.
2. **Latencia:** el trigger de Lead Ads en planes estándar puede **sondear** (polling) en vez de tiempo real → minutos de retraso. En captación educativa, el *speed-to-lead* es EL factor de conversión.
3. **Reintentos pobres:** el auto-replay es limitado; no hay backoff multi-día garantizado como en una cola propia.
4. **Costo por tarea:** escala con el volumen de leads; dos acciones (Pardot + SF) por lead = 2 tareas por lead.
5. **Caja negra de terceros:** sin observabilidad propia, sin control de versiones, sin tests. La fragilidad es **invisible** hasta que un comercial pregunta por un lead que nunca llegó.

---

## 2) Pardot — qué es y su rol en UDEP

> **Nombre actual:** desde 2022 Pardot se llama **Salesforce Marketing Cloud Account Engagement (MCAE)**. Mismo producto, mismo login, mismos tiers; aquí lo llamamos "Pardot" por familiaridad.

### Qué es
Plataforma de **marketing automation B2B/consideración** dentro del ecosistema Salesforce. Su trabajo: **email masivo + nurturing + scoring + reporte de ROI**, fuertemente acoplada a SF.

### Funciones núcleo
- **Email marketing masivo:** envíos a la base, plantillas, A/B de asunto, send-time optimization (con IA en tiers recientes). **Este es el corazón y lo que UDEP quiere conservar.**
- **Forms & landing pages:** formularios y landings de captura propios de Pardot.
- **Lead scoring & grading:** *scoring* = puntaje por comportamiento (abre, clickea, visita); *grading* = ajuste demográfico/fit (A–F). Prioriza a quién contactar.
- **Engagement Studio:** constructor visual de **journeys drip** (secuencias multi-paso con esperas, ramas por comportamiento, triggers).
- **Prospect & activity tracking:** seguimiento de actividad del prospect (emails, visitas web vía tracking pixel, formularios) en una timeline.
- **Dynamic lists / segmentación:** listas que se **auto-actualizan** según reglas (membresía dinámica).
- **ROI / campaign reporting:** atribución de campañas e influencia en pipeline; B2B Analytics.
- **Sync con Salesforce:** sincronización nativa de prospects↔Leads/Contacts y campañas.

### Rol en UDEP
Pardot es **el sistema de record del email masivo**: la base de contactos para nurturing y los envíos masivos viven ahí, sincronizados con SF. Es la pieza que **NO** conviene reemplazar a corto plazo (ver §5): el email masivo deliverable a escala es un dominio propio (reputación de IP, gestión de bajas, plantillas, compliance CAN-SPAM) que ARIA no debe asumir ahora.

---

## 3) Tabla de mapeo: función → ¿ARIA ya lo cubre? → recomendación

Leyenda: ✅ cubierto · 🟡 parcial · 🆕 gap

### Zapier

| Función de Zapier | ¿ARIA lo cubre? | Cómo / dónde | Recomendación |
|---|---|---|---|
| Trigger "nuevo lead de Meta" | 🆕 **gap** | Pilar 5 `meta-lead-ads-webhook` (por construir) | **Reemplazar** — webhook nativo de Lead Ads |
| Acción "crear Lead en Salesforce" | ✅ | `salesforce-sync` / `propagateLead` (dedup determinístico) | **Reemplazar** |
| Acción "crear prospect en Pardot" | 🟡 | Pardot conserva su base vía sync SF↔Pardot; ARIA escribe a SF y SF→Pardot | **Complementar** (ARIA escribe a SF; SF alimenta a Pardot) |
| Multi-step (cadena de acciones) | ✅ | `automation-engine`: N acciones por regla | **Reemplazar** |
| Filters (condiciones) | ✅ | `conditions[] {field, op eq/neq, value}` | **Reemplazar** |
| Paths (branching) | 🟡 | Varias reglas con condiciones distintas = ramas; no hay if/else anidado visual | **Complementar** (suficiente hoy; ver §4 journeys) |
| Formatter (transformar datos) | ✅ | Normalización de teléfono/nombre/email en `leadSync` (`normalizePhone`, `splitName`) | **Reemplazar** (para los campos del dominio lead) |
| Webhooks salientes | ✅ **mejor** | Acción `webhook` → SQS + dispatcher con **backoff multi-día** | **Reemplazar** (más durable que Zapier) |
| Webhooks entrantes (Catch Hook) | ✅ | Function URLs: `web-form-capture`, `salesforce-inbound-webhook` | **Reemplazar** |
| Delay / Schedule | 🟡 | Tick EventBridge (`lead_inactive`, 5 min) + `schedule_callback`; no hay "esperar 3 días" arbitrario aún | **Complementar** (cubrir con journeys, §4) |
| Tables / Interfaces | ✅ | DynamoDB + la propia UI de ARIA (Leads, Campañas, Config) | **Dejar a ARIA** (no aplica como necesidad) |
| Observabilidad de ejecuciones | ✅ **mejor** | `logRun` por regla/acción + `connectview-webhook-deliveries` | **Reemplazar** (la fragilidad deja de ser invisible) |

### Pardot

| Función de Pardot | ¿ARIA lo cubre? | Cómo / dónde | Recomendación |
|---|---|---|---|
| Email **masivo** / nurturing a la base | 🆕 (a propósito) | ARIA solo hace email 1:1 (Connect SMTP) | **Dejar a Pardot** (§5) |
| Forms & landing pages | 🟡 | `web-form-capture` (form→lead), sin builder de landings | **Complementar** (capturar en ARIA; landings en Pardot/web) |
| **Lead scoring** (comportamiento) | 🟡 | Señales existen (touch ledger, wrap-ups, flows); falta el motor de puntaje | **Integrar a ARIA** (§4) |
| **Lead grading** (fit demográfico) | 🟡 | Datos de fuente/programa/atributos existen; falta el grado | **Integrar a ARIA** (§4) |
| **Engagement Studio** (journeys drip) | 🟡 | `automation-engine` da triggers/acciones; falta secuencia con esperas y ramas | **Integrar a ARIA** (§4, sobre el motor) |
| Prospect / activity tracking | ✅ 🟡 | Touch ledger (Pilar 2) + `connectview-hsm-sends` + historial del lead; tracking pixel web no | **Integrar a ARIA** (atribución omnicanal, supera a Pardot por incluir voz/WA) |
| Dynamic lists / segmentación | 🟡 | Filtros por programa/etapa/fuente; falta "lista dinámica" como objeto reutilizable | **Integrar a ARIA** (§4) |
| ROI / campaign reporting | ✅ **mejor** | Pilar 9 (reportes) + atribución golpes→conversión cross-channel | **Integrar a ARIA** (Pardot solo ve email; ARIA ve todo) |
| Sync con Salesforce | ✅ | `salesforce-sync` + `salesforce-inbound-webhook` (bidireccional) | **Reemplazar el de Zapier; coexiste con el de Pardot** |

---

## 4) Qué conviene integrar a ARIA (priorizado)

Orden = valor × cercanía a lo que ya existe. Esfuerzo: S / M / L / XL.

### P0 — Ingesta nativa de Meta Lead Ads (mata Zapier) · **Pilar 5** · Esfuerzo **L**
El gap #1 y el objetivo explícito de UDEP. Nuevo `meta-lead-ads-webhook` (Function URL) suscrito al campo `leadgen` de la Page:
- Verifica el webhook (token), recibe `leadgen_id` en tiempo real, lee el lead vía Graph API, mapea campos + UTM/programa.
- Llama `propagateLead({origin:"vox", source:"Facebook"/"Instagram"})` → tabla leads + Customer Profile + Salesforce, con dedup por teléfono.
- Dispara `fireAutomation("lead_created")` → el motor manda WhatsApp sub-minuto (speed-to-lead).
- **Panel de salud de fuentes:** conteo en vivo de leads por fuente → *"algunos leads no llegan"* se vuelve visible al instante.

**Por qué primero:** es el único trabajo que Zapier hace para UDEP. Construyéndolo, Zapier se puede apagar (§6). El patrón ya está probado con `web-form-capture` y `salesforce-inbound-webhook` (mismas Function URLs, mismo `propagateLead`).

### P1 — Journeys drip (equivalente a Engagement Studio) · **sobre `automation-engine`** · Esfuerzo **L**
Hoy el motor es *trigger único → acciones*. Para igualar Engagement Studio falta **secuencia con esperas y ramas**:
- Nuevo tipo "journey" = lista ordenada de pasos (enviar plantilla → esperar 2 días → si no respondió, llamar → si respondió, mover etapa).
- Reutiliza las acciones existentes (`send_whatsapp_template`, `move_stage`, `schedule_callback`, `webhook`) como pasos.
- El "esperar N días" se modela con `scheduledAt` en una tabla de pasos pendientes, drenada por el tick EventBridge que ya existe para `lead_inactive`.
- Pasa por el **motor de supresión/frecuencia (Pilar 3)** antes de cada envío.

**Por qué:** es la pieza de Pardot más fácil de absorber sobre lo ya construido, y la lleva a **omnicanal** (Pardot solo hace drip de email; ARIA haría drip de WA+voz+email).

### P2 — Lead scoring & grading · **Pilar 2 (ledger) + Bedrock** · Esfuerzo **M-L**
- **Scoring (comportamiento):** puntaje sumado desde el touch ledger / `hsm-sends` / `whatsapp_flow_completed` (respondió +X, abrió +Y, no-show −Z). Recalculado por evento.
- **Grading (fit):** grado A–F desde fuente/programa/atributos del lead (un Meta lead de programa premium puntúa distinto a uno frío).
- Expone `lead_score_changed` como nuevo trigger → alimenta journeys y orquestación del dialer (Pilar 7: marca primero a los de score alto).
- Bedrock/Claude puede inferir intención desde la transcripción/wrap-up para enriquecer el score.

**Por qué:** convierte el embudo en **priorizado**, no FIFO. Pardot puntúa solo email; ARIA puntúa la conversación real (más señal).

### P3 — Segmentos dinámicos · **sobre la tabla de leads** · Esfuerzo **M**
"Lista dinámica" como **objeto reutilizable** (no un filtro de una vista): definición de reglas (programa + etapa + score + última-actividad) que se recalcula y se puede usar como audiencia de campaña, journey o export. Apoyado en el GSI byProgram (Pilar 1).

**Por qué:** Adriana deja de armar audiencias a mano; encaja con el motor de supresión y con campañas.

### P4 — Activity tracking / atribución reforzada · **Pilar 2 + Pilar 9** · Esfuerzo **L** (en parte hecho)
El touch ledger + reportes ya cubren la mayor parte. Cerrar:
- Tracking de apertura/click en el email 1:1 de Connect SMTP (pixel/redirect propio) para paridad con la timeline de Pardot.
- Atribución golpes→matrícula cruzando WA+voz+email (esto Pardot **no** puede; solo ve email).

**Por qué:** es el diferenciador medible que Pardot nunca dará por ser mono-canal.

---

## 5) Qué dejar explícitamente a Pardot (y cómo coexisten)

**Dejar a Pardot:** **email marketing masivo / nurturing a la base** (envíos a miles, plantillas de email, gestión de bajas, reputación de envío).

**Por qué no reemplazarlo ahora:**
1. **Deliverability es un dominio propio.** Reputación de IP/dominio, warm-up, feedback loops, bounce/complaint handling, listas de supresión globales y compliance (CAN-SPAM/GDPR) son años de infraestructura. ARIA no debe asumir ese riesgo para un piloto.
2. **Es el sistema de record de email de UDEP** — ya está sincronizado con SF y operado por marketing. Tocarlo no aporta al dolor real (que es Zapier, no Pardot).
3. **Foco:** el valor de ARIA está en **conversacional + dialer + atribución + omnicanal**, no en competir con un ESP maduro.

**Cómo coexisten (división de trabajo):**

| | **Pardot** | **ARIA** |
|---|---|---|
| Canal | Email **masivo** a la base | WhatsApp, voz, email 1:1, IG/Messenger |
| Rol | Nurturing de largo plazo, blasts | Speed-to-lead, gestión 1:1, dialer, cierre |
| Dato | Prospect + actividad de email | Lead 360° + ledger de toques omnicanal |
| Sincronía | ↔ Salesforce (nativa de Pardot) | ↔ Salesforce (`salesforce-sync`) |

**Punto de encuentro = Salesforce.** ARIA escribe el lead a SF; SF alimenta a Pardot por su sync nativo. Pardot sigue haciendo email masivo sobre esa base; ARIA hace el resto y mide la atribución total. **Nadie escribe a Pardot directamente** — se evita un segundo acoplamiento frágil. (Si más adelante UDEP quiere disparar un journey de Pardot desde ARIA, se hace con la acción `webhook` durable hacia la API de Pardot, no con Zapier.)

---

## 6) Plan "matar Zapier" — flujo actual → equivalente ARIA-nativo

### Estado actual
```
Meta Lead Ads ──poll/webhook──> Zapier ──> Pardot (Create Prospect)
                                   └──────> Salesforce (Create Lead)
                         (fallos silenciosos · latencia · costo/tarea)
```

### Estado objetivo (ARIA-nativo)
```
                          ┌────────────────────── ARIA ──────────────────────┐
Meta Lead Ads ──webhook──> meta-lead-ads-webhook ─> propagateLead ─┬─> connectview-leads (embudo)
 (campo leadgen,           (Pilar 5, Function URL)                 ├─> Customer Profile 360°
  tiempo real)                     │                               └─> Salesforce (salesforce-sync, dedup)
                                   │                                          │
                                   └─> fireAutomation("lead_created")         └─> sync nativo SF↔Pardot
                                          │                                       (email masivo sigue en Pardot)
                                          └─> automation-engine
                                                ├─ send_whatsapp_template (speed-to-lead sub-minuto)
                                                ├─ schedule_callback (auto-llamar)
                                                └─ webhook durable (si hace falta empujar algo externo)
                          └────────────────────────────────────────────────────┘
```

### Pasos de implementación

1. **Construir `meta-lead-ads-webhook`** (Pilar 5, esfuerzo L):
   - Function URL pública con verificación de token (patrón de `web-form-capture` + `salesforce-inbound-webhook`).
   - Suscripción al webhook de la Page (campo `leadgen`); al recibir `leadgen_id`, leer el lead por Graph API.
   - Mapear `field_data` → `{phone, name, email, source, attributes, utm/programa}`.

2. **Enchufar al hub existente:** llamar `propagateLead(lead, {origin:"vox", sfExtra})`. Esto **ya** escribe a la tabla de leads, al Customer Profile y a Salesforce con dedup determinístico (External Id → teléfono → email). **Cero código nuevo de SF.**

3. **Disparar speed-to-lead:** `fireAutomation("lead_created")` → reglas en `connectview-automation-rules` mandan la plantilla de WhatsApp de bienvenida y/o agendan llamada. UDEP configura la regla en Automatizaciones.

4. **Pardot sigue recibiendo su base vía SF:** no se toca el sync SF↔Pardot. El email masivo continúa exactamente igual. ARIA solo desplazó la *entrega del lead*, no el email.

5. **Panel de salud de fuentes:** contador de leads por fuente (Meta/web/CSV/manual) en vivo → si un formulario deja de entrar, se ve de inmediato (mata el *"algunos leads no llegan"* invisible de Zapier).

6. **Correr en paralelo y cortar:** período de doble-ingesta (Zapier + ARIA) reconciliando por teléfono (el dedup de `propagateLead` evita duplicados en SF). Cuando el contador de ARIA ≥ el de Zapier durante N días → **apagar el Zap**.

### Qué gana UDEP al apagar Zapier
- **Tiempo real** en vez de polling → mejor speed-to-lead (factor #1 de matrícula).
- **Durabilidad:** la entrega a SF y los webhooks externos reintenta con backoff multi-día (cola propia), no se cae en silencio.
- **Observabilidad:** `logRun` + `connectview-webhook-deliveries` + panel de fuentes → la fragilidad deja de ser invisible.
- **Sin costo por-tarea** que escale con el volumen de leads.
- **Una sola plataforma** para ingesta + automatización + dialer + atribución, en la cuenta AWS del cliente.

---

## Resumen ejecutivo

- **Zapier** para UDEP es solo el conector Meta→Pardot/SF, y es la pieza que falla. ARIA ya tiene el 90% para reemplazarlo: motor de automatización con webhooks durables, conector SF bidireccional con dedup, hub de leads y captura web. **Falta una pieza: el webhook nativo de Meta Lead Ads (Pilar 5).**
- **Pardot** se acota a su único trabajo defendible —**email masivo a la base**— y coexiste vía Salesforce. ARIA absorbe lo demás de Pardot que sí aporta: **journeys drip** (sobre el motor), **scoring/grading** (sobre el ledger + Bedrock), **segmentos dinámicos** y **atribución omnicanal** (que Pardot no puede dar por ser mono-canal).
- **Plan "matar Zapier":** construir `meta-lead-ads-webhook` → `propagateLead` (reusa SF/CP/embudo) → `fireAutomation("lead_created")` para speed-to-lead; Pardot sigue recibiendo la base por el sync nativo de SF; doble-ingesta y corte cuando los contadores empaten.

---

### Fuentes
- [Zapier — Paths (branching)](https://help.zapier.com/hc/en-us/articles/8496288555917-Add-branching-logic-to-Zaps-with-Paths)
- [Zapier — Filters](https://help.zapier.com/hc/en-us/articles/8496276332557-Add-conditions-to-Zap-workflows-with-filters)
- [Zapier Pricing 2026 — No Code MBA](https://www.nocode.mba/articles/zapier-pricing-2026)
- [Zapier Multi-Step Zaps Explained 2026 — Thinkpeak AI](https://thinkpeak.ai/zapier-multi-step-zaps-explained/)
- [Salesforce Account Engagement (Pardot) — Complete 2026 Guide (Genesys Growth)](https://genesysgrowth.com/blog/salesforce-account-engagement-(pardot)-complete-guide)
- [Pardot is now Marketing Cloud Account Engagement — what changed (Cendance)](https://cendanceinc.com/pardot-to-marketing-cloud-account-engagement-changes/)
- [Meta — Webhooks for Lead Ads (developers.facebook.com)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration)
- [Meta Lead Gen API Guide — LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/)
