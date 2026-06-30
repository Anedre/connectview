# Requerimientos UDEP — Demo Omnicanalidad ARIA (17/06/2026)

**Fuente:** grabación de la reunión "Presentación · Solución de Omnicanalidad" (1:44:32). Transcript completo: `Descargas/transcript-reunion-omnicanalidad-2026-06-17.txt`.
**Cliente:** UDEP (universidad). Decisora: **Zhenia Loyola**. Marketing/automatización: **Adriana Gómez**. Técnico: **Juan Gallardo**. Jefatura: **Paul De Rutte**. También: Águeda Gonzáles.
**Por Novasys:** Andre Alata (demo técnica), Miguel Vega (comercial), Yubiry Terán (anfitriona).
**Propósito de este doc:** listar **todo** lo que pidió/observó el cliente para diseñar las próximas actualizaciones de ARIA. Cada ítem está cruzado contra `UNIFY_ROADMAP.md` (🆕 nuevo · 🟡 parcial · ✅ ya existe — falta ajuste).

**Leyenda de esfuerzo:** S ≈ ½ día · M ≈ 1-2 días · L ≈ 3-5 días · XL ≈ 1-2 semanas.
**Prioridad:** P0 = lo repitieron / bloquea adopción · P1 = importante · P2 = menor / confirmar.

---

## 🔑 Decisión de modelado: "Programa"

> Aclaración explícita de Zhenia: para UDEP un **programa** es una **unidad comercial / de campaña** (ej. "Programa de Verano"), **no** el catálogo académico de cursos. El mapeo a cursos es difícil y no se debe forzar.

