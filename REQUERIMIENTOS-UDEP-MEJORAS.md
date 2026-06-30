# UDEP — De requerimientos a producto: soluciones completas

**Premisa (de la sesión de diseño):** UDEP nos dio feedback de usuario y está bien encaminado, pero como equipo de producto **no implementamos al pie de la letra** — entregamos la versión completa y mejor pensada de cada necesidad. Este doc toma cada requerimiento de `REQUERIMIENTOS-UDEP-2026-06-17.md` y lo eleva: **lo que pidieron → la solución completa → por qué gana → qué toca**.

**Insumo visual:** capturas de Chattigo de la reunión (Agent Monitoring, Outbound setting, HSM Shipment Summary, reporte HSM en Excel por mensaje). Son el benchmark de la **Pilar 9**.

> **Regla de oro del doc:** cada vez que el cliente describe un *trabajo manual* que hace (deduplicar a mano, parsear nombres de plantilla, marcar fuera de servicio, filtrar ya-enviados), eso es una señal de que el producto debe **hacerlo solo por política**, no darle otra pantalla para hacerlo a mano.

---

## Pilar 1 — "Programa" como objeto operativo (no un filtro)
**Cubre R1, R2, R3, R26.**

- **Pidieron:** un selector/columna de "programa" en Leads y Campañas, porque manejan ~56 a la vez y hoy ven uno solo.
- **Aclaración clave:** *programa* = **unidad comercial/campaña** (ej. "Programa de Verano"), efímera (~3 meses), leads casi disjuntos (5–10% de cruce). No es el catálogo de cursos.

**Solución completa:**
1. **Programa = entidad de primer nivel** con ciclo de vida (`borrador → activo → pausado → cerrado/archivado`) y **auto-archivado** al cerrar su ventana (~3 meses). Al cerrar: congela métricas (snapshot), libera colas y pausa campañas asociadas. Resuelve solo el dolor de "los programas duran 3 meses y se acumulan colas".
2. **Hub de Programas** (no una lista estática tipo QuickSight, sino **tarjetas accionables**): cada card muestra salud en vivo — leads por etapa, % gestionados, contact-rate, conversión, # de golpes, costo, días-para-cierre. Vista cross-programa (los 56 ordenables por salud) **+** drill a un programa.
3. **Switcher de programa en la top-bar** (estilo workspace switcher) que **scopea toda la app** (Leads, Campañas, Reportes, Dashboard) al programa activo, con salto rápido por ⌘K. Esto es lo que Zhenia pidió ("cabezal de filtro"), pero como contexto global, no un dropdown por pantalla.
4. **Membership lead↔programa N:N** (no un campo `programId` plano): un lead puede estar en Programa A como "gestionado" y en B como "nuevo", con **etapa por programa**. Modelarlo como campo único rompería justo el 5–10% de cruce que mencionaron.
5. **Auto-tagging de programa por origen**: el lead hereda el programa de su fuente (columna del CSV, campaña, formulario Meta, campo de SF). Nadie etiqueta a mano. El **UTM (`utm_campaign` = código de programa, R26)** se mapea aquí automáticamente.

- **Por qué gana:** convierte "programa" en la **unidad de operación** real (que es como trabajan), no en un filtro cosmético. Ni Kommo ni Chattigo modelan campañas efímeras masivas con salud por unidad.
- **Toca:** nueva tabla `connectview-programs` + membership en `connectview-leads` (GSI byProgram), `ProgramsHub.tsx`, switcher en `PageHeader`, scope en `LeadsPage`/`CampaignsPage`/`ReportsPage`/`DashboardPage`. **Esfuerzo:** L–XL.

---

## Pilar 2 — Ledger de interacciones + atribución ("cuántos golpes")
**Cubre R4, R22.**

- **Pidieron:** registrar cada WhatsApp/email/llamada por lead con fecha/programa, escribirlo a Salesforce, y poder medir "cuántos golpes por conversión" y deduplicar.

**Solución completa:**
1. **Touch ledger único e inmutable**: un evento por interacción (canal, dirección, programa, agente/sistema, plantilla, resultado, **costo**), append-only. Reusa y generaliza el history de wrap-up + `connectview-hsm-sends`. Una sola fuente para journey, reportes y dedupe.
2. **Atribución a conversión**: liga la secuencia de golpes → matrícula/cierre. Responde de verdad lo que Zhenia quiere medir: "este programa hizo 40 ventas con 10.000 mensajes", **golpes-por-conversión**, y **qué secuencia/canal convierte mejor**. Eso Chattigo no lo da.
3. **Write-back a SF en dos capas**: (a) Activity/Task por golpe (detalle) **+** (b) **campos rollup** en el Lead (total de golpes, último golpe, mix de canales) para que los dashboards de SF no exploten por volumen. SF = verdad de identidad; ARIA = verdad de interacción. Idempotente por event-id (engancha con [dedup de salesforce-sync]).
4. **Timeline del cliente unificada** en el detalle (llamada → WA → email → bot → cierre), ya esbozada en Grabaciones; se vuelve el backbone, exportable (resuelve R22 "chat detail en tabla").

