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

### Fase C — Detalle WhatsApp (R16/R17) — PENDIENTE (gated por R20)

- R16: reporte WhatsApp **por mensaje y por cliente** (chat detail por número,
  estado por mensaje, tasa de respuesta "11% · 132/145").
- R17: **# mensajes enviados, tiempo de 1ª respuesta** (bot y ejecutivo), tiempo
  de atención del ejecutivo.
- Base: el reporte HSM (`get-hsm-report` + columnas delivered/read/failed de
  Pilar 4) ya cubre la entrega por plantilla. Falta: agrupar por número
  (outbound), y para tasa de respuesta / 1ª respuesta hay que cruzar el inbound
  (`connectview-conversations` Pilar 6) — más plumbing.
- **Decisión:** definir el alcance exacto con Adriana (R20 pide no sobrecargar);
  candidatos: "HSM por número" (solo outbound, barato) y "tiempo de 1ª respuesta"
  (requiere join con inbound).

## Datos disponibles (inventario)

| Reporte                          | Tabla/endpoint                                       | Estado         |
| -------------------------------- | ---------------------------------------------------- | -------------- |
| Atribución + embudo por programa | manage-leads ?report=attribution&programId (byStage) | ✅             |
| Agente IA (conversaciones)       | get-bot-report ← connectview-ai-conversations        | ✅             |
| HSM por plantilla (entrega)      | get-hsm-report ← connectview-hsm-sends               | ✅ (Pilar 4)   |
| WhatsApp Cloud API (Meta)        | get-whatsapp-analytics                               | ✅ (Pilar 4 C) |
| Rendimiento de agente (voz)      | AgentPerformanceReport (in-memory Contact Lens)      | ✅             |
| HSM por número / 1ª respuesta    | (nuevo, Fase C)                                      | ⏳ gated       |