**Implicancias de diseño:**
- "Programa" es una **dimensión / etiqueta de primer nivel** (atributo `programId` / `programa`) sobre **leads y campañas** — NO se deriva de Catálogos de cursos (#30).
- Son **~56 activos**, de **vida corta (~3 meses)**, con leads **casi disjuntos** (5–10% de cruce máximo).
- Se cargan por **Excel** (lista de programas), no se construyen curso por curso.
- En toda vista relevante (Leads, Campañas, Reportes, Dashboard) debe haber un **selector de programa en cabecera**, estilo el filtro de listas de QuickSight que ya usan.

Esta decisión es transversal a R1–R3 y aparece en casi todos los reportes.

---

## A. Dimensión "Programa" (lo más pedido)

### R1 — Selector/columna "Programa" en Leads 🆕 · **P0** · `M-L`
- **Pedido (Zhenia ~28:00–32:00, 1:18):** maneja ~56 programas en paralelo; la UI hoy muestra uno solo. Necesita filtrar leads y el embudo por programa, ver 1×1 (no todos a la vez).
- **Estado vs roadmap:** el pipeline de leads existe (#4: `connectview-leads`, `connectview-manage-leads`, `LeadsPage.tsx`). La **dimensión programa es nueva**.
- **Diseño:** agregar atributo `programId` al lead + GSI `byProgram`; selector de programa en cabecera de `LeadsPage.tsx`; el embudo/tabla se filtran por el programa activo. Importar lista de programas (R3).
- **Toca:** `connectview-leads` (atributo+GSI), `manage-leads`, `LeadsPage.tsx`.

### R2 — Selector "Programa" en Campañas / Reportes / Dashboard 🆕 · **P0** · `M`
- **Pedido (Zhenia):** la lógica de programa debe aplicar también al lanzar campañas y al ver métricas.
- **Diseño:** reusar `programId`. Filtro de programa en `CampaignsPage.tsx` / wizard de campaña, en `/reportes` y en los widgets del dashboard.
- **Toca:** `CampaignsPage.tsx`, wizard, `ReportsPage.tsx`, `DashboardPage.tsx`.

### R3 — Carga de programas por Excel (Configuración) 🟡 (extiende #30) · **P1** · `M`
- **Pedido (Zhenia/Miguel ~1:08, 1:15):** subir un Excel con los programas; ARIA los ordena y los relaciona con los campos personalizados que vienen de Salesforce. Cliente enviará **5 programas de ejemplo + el layout** de cómo amarra cursos a un programa.
- **Estado vs roadmap:** Catálogos existe (#30: `connectview-catalogs`, `CatalogEditor.tsx`) pero modela tablas de cursos/planes; **falta el objeto "Programa" como agrupador comercial** + importador Excel.
- **Toca:** `connectview-catalogs` o tabla nueva `connectview-programs`, `CatalogEditor.tsx`, parser XLSX (`exceljs` ya está en el repo).

---

## B. Tracking multi-touch / historial de "golpes" → Salesforce

### R4 — Historial de envíos digitales por lead, escrito a Salesforce ⭐ 🟡 (#6/#23) · **P0** · `L`
- **Pedido (Zhenia + Adriana ~49:00–56:30):** registrar **cada toque** (WhatsApp/email/llamada) por lead con **fecha/hora + programa + canal** y empujarlo a Salesforce (SF = fuente única de verdad). Objetivo: medir "**cuántos golpes** por conversión", ver el journey completo del lead y poder **deduplicar** ("a estos 50 ya les envié el lunes → mándale a los otros 50").
- **Estado vs roadmap:** hay base — `connectview-hsm-sends` (#6, fila por envío WhatsApp), wrap-up history append-only, y `connectview-salesforce-sync` (#23, escribe Lead+Task). **Falta:** que **cada envío digital** escriba una Activity/Task en SF, y una **vista de "historial de campañas/envíos" por lead** análoga al historial de telemarketing.
- **Toca:** `salesforce-sync` (Task por envío), `connectview-hsm-sends`, vista de historial en el detalle del lead/cliente.

### R5 — Estado de entrega real de WhatsApp (sent/delivered/read/failed) 🟡 (#14) · **P0** · `M`
- **Pedido (Adriana):** saber si el mensaje se entregó / falló / número equivocado — base de todo reporte de WhatsApp.
- **Estado vs roadmap:** **#14 ya está diseñado** (`whatsapp-status-webhook`) pero falta desplegar y cablear los eventos de estado (AWS Social Messaging / Meta) que llenan `delivered/read/failed` en `connectview-hsm-sends` (hoy solo `sent`).
- **Toca:** `whatsapp-status-webhook` (deploy + suscripción), `connectview-hsm-sends`.

### R6 — Guard anti-doble-envío de WhatsApp 🆕 · **P0** · `M`
- **Pedido (Adriana ~49:06):** validar que a un número **no se le envió ya** (ese día / esa campaña) antes de un blast; un filtro que **excluya los ya contactados**.
- **Diseño:** pre-check del envío contra `connectview-hsm-sends` (por phone + ventana de fecha); opción "excluir números enviados en los últimos N días" en el wizard de campaña WhatsApp. Reforzable con regla de Automatizaciones (#15).
- **Toca:** wizard de campaña WhatsApp, `send-whatsapp-template`, consulta a `hsm-sends`.

---

## C. Campañas (voz + WhatsApp)

### R7 — Pesos/prioridad entre campañas simultáneas 🆕 · **P1** · `L`
- **Pedido (Zhenia ~44:30–45:30):** correr campañas a la par con peso (ej. 80% "contactados" / 20% "gestionados") y decidir a quién marcar primero. Hoy es **FIFO** por orden de creación.
- **Workaround actual (válido para demo):** prioridades del routing profile + orden de creación de campañas.
- **Toca:** `campaign-dialer` (interleaving/peso por campaña).

### R8 — Crear contacto/lead al vuelo desde la llamada (referidos) 🟡 · **P1** · `M`
- **Pedido (Zhenia ~35:00–36:40):** al marcar un número nuevo que no está en SF (referidos), poder crearlo directo desde el panel de cliente del Agent Desktop (nombre, apellido, teléfono…) → candidato automático en SF, **sin** tener que pasar por una campaña.
- **Estado vs roadmap:** hoy el alta de candidato exige campaña/CSV. Falta el alta inline.
- **Toca:** panel cliente del Agent Desktop, `manage-leads`, `salesforce-sync`.

### R9 — Ruteo por atributo a colas (evitar 1 cola por programa) ✅ (demostrado) · **P2** · confirmar
- **Contexto (Zhenia ~42:00):** tener una cola por programa es inviable (50+ colas efímeras); hoy usan **colas generales inbound/outbound**. El **flujo base omnicanal + ruteo por atributo de columna** ya demostrado cubre esto.
- **Acción:** confirmar con el cliente que el flujo base + "flow existente" resuelve su operación de colas.

### R10 — Auto-tipificación en buzón / fuera de servicio ✅ (#3) · **P2** · confirmar
- **Pedido (Zhenia ~46:17):** que el discador detecte buzón/fuera de servicio y tipifique "no contactado" solo, para que el asesor se concentre en contactos efectivos. **Ya existe** (auto-clasificación #3 + dialer), editable.

### R11 — WhatsApp con imágenes/brochures en campañas ✅/confirmar · **P1** · `S`
- **Pedido (Zhenia ~1:31):** enviar imágenes/brochures por WhatsApp (lo hacen hoy en Chattigo).
- **Estado:** el **header multimedia de plantillas ya está construido**. Confirmar que aplica también en **campañas masivas**, no solo en el chat 1:1.

---

## D. Meta / canales (reemplazar Zapier)

### R12 — Formulario Meta (FB/IG) → dispara WhatsApp (sin Zapier) ⭐ 🟡 (#15/#23/#25) · **P0** · `L`
- **Pedido (Adriana + Zhenia ~1:00–1:04, 1:18, 1:40):** su flujo hoy es **Meta(FB/IG) → form → Zapier → Pardot → Salesforce**. Quieren que cuando un lead llena un **formulario en Facebook/Instagram** (NO en WhatsApp) se dispare automáticamente una plantilla/bot de WhatsApp → **eliminar Zapier**. Caso previo de éxito: Pacífico Seguros con Oracle Eloqua.
- **⚠️ Aclaración importante:** **NO** es WhatsApp Flows (#10, forms in-chat) — sus formularios viven en FB/IG. El camino correcto: lead de Meta → llega a SF → `salesforce-inbound-webhook` (#23) → `automation-engine` (#15) dispara `send_whatsapp_template`. Alternativa: ingestión directa de Lead Ads de Meta.
- **Pendiente de cliente:** screenshots de sus formularios Meta + cómo entran hoy.
- **Toca:** `automation-engine` (#15), `salesforce-inbound-webhook` (#23) o nuevo conector Lead Ads de Meta.

### R13 — Inbound FB / Instagram / Messenger 🆕 (roadmap) · **P1** · `L-XL`
- **Pedido (Águeda ~1:05):** mucha gente **escribe directo** a Facebook/Instagram/Messenger (sin llenar formulario). Quieren esos canales como inbound en ARIA.
- **Estado:** Instagram/Telegram están en beta **sin pruebas**. Es la próxima actualización declarada por Novasys en la demo.
- **Toca:** nuevo `meta-messaging-channel` (IG/Messenger), inbox unificado.

### R14 — Estrategia Zapier / Pardot 🟡 (#23) · **P1** · doc/decisión
- **Acuerdo de la demo:** Pardot se **mantiene** para correos masivos; Zapier se **reemplaza** cuando R12+R13 estén listos. Hoy algunos leads de Meta **no llegan** (falla de Zapier) → argumento de venta.

---

## E. Bots / Agentes IA

### R15 — Agente IA (guía) antepuesto al flujo, no bot estático 🟡 (#16) · **P1** · depende de #16 `XL`
- **Pedido (Adriana ~58:25):** prefieren un **agente IA** sobre un bot estático; poder ponerlo al inicio del flujo y evitar la estructura rígida. Usar botones/widgets interactivos de WhatsApp donde aplique.
- **Estado:** el **bot builder visual (#16)** es lo más pesado del roadmap y aún no está construido; el agente guía IA ya se demostró en piezas.
- **Toca:** `BotBuilder.tsx` (#16), `bot-runtime`.

---

## F. Reportes (paridad/mejor que Chattigo) — Adriana

### R16 — Reporte WhatsApp detallado por mensaje y por cliente 🟡 (#5/#6) · **P0** · `L`
- **Pedido (Adriana ~1:36–1:40):** igualar/superar Chattigo: **chat detail por número** (conversación completa), estado de entrega por mensaje, y **tasa de respuesta** (ej. "11% respuestas · 132/145 exitosos").
- **Estado vs roadmap:** #6 (HSM Outbound) tiene la base agregada por plantilla; **falta el "chat detail" por número** y el desglose fino.
- **Toca:** `HsmOutboundReport.tsx`, `get-hsm-report`, nuevo "chat detail" sobre el thread.

### R17 — Métricas explícitas pedidas 🆕 · **P0** · `M`
- **Pedido (Adriana + Águeda ~1:42):** **# mensajes enviados**, **tiempo de primera respuesta (del bot y del ejecutivo)**, **tiempo de atención del ejecutivo**.
- **Toca:** `ReportsPage.tsx` / `AgentPerformanceReport.tsx` (#5), métricas sobre thread + Contact Lens.

### R18 — Reporte por **agente** (no por facultad) 🟡 (#5) · **P1** · `M`
- **Pedido (Adriana ~1:36):** Chattigo reporta por facultad; quieren por **agente/ejecutivo** (cada uno su usuario).
- **Estado:** `AgentPerformanceReport.tsx` (#5) ya reporta por agente en voz; extender a WhatsApp/envíos.

### R19 — Convención de nombres de plantilla 🆕 · **P2** · `S`
- **Pedido (Adriana ~1:39):** nombran plantillas como **fecha + código de programa + base (datos/actual)** para identificarlas y reportar. Soportar/parametrizar esa convención.

### R20 — Definir set final de reportes con Adriana · **P2** · logística
- "No sobrecargar de reportes." Sesión dedicada con Adriana + revisar su entorno Chattigo (lo mostró al final) para fijar el set.

---

## G. Grabaciones / historial

### R21 — Auditoría de conversaciones (WhatsApp/llamadas) ✅ · **P2** · confirmar
- **Pedido (Zhenia ~1:09):** auditar conversaciones. **Ya existe** en Grabaciones (historial por contacto: llamadas, WhatsApp, emails, adjuntos, actividad; audio + transcript).

### R22 — Detalle de chat WhatsApp en tabla / exportable 🆕 · **P2** · `S-M`
- **Observado (Andre ~1:40):** el detalle del chat existe pero falta llevarlo a tabla/export para reporting.

---

## H. Configuración / integración

### R23 — Sync de stages SF↔ARIA (manual, por ahora) ✅ (decisión) · **P1** · doc
- **Acordado (Zhenia ~1:13–1:15):** crear el stage **primero en Salesforce**, luego replicarlo en ARIA (Configuración → Tipificación). Auto-sync se difirió para evitar desconfiguración; el cliente lo aceptó. **Futuro:** auto-sync de stages.

### R24 — Mapeo de campos SF que ARIA actualiza 🟡 (#23) · **P1** · input cliente
- **Acordado (Miguel/Andre ~12:00–13:00):** ARIA **no crea campos** en producción; el cliente indica **qué campos** de SF se actualizan. Definir el mapeo (usa `salesforceValue` por stage que ya soporta el editor de taxonomía).

### R25 — Setup de integración (Connect / SF / WhatsApp) ✅ · **P2** · ejecución
- Connect: región + ARN + permitir link Amplify + CloudFormation (roles IAM) + stack de tablas DynamoDB + verify. SF: OAuth webhook (prod/sandbox) + "permitir acceso". WhatsApp: auto desde Connect o creds Meta (phone number ID + WABA ID + token permanente). **Novasys ayuda con el setup.** Conectar al **sandbox de SF** de UDEP para pruebas.

### R26 — UTM / parámetros de seguimiento en el lead 🆕 · **P2** · `S`
- **Pedido (Adriana ~16:00):** falta el **UTM** (esp. `utm_campaign` = código del programa) en la vista de contacto. Relacionado con R1 (programa).

### R27 — Email 1:1 (SMTP Connect) ✅ · **P2** · confirmar
- 1-a-1 vía Amazon Connect (puede ser HTML); integrable con otros SMTP; **no** reemplaza inbox ni envíos masivos (Pardot se queda). Confirmar alcance.

### R28 — Login 1×/día de Connect ✅ · **P2** · confirmar
- Confirmado en demo (re-login diario / por inactividad). Ya resuelto a nivel plataforma; validar con uso real.

### R29 — Copilot/asistente (costo + desactivable por rol) ✅ (#28) · **P2** · confirmar
- Asistente = Claude **Haiku** vía Bedrock, ~**$0.001/consulta**, **desactivable por rol** (permisos #28). Es ayuda de uso de la plataforma (tipo help-desk), no un agente de cierre.

---

## I. Compromisos y próximos pasos (no-dev)

**El cliente envía:**
- Lista de requerimientos (Zhenia).
- 5 programas de ejemplo + layout de estructura programa↔cursos (Zhenia) → habilita R1/R3.
- Reportes/métricas que necesita + screenshots de **formularios Meta** + flujos de sus procesos (Adriana) → habilita R12/R16/R17.

**Novasys:**
- Conectar ARIA al **sandbox de Salesforce** de UDEP para pruebas (admins: Carlos Olortiga, Julio).
- **Visita presencial + entrevistas con asesores en campo** antes de implementar (pedido de Paul, para cerrar gaps que no salen en reuniones virtuales).
- Agendar follow-ups con Zhenia y Adriana.

**Marco comercial (Miguel):** "Services as a Service" con **vertical educación**; suscripción mensual + add-ons; producto vivo con releases. Nombre preliminar **ARIA** (A=Amazon, R=CRM, I=IA).

---

## 📌 Propuesta de "WAVE 8 — UDEP post-demo" (orden sugerido)

```
SPRINT A (modelo + tracking, el núcleo)     SPRINT B (Meta + reportes que aman)
├─ R1  Programa en Leads ⭐ (P0)            ├─ R12 Meta-form → WhatsApp (sin Zapier) ⭐ (P0)
├─ R2  Programa en Campañas/Reportes (P0)   ├─ R16 Reporte WhatsApp por mensaje (P0)
├─ R5  Estado de entrega WhatsApp (#14,P0)  ├─ R17 Métricas (1ª respuesta/atención) (P0)
├─ R4  Historial de golpes → SF ⭐ (P0)     └─ R6  Guard anti-doble-envío (P0)
└─ R3  Import de programas (P1)

SPRINT C (campañas + canales)               BACKLOG / depende de piezas grandes
├─ R7  Pesos/prioridad de campañas (P1)     ├─ R13 Inbound FB/IG/Messenger (P1, L-XL)
├─ R8  Crear lead desde la llamada (P1)     ├─ R15 Agente IA en flujo (depende #16, XL)
├─ R18 Reporte por agente (P1)              ├─ R22 Chat detail en tabla (P2)
└─ R11 WhatsApp multimedia en campañas      └─ R19/R26 Convención plantillas / UTM (P2)
```

**Quick wins (alto impacto, bajo esfuerzo):** R5 (desplegar #14 ya diseñado), R11 (multimedia ya construido → confirmar en campañas), R26/R19 (S). **El corazón de la próxima entrega:** R1+R2 (programa) y R4 (historial de golpes → SF) — son los dos temas que más repitió el cliente.

---

## Cruce rápido contra `UNIFY_ROADMAP.md`

| Req | Tema | Estado | Roadmap |
|---|---|---|---|
| R1/R2 | Dimensión Programa | 🆕 | extiende #4 |
| R3 | Import programas Excel | 🟡 | extiende #30 |
| R4 | Historial golpes → SF | 🟡 | #6 + #23 |
| R5 | Estado entrega WhatsApp | 🟡 | **#14 (desplegar)** |
| R6 | Anti-doble-envío | 🆕 | nuevo (apoya #15) |
| R7 | Pesos de campañas | 🆕 | nuevo (`campaign-dialer`) |
| R8 | Lead desde llamada | 🟡 | extiende #4 |
| R12 | Meta-form → WhatsApp | 🟡 | #15 + #23 (≠ #10) |
| R13 | Inbound FB/IG | 🆕 | nuevo canal |
| R15 | Agente IA en flujo | 🟡 | #16 |
| R16/R17/R18 | Reportes WhatsApp | 🟡 | #5 + #6 |
| R9/R10/R11/R21/R25/R27/R28/R29 | varios | ✅ | ya existe — confirmar |
| R23/R24 | Stages/campos SF | 🟡/decisión | #23 |
