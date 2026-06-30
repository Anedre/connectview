# Pilar 8 — Agente IA híbrido (no bot estático) · Diseño técnico

> Cubre **R15**: un agente conversacional con **Claude** anclado en catálogos/programas/FAQ (**RAG**), con **tools estructuradas**, **guardrails** + confirmación de acciones sensibles, y **human-in-the-loop por confianza** (auto-responde / escala). El bot builder pasa a ser "agente + pasos estructurados opcionales". Toca `bot-runtime` + `BotBuilder`. Esfuerzo XL (por fases). Ver `REQUERIMIENTOS-UDEP-MEJORAS.md` (Pilar 8).

## 0. Hallazgo clave (mapeo de 2 agentes)

**El motor agéntico YA EXISTE** — no se reconstruye:

- `bot-runtime/handler.ts` nodo `ai_agent` con 2 caminos: `runAi` (single-shot) y **`runAiWithTools`** (loop de tool-use de Claude, 4 iteraciones, `max_tokens:700`, `tools:[…]`).
- **4 tools**: `book_appointment`→manageAppointment, `upsert_lead`→manageLeads, `lookup_customer`→lookupCustomerProfile, `send_whatsapp_template`→sendWhatsAppTemplate (handler.ts:186-221). Más `handoff_to_human` + `resolve_conversation` (terminales).
- Modelos (handler.ts:40-45): Opus 4.8 / Sonnet 4.6 / Haiku 4.5 (`us.anthropic.*-v1:0` inference profiles) + fallback Haiku. Bedrock **por-tenant** (`resolveBedrock`, STS).
- Estado + log de conversación (connectview-bots `conv#…`). Simulador `BotTester.tsx` ("Probar bot") pasa `toolEndpoints`.
- Nodo `ai_agent` (botFlow.ts:526-587): hoy solo `model/objective/instructions/handoffWhen/maxTurns`. El inspector auto-renderiza los `fields` de NODE_KINDS.

**Gaps (= el Pilar 8):**

1. **RAG real** — `knowledge` es texto estático; falta cargar **catálogos (connectview-catalogs) + programas + FAQ** en vivo al system prompt.
2. **Config en el builder** — el runtime acepta `d.tools` pero el nodo no expone tools/RAG/guardrails/confianza/confirmar.
3. **Confianza → human-in-the-loop** — hoy 3 estados (continue/resolved/handoff); falta **score de confianza + umbral → escalar**.
4. **Confirmar acciones sensibles** (guardrail).

## 1. Decisiones tomadas ✅ (2026-06-30, confirmadas)

1. **Auto + escala por confianza.** El agente auto-responde; si su confianza < umbral (por-agente, default ~70) → deriva a humano (rama handoff).
2. **Confirmar las acciones sensibles** (send_whatsapp_template / book_appointment / upsert_lead): el agente confirma con el cliente antes de ejecutarlas; las de solo-lectura (lookup) van directo.
3. **Grounding = Catálogos + Programas + Base de conocimiento (FAQ)** nueva.

## 2. Modelo / piezas

### Config del nodo `ai_agent` (botFlow.ts + inspector)

- `enabledTools: string[]` — qué tools habilitar (checkboxes).
- `ragCatalogs: string[]` (catalogIds) · `ragPrograms: boolean` · `ragKbId: string` — fuentes de grounding (pickers dinámicos en el inspector).
- `guardrails: string` — qué NO hacer.
- `confidenceThreshold: number` (0–100, default 70) — bajo esto → escala.
- `confirmSensitive: boolean` (default true).

### Runtime (`runAiWithTools` / `runAi`)

- **RAG:** al entrar al nodo, leer los catálogos seleccionados (connectview-catalogs by id) + programas (connectview-programs) + FAQ (connectview-knowledge-bases) → formatear como texto → inyectar en el bloque `knowledge` del system prompt.
- **Tools:** filtrar `IMPLEMENTED_TOOLS` por `enabledTools`.
- **Confianza:** pedirle a Claude un `confidence` (0–100) en su salida; si `< confidenceThreshold` y no resolvió → `handoff`.
- **Confirmar sensibles:** instrucción de system prompt ("antes de ejecutar send/book/upsert confirmá con el cliente"). El loop no ejecuta la tool hasta que el cliente confirme (el modelo lo maneja conversacionalmente).

### Base de conocimiento (FAQ) — pieza nueva

- Tabla `connectview-knowledge-bases` (PK=kbId): `{ kbId, name, entries:[{id,q,a,tags}], updatedAt }`.
- Lambda `manage-knowledge` (CRUD) + endpoint `manageKnowledge`.
- UI de gestión (Configuración o el builder) para cargar FAQs.
- El runtime lee la KB seleccionada para el RAG.

## 3. Plan por fases

- **Fase A1 (cerebro):** runtime RAG (catálogos/programas) + filtro de tools + confianza/umbral + confirmar-sensibles; config del nodo (campos estáticos guardrails/confianza/confirmar + sección custom tools/RAG en el inspector). Verificable en el simulador "Probar bot".
- **Fase A2 (KB):** tabla `connectview-knowledge-bases` + `manage-knowledge` + UI de FAQs + RAG desde la KB.
- **Fase B (afinado):** budget de tools, citaciones de fuente, métricas de confianza/derivación, fallback determinístico por paso.

> El motor ya existe → el Pilar 8 es ANCLAR (RAG) + CONFIGURAR (builder) + GOBERNAR (confianza/confirmar), no reescribir.