- **Por qué gana:** pasa de "tener historial" a **medir el journey y atribuir resultados** — el lenguaje de marketing de UDEP (Adriana/Zhenia hablan de medir golpes). Es analítica de negocio, no un log.
- **Toca:** `connectview-interactions` (o extender hsm-sends), `salesforce-sync` (Task + rollup), detalle de lead/cliente, export. **Esfuerzo:** L.

---

## Pilar 3 — Motor de supresión / consentimiento / frecuencia
**Cubre R6 y eleva R4. Incluye lo que NO pidieron pero es obligatorio.**

- **Pidieron:** que no se envíe dos veces al mismo número el mismo día; un filtro que quite los ya-contactados.

**Solución completa — un servicio central por el que pasa *todo* envío (campaña, automatización, blast manual):**
1. **Frequency caps** configurables (global + por programa): ej. máx 3 WA/semana, no contactar tras conversión.
2. **Quiet hours / ventanas regulatorias**: Miguel ya mencionó "después de las 10pm no" → regla de horario por canal/zona.
3. **Opt-out / STOP + consentimiento** (⚠️ **no lo pidieron pero es compliance de WhatsApp/Meta**): auto-suprime al recibir baja; lista do-not-contact; respeta la ventana de 24h.
4. **Guard "ya en campaña activa"** + **dedupe por número/ventana**.
5. **Preview honesto antes de enviar**: "de 100 se excluyen 23 → 12 ya contactados, 7 opt-out, 4 fuera de horario". Adriana **nunca** vuelve a deduplicar a mano.

- **Por qué gana:** transforma su tarea manual ("a estos 50 ya les envié, mándale a los otros") en **garantía por política** + cumplimiento. Es la diferencia entre una herramienta y una plataforma. Reduce baneos de número (protege el activo más frágil de WhatsApp).
- **Toca:** `connectview-suppression` + hook pre-send en `send-whatsapp-template`/dialer/automation-engine; UI de reglas en Configuración. **Esfuerzo:** M–L.

---

## Pilar 4 — Deliverability & salud del número
**Cubre R5, y sube #13/#14 del roadmap.**

- **Pidieron:** saber si el mensaje se entregó / falló / número equivocado.

