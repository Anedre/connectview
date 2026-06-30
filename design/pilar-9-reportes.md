# Pilar 9 — Reportes (> Chattigo)

**Objetivo (R20):** NO sobrecargar de reportes. Priorizar los que ganan el demo
UDEP y que **Chattigo no puede igualar**, + cerrar el reporte por programa que se
difirió de Pilar 1. El set final se define con Adriana (R20).

## Diferenciadores vs Chattigo

1. **Programa como dimensión** — Chattigo no tiene el concepto de "programa".
2. **Agente IA conversacional** — Chattigo no tiene bots; nosotros auditamos cada
   conversación (resolución, derivación, confianza, citaciones).
3. **Atribución omnicanal** (voz + WhatsApp + email → matrícula) — golpes por lead.

## Estado

### Fase A — Dashboard por Programa — HECHO + verificado (commit `0a2facc`)

- El reporte diferido de Pilar 1. En `/reports`, scopeado al programa activo del
  switcher global (ProgramContext).
- `manage-leads ?report=attribution[&programId]` ahora devuelve **`byStage`**
  (cuenta de leads por stageId). El front mapea label/orden con `useTaxonomy`.
- `ProgramReport.tsx`: KPIs (leads, conversión, golpes/cierre, días/cierre) +
  **embudo por etapa** (color por valoración) + conversión por # de golpes +
  mezcla de canales.
- Verificado: consolidado 37 leads / 8%; al scopear baja a 2 leads con su embudo.

### Fase B — Reporte del Agente IA — HECHO + verificado (commit `e59bb36`)

- Estrena los `conv#` que el bot-runtime persiste (Pilar 8 · logConversation).
- `get-bot-report` Lambda (`create-bot-report.mjs`, Function URL bajo
  campaign-lambda-role): agrega → total, resueltas vs derivadas, resolveRate,
  motivos de derivación, confianza promedio, herramientas usadas, fuentes más
  citadas, recientes. BYO Data Plane (tenant del JWT).
- `BotAnalyticsReport.tsx` en `/reports`.
- **🔑 Gotcha:** los conv# viven en **`connectview-ai-conversations`** (env
  `CONV_TABLE` del bot-runtime), NO en `connectview-bots`. get-bot-report leía la
  tabla equivocada → 0 pese a tenantScoped=true. Resuelto.
- Verificado: 11 conversaciones, 64% resueltas solo, 4 derivadas (3 agente + 1
  tool_budget), confianza 97%, fuente más citada la FAQ sembrada.

### Fase C — Detalle WhatsApp (R16/R17) — HECHO + verificado (commit `a18c3a2`)

- **R16 (por cliente):** `get-hsm-report` agrupa **POR NÚMERO** (sends/delivered/
  read/failed/lastTemplate/lastStatus por cliente) además del agregado por plantilla.
- **R17 (tasa + 1ª respuesta):** cruza el outbound con el **inbound de WhatsApp**
  del inbox omnicanal (`connectview-conversations`, Pilar 6) → `responseRate` +
  `avgFirstResponseSec` (1ª respuesta = primer inbound tras el envío).
- `HsmOutboundReport`: KPIs Respuestas% + 1ª respuesta + tabla "Por número"
  (Responde / 1ª respuesta por cliente). Ahora usa **authedFetch** (antes anónimo).
- **🔑 Caveat (honesto, flag `inboundTracked`):** para números **anclados a
  Connect** (como el de UDEP) el inbound vive en Connect, NO en conversations → ahí
  la respuesta no se mide; sí funciona para números **meta-mode** (Pilar 4 standalone).
- Verificado: 16 envíos / 4 plantillas; tabla por número con 9 clientes reales
  (delivered/read/failed por cliente); responseRate computado (0/9 en el set de
  prueba: los envíos no tienen inbound meta-mode que matchee).

> **Pilar 9 COMPLETO** (A + B + C). Pendiente opcional (Adriana): extender el join
> de respuesta al inbound de Connect (Contact Lens chat) para números anclados, y
> rendimiento por agente en WhatsApp (R18).

## Datos disponibles (inventario)

| Reporte                           | Tabla/endpoint                                       | Estado         |
| --------------------------------- | ---------------------------------------------------- | -------------- |
| Atribución + embudo por programa  | manage-leads ?report=attribution&programId (byStage) | ✅             |
| Agente IA (conversaciones)        | get-bot-report ← connectview-ai-conversations        | ✅             |
| HSM por plantilla (entrega)       | get-hsm-report ← connectview-hsm-sends               | ✅ (Pilar 4)   |
| WhatsApp Cloud API (Meta)         | get-whatsapp-analytics                               | ✅ (Pilar 4 C) |
| Rendimiento de agente (voz)       | AgentPerformanceReport (in-memory Contact Lens)      | ✅             |
| HSM por número / 1ª respuesta     | get-hsm-report ← conversations (Fase C, R16/R17)     | ✅             |
| Rendimiento por agente WhatsApp   | get-hsm-report byAgent ← conversations (R18, LE4)    | ✅             |
| Convención de nombre de plantilla | TemplateNameBuilder (R19, LE4)                       | ✅             |

> **🎯 PILAR 9 · LE4 — HECHA y verificada en vivo (2026-06-30).** Cierra los dos
> reportes opcionales de WhatsApp que faltaban.
>
> - **R18 (rendimiento por agente, no por facultad):** `get-hsm-report` reusa su
>   único scan de `connectview-conversations` (`scanConversations`) para agregar,
>   además del inbound por número (R16/R17), el **rendimiento por agente**:
>   conversaciones de WhatsApp atendidas, respuestas enviadas y **tiempo de
>   respuesta promedio** (entrante → su 1er saliente). Los salientes del bot (sin
>   `agent`) no cuentan. UI: sección "Por agente" en `HsmOutboundReport`.
>   **Verificado (Browser 1 + DDB):** conv de prueba (2 entrantes + 2 salientes de
>   `le4-verify`, gaps 120s/60s) → `byAgent:[{conversations:1, replies:2,
avgResponseSec:90}]` exacto; UI muestra "le4-verify · 1 · 2 · 1m 30s".
>   Limpiado.
> - **R19 (convención de nombre):** `TemplateNameBuilder` en
>   `WhatsAppTemplatesManager` (solo al crear): compone **fecha + código de
>   programa + base** (`20260630_adm_datos`) sanitizado para Meta (`a-z0-9_`) y lo
>   aplica al campo Nombre. Opcional (se puede seguir escribiendo a mano).
>   **Verificado (Browser 1):** el asistente compuso `20260630_adm_datos` y
>   "Usar este nombre" llenó el campo.