**Solución completa:** desplegar el `whatsapp-status-webhook` (#14, ya diseñado) y convertir el estado crudo en **acción**:
1. Ciclo completo por mensaje (sent→delivered→read→failed) con **causa categorizada** (número inválido, bloqueado, fuera de ventana, plantilla pausada).
2. **Cuarentena automática de números malos**: número inválido → marca el teléfono del lead, lo excluye a futuro y lo manda a "corregir". (Hoy Adriana lo ve a mano en el Excel.)
3. **Monitor de Quality Rating + Messaging Limits** (#13) con alerta si cae a YELLOW/RED — protege la cuenta de Meta.
4. Alimenta el ledger (Pilar 2) y los reportes (Pilar 9). Auto-retry de fallos transitorios; cuarentena de permanentes.

- **Por qué gana:** Chattigo *muestra* estados; nosotros **actuamos** sobre ellos (limpieza de base + protección del número). 
- **Toca:** `whatsapp-status-webhook`, `connectview-hsm-sends`, `get-whatsapp-health`. **Esfuerzo:** M.

---

## Pilar 5 — Ingesta nativa de leads + speed-to-lead (matar Zapier)
**Cubre R12, R8, y el web-form #25.**

- **Pidieron:** que al llenar un formulario de Meta (FB/IG) se dispare WhatsApp automáticamente, para eliminar Zapier (hoy Meta→Zapier→Pardot→SF, y "algunos leads no llegan").

**Solución completa — un Hub de Ingesta de Leads, una sola tubería para todas las fuentes:**
1. **Meta Lead Ads nativo**: suscripción directa al webhook de sus formularios FB/IG (sin Zapier, sin Pardot en este camino). Captura source/UTM/programa nativamente.
2. **Speed-to-lead**: WhatsApp automático sub-minuto + opción de auto-asignar/auto-llamar. El **time-to-first-touch** se vuelve métrica de cabecera (es EL factor de conversión en captación educativa).
3. **Quick-capture / referidos (R8)**: alta inline desde la llamada con teléfono y programa pre-cargados → candidato SF al toque; **cadena de referidos** (un contacto genera referidos ligados al referente → analítica de referidos, que ellos manejan en volumen).
4. **Monitor de salud de fuentes**: conteo de leads ingeridos por fuente en vivo → el problema de "algunos leads no llegan" se ve al instante (hoy es invisible). Un hub para Meta forms + web (#25) + WhatsApp + CSV + SF + manual.

- **Por qué gana:** no solo reemplaza Zapier — elimina la **fragilidad invisible** (su queja real) y mete speed-to-lead, que es donde se gana/pierde la matrícula. Caso análogo ya hecho: Pacífico Seguros con Oracle Eloqua.
- **Toca:** `meta-lead-ads-webhook` (nuevo) o vía `salesforce-inbound-webhook`+`automation-engine` (#15/#23), quick-capture en Agent Desktop, panel de salud de fuentes. **Esfuerzo:** L.

---

## Pilar 6 — Inbox omnicanal verdadero
**Cubre R13.**

- **Pidieron:** integrar FB/Instagram/Messenger inbound (gente que escribe directo, sin formulario).

**Solución completa:** inbox **único** con WhatsApp + IG DM + Messenger + comentarios FB/IG (comment→DM) + chat web + email, con **una sola identidad de cliente** (merge por teléfono/email/social-id), **una taxonomía** y **un historial**. Automatización comentario→DM (responder y mover a privado). 

- **Por qué gana:** entrega de verdad la promesa "omnicanalidad" del título de la reunión; hoy IG/Telegram están en beta sin pruebas. Un agente, una bandeja, un cliente — no N pestañas.
- **Toca:** `meta-messaging-channel` (IG/Messenger), merge de identidad en Customer Profiles, inbox unificado. **Esfuerzo:** L–XL.

---

## Pilar 7 — Orquestación del dialer (no FIFO)
**Cubre R7.**

- **Pidieron:** correr campañas simultáneas con peso (80% contactados / 20% gestionados) y decidir a quién marcar primero.

**Solución completa:** política de orquestación por campaña — **prioridad + peso + pacing**, con el dialer interleaving por peso (respetando skills/colas por agente) y **pacing adaptativo** (por answer-rate, con tope de abandono) en vez de FIFO. **Metas/budget por campaña** (parar a N contactos o N conversiones). Control "blend" en vivo para el supervisor (sliders) + proyección de término.

- **Por qué gana:** convierte un hack (orden de creación) en comportamiento de **dialer predictivo/blended** real. Es diferenciador sobre Kommo/Chattigo (no tienen dialer serio).
- **Toca:** `campaign-dialer` (scheduler con peso/pacing), UI de blend. **Esfuerzo:** L.

---

## Pilar 8 — Agente IA híbrido (no bot estático)
**Cubre R15.**

- **Pidieron:** un agente IA en vez de un bot estático, y poder anteponerlo al flujo.

**Solución completa:** agente conversacional con **Claude** anclado en sus catálogos/programas (**RAG**), con **tools estructuradas** (consultar disponibilidad, enviar plantilla, crear lead, agendar, derivar a humano) y **guardrails** + fallback determinístico para pasos sensibles. El bot builder pasa a ser "agente + pasos estructurados opcionales", no uno-u-otro. **Human-in-the-loop** por confianza (auto-responde / sugiere / escala).

- **Por qué gana:** es la versión 2026 frente al árbol de decisión rígido; usa la ventaja que ya tienen (Bedrock+Claude cableado) y evita que el agente "alucine" en pasos críticos.
- **Toca:** `bot-runtime` (orquestación de tools), `BotBuilder.tsx` (#16). **Esfuerzo:** XL (por fases).

---

## Pilar 9 — Capa de reportes que SUPERA a Chattigo
**Cubre R16, R17, R18, R19. Benchmark = capturas de Chattigo de la reunión.**

- **Pidieron (y vimos en Chattigo):** reporte por mensaje (Excel: agente, campaña, plantilla, contenido, estado, Envío/Entrega/Lectura/Respuesta + fechas), **chat detail** por número, response rate (ej. 11%, 132/145), métricas **tiempo de 1ª respuesta (bot y ejecutivo)** y **tiempo de atención**, por **agente** (no por facultad), con su convención de nombres `fecha_código_base`.

**Solución completa — ganar en tres ejes que Chattigo no puede:**
1. **Paridad granular (table stakes):** igualar su Excel — filas por mensaje con todos los estados, exportable. Ya hay base (#6 HSM Outbound).
2. **Cross-channel + atribución (Chattigo es solo WA):** funnel unificado por programa across llamada+WA+email, atribución de golpes→conversión, **costo por conversión**. Esto literalmente no existe en Chattigo.
3. **Self-serve + agendado + alertas:** report builder (elige dimensiones/métricas), vistas guardadas por agente/programa, **exports agendados por email (#7, ya existe)**, y **alertas por umbral** ("response rate < 5% → avisar").
4. **Matar el hack del nombre de plantilla:** en vez de codificar `fecha_código_base` en el nombre y luego parsearlo, hacer **programa/base/fecha campos estructurados** en cada envío (importando su convención actual para retro-compat). Reportes confiables, sin string-parsing frágil.
5. **Métricas pedidas como columnas estándar** + extras: time-to-first-touch (speed-to-lead), **bot-deflection rate**, conversión por secuencia. **Por agente por defecto**, con drill programa→agente→conversación.

- **Por qué gana:** Chattigo es el estándar que aman, pero es **mono-canal y descriptivo**. Nosotros damos **omnicanal + atribución + self-serve + alertas**. Igualamos lo que les gusta y agregamos lo que no pueden tener.
- **Toca:** `get-hsm-report`/`HsmOutboundReport.tsx`, `AgentPerformanceReport.tsx` (#5), report builder nuevo, alertas sobre umbrales. **Esfuerzo:** L–XL.

---

## Pilar 10 — Consola de mapeo Salesforce schema-aware
**Cubre R23, R24.**

- **Pidieron:** crear el stage primero en SF y luego a mano en ARIA (les daba miedo el auto-sync); definir qué campos actualiza ARIA.

**Solución completa:** consola que **lee el esquema de SF por API** (picklists/campos), mapea stages↔valores en UI, con **drift detection** (avisa cuando SF cambió) y **auto-sync con aprobación** (sugiere el nuevo stage en ARIA, un clic para aceptar). Mapeo de campos con validación de tipos/requeridos para que ARIA nunca escriba algo que rompa SF.

- **Por qué gana:** elimina el trabajo 100% manual **sin** el auto-sync ciego que temían — el punto medio correcto (sugerir + aprobar).
- **Toca:** `salesforceClient.ts` (describe), `TaxonomyEditor.tsx` (mapeo + drift). **Esfuerzo:** M–L.

---

## Lo que NO pidieron pero un producto completo necesita

| Tema | Por qué | Pilar |
|---|---|---|
| **Opt-out/STOP + consentimiento** | Compliance WhatsApp/Meta; evita baneo del número | 3 |
| **Quiet hours / ventana legal** | Miguel ya lo mencionó (no tras 10pm) | 3 |
| **A/B testing de plantillas/secuencias** | Si miden golpes→conversión, el siguiente paso es optimizar | 2/9 |
| **Costo por programa/canal** | Les importa el costo (preguntaron $/consulta del copilot) | 1/2/9 |
| **Merge de identidad cross-channel** | Un cliente escribe por IG y WA con el mismo número | 6 |
| **Speed-to-lead como métrica de cabecera** | Factor #1 de conversión en captación educativa | 5/9 |

---

## Cómo presentárselo a UDEP (encuadre comercial)

Por cada punto: **"Pidieron X → les damos X y además Y"**. Tres mensajes ancla:
1. **"No más trabajo manual"** — deduplicar, marcar fuera de servicio, parsear nombres de Excel: lo hace la plataforma por política (Pilares 2/3/4).
2. **"Omnicanal de verdad + medible"** — un cliente, un historial, atribución de golpes→matrícula across canales (Pilares 2/6/9). Chattigo es solo WhatsApp.
3. **"Su operación, modelada como es"** — Programa como unidad viva con salud propia (Pilar 1), no un filtro.

## Secuencia sugerida (sobre el WAVE 8 del doc base)
```
1ª entrega (núcleo de valor)        2ª entrega (lo que aman + más)
├─ Pilar 1  Programa como objeto     ├─ Pilar 9  Reportes > Chattigo
├─ Pilar 2  Ledger + atribución      ├─ Pilar 5  Ingesta nativa / speed-to-lead
├─ Pilar 3  Supresión/consentim.     ├─ Pilar 7  Orquestación dialer
└─ Pilar 4  Deliverability (#14)     └─ Pilar 10 Mapeo SF schema-aware

3ª entrega (omnicanal + IA)
├─ Pilar 6  Inbox omnicanal real
└─ Pilar 8  Agente IA híbrido
```
**Nota:** Pilares 1, 2 y 3 son el corazón — atacan lo que el cliente más repitió *y* convierten sus tareas manuales en garantías del producto. Ahí está el salto de "buena herramienta" a "producto que aman".
