# Plan de implementación V2 — 5 fases

> Cubre **todo lo que salió del audit del 2026-06-30**: brechas de integración (funciones aisladas), las features grandes de la visión ampliada (reemplazar Pardot/Kommo/Chattigo enteros), la red de tests (hoy ~0), y la activación de lo bloqueado-por-cliente. El alcance del **demo UDEP (pilares 1-10 / R1-R26) ya está ✅ y no entra acá** salvo el R4 (rollback SF).

**Principio de fasing:** cerrar lo suelto y armar la red → primitivas de datos → motor que las consume → expansión → activación. Cada feature grande sigue la cadence del proyecto: `design/<feature>.md` → confirmar 2-3 decisiones → build por sub-fases → deploy + verificar en vivo (Browser 1) → memoria + commit por sub-fase.

**Sizing:** S ≈ ½-1 sprint · M ≈ 1-2 · L ≈ 2-4 · XL ≈ 4+ (relativo; depende del equipo).

## Resumen

| Fase                           | Objetivo                                          | Bloques                                                                  | Esfuerzo |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| **1 · Consolidación**          | Cerrar brechas del audit + higiene + red de tests | Funciones aisladas · dead-code · tests puros                             | **M**    |
| **2 · Primitivas de datos**    | Lo que el motor grande consume                    | Lead scoring+grading · Segmentos dinámicos · 7 reportes Chattigo         | **L**    |
| **3 · Motor de Journeys**      | Reemplazar Pardot en nurturing conversacional     | Engagement Studio drip omnicanal (pasos/esperas/ramas)                   | **XL**   |
| **4 · Expansión**              | Canales + enterprise                              | Mercado Libre · Carousel/List WhatsApp · SSO SAML · tracking email       | **L**    |
| **5 · Activación + hardening** | Prender lo bloqueado-cliente + go-live            | SF rollback · nº Meta · IG comments · e2e críticos · seguridad · runbook | **M**    |

---

## Fase 1 · Consolidación y red de seguridad

**Objetivo:** que no quede NADA aislado del audit y que las fases siguientes tengan regresión automatizada. Bajo riesgo, entrega inmediata.

> **Estado de ejecución (2026-07-01):** ✅ **F1.3** gate del Copilot por rol (R29, verificado en vivo) · ✅ **F1.7+F1.2** higiene: 19 archivos muertos borrados (cards stale + hooks + páginas/primitivos sin uso); los 3 Lambdas de "salud del agente" quedan sin UI → decisión de producto (reconstruir en ARIA o decomisionar) · ✅ **F1.8** red de tests: `shared-phone` (13) + `shared-suppression` (4) verdes, guardan el dedup y la regresión `converted`→`dnc`. Commits `106d5df`, `1a6055d`. Pendientes: **F1.1** (operacional, ver abajo), **F1.5** (bump a mini-diseño), **F1.4/F1.6** (diferidos formalmente).
>
> - **F1.1 — es operacional, NO code-change:** `list-missed-contacts` es una función **ampx-managed** (en `backend.ts`) que nunca se desplegó (sus 11 hermanas sí). Requiere un **deploy del backend ampx** (`npx ampx pipeline-deploy --branch master --app-id <id>` o `ampx sandbox` en dev) que crea la Function URL y regenera `amplify_outputs.json`. No se corre a ciegas (redeploy de stack completo). Mientras tanto el hook degrada con gracia (`available:false` oculta el panel). **→ decisión del usuario / CI.**
> - **F1.5 — es M, no S:** cablear multimedia en campañas necesita campo de media a nivel campaña + UI del wizard + payload del dialer, no solo "pasar el handle". Bump a un mini-`design/` antes de codear.
> - **F1.4 / F1.6 — diferidos formalmente:** `create-connect-instance` (onboarding Opt-2, ya gateado con "backend pendiente") y `agent-channel-adapter` (`DRY_RUN=false` se activa en Fase 5 con número real).

**Incluye**

- **F1.1 — `listMissedContacts` drift:** re-deploy de `backend.ts` (`ampx`) para publicar la clave que falta en `amplify_outputs.json` → arregla el historial "Perdidas hoy". _(S)_
- **F1.2 — Slice "Salud del agente":** decidir y ejecutar — montar `ChurnRiskCard`/`WellnessCard`/`GamificationCard` en un dashboard de supervisor, **o** retirar las 3 Lambdas si se descartó la feature. (Recomendado: montarlas, el backend ya corre). _(M)_
- **F1.3 — Gate del Copilot por rol (R29):** capability `use_copilot` en `DEFAULT_MATRIX` + envolver el render en `App.tsx` con `useCan("use_copilot")`. _(S)_
- **F1.4 — `create-connect-instance` (Opt-2):** crear la Lambda + Function URL + agregar `createConnectInstance` a outputs (o marcar formalmente como prototipo diferido si no se prioriza el onboarding self-service). _(M)_
- **F1.5 — R11 multimedia en campañas:** cablear el `headerHandle` (IMAGE/VIDEO/DOCUMENT) en el path de envío masivo del `campaign-dialer`. _(S-M)_
- **F1.6 — `agent-channel-adapter`:** dejar documentado el flip `DRY_RUN=false` + permiso `socialmessaging:SendWhatsAppMessage` (se activa en Fase 5 con número real). _(S)_
- **F1.7 — Higiene de código muerto:** borrar los 16 `.tsx` sin uso (`QueueManagerPage` + `queue/*` + `pipeline/{AgentRail,Stage}` + `recordings/ContactDetailView` + `workspace/WisdomPanel` + `vox/BrandLockup` + 5 primitivos `ui/*`) y 3 funciones `_shared` sin llamar. _(S)_
- **F1.8 — Red de tests base:** unit tests de las funciones **puras** de `_shared` que hoy tienen 0 cobertura y que causan las peores regresiones (`evaluateSend`, `summarizeGolpes`, `resolveProgramIdFromAttributes`, `normalizePhone`, `sfTargetWith`) + fijar el gate `typecheck + test:run` en pre-commit/CI. _(M)_

**DoD:** `amplify_outputs` sin drift; 0 componentes/endpoints huérfanos (o borrados); Copilot gateado; suite unit verde en CI; audit re-corrido sin brechas de integración.

**Dependencias:** ninguna. Se puede empezar hoy.

---

## Fase 2 · Primitivas de datos (Scoring · Grading · Segmentos · Reportes)

**Objetivo:** construir los objetos que el motor de Journeys (Fase 3) y el dialer necesitan para dejar de ser FIFO. Esto es lo que Pardot llama "el cerebro".

**Incluye**

- **F2.1 — Lead scoring por comportamiento (Pardot P2):** `design/scoring.md` + tabla `connectview-scoring-rules` (evento→puntos: inbound, respondió, form-submit, click, llamada-conectada, apertura). Recompute en cada golpe (el ledger del Pilar 2 ya captura los toques) → `lead.score`. Nuevo trigger `lead_score_changed`. _(L)_
- **F2.2 — Grading demográfico A-F (Pardot P2):** reglas de fit (programa/fuente/attributes) → `lead.grade`. Matriz score×grade para priorización. _(M)_
- **F2.3 — Segmentos dinámicos (Pardot P3):** `connectview-segments` (predicado reutilizable sobre stage/programa/score/grade/fuente/attributes/#golpes). `manage-segments` CRUD + `SegmentBuilder.tsx` (reusa el patrón de filtros de Leads). Consumible como **audiencia** en campañas, **entrada** de journeys y **filtro** de export. _(M-L)_
- **F2.4 — Priorización del dialer por score:** el `computeSlotBudget` del Pilar 7 pondera por `score`/`grade` además de peso/prioridad (cierra el "scoring-auto" que quedó como follow-up). _(S)_
- **F2.5 — 7 reportes de Chattigo (paridad literal, #5):** empaquetar las 6 vistas actuales + las que falten ("Resumen de chats", "Detalles", "Sesiones", "Chat CRM") como reportes nombrados en `ReportsPage`. Mayormente re-packaging + 1-2 agregaciones nuevas. _(M)_

**DoD:** un lead muestra score+grade en vivo; un segmento se crea una vez y se usa en campaña+export; el dialer prioriza por score (verificable con 2 leads de distinto score); los reportes nombrados de Chattigo existen 1:1.

**Dependencias:** F2.1 antes de F2.4 y de la Fase 3 (los journeys ramifican por score). F2.3 antes de la Fase 3 (los journeys se disparan sobre segmentos).

---

## Fase 3 · Motor de Journeys / Engagement Studio (la joya)

**Objetivo:** la pieza más grande que falta para reemplazar Pardot: **secuencias drip omnicanal multi-paso** con esperas y ramas — no el `automation-engine` actual (trigger→acciones sin orden ni espera).

**Incluye**

- **F3.1 — Modelo + motor:** `design/journeys.md` + `connectview-journeys` (definición: nodos=pasos, edges=transiciones con espera/condición) + `connectview-journey-enrollments` (estado por-lead: `currentStep`, `nextRunAt`). Runner `journey-runner` en EventBridge tick (patrón `campaign-dialer`/`program-tick`) que avanza los enrollments. _(XL)_
- **F3.2 — Builder visual:** `JourneyBuilder.tsx` reusando react-flow (como el `FlowBuilder` del Pilar 8). Tipos de paso: **enviar** (WhatsApp/email/SMS), **esperar** (N días / hasta condición), **rama** (if score/attribute/respondió/segmento), **acción** (mover stage, crear tarea, llamar webhook, encolar al dialer), **meta/salida**. _(L)_
- **F3.3 — Entrada y gate de supresión:** enroll por trigger (`lead_created`, entra a segmento, `lead_score_changed` supera umbral). Cada paso de envío pasa por el motor de supresión del Pilar 3 (`evaluateSend`) — reusa lo existente. _(M)_
- **F3.4 — Observabilidad:** por-journey → inscritos, en-cada-paso, conversión, drop-off; timeline por-lead de su recorrido. Estrena datos que el reporte de atribución (Pilar 2) ya sabe leer. _(M)_
- **F3.5 — Plantillas de journey:** semillas listas (bienvenida-admisión, reactivación-7d omnicanal, carrito-abandonado, nurturing-por-programa) — convierte los `automation-engine` de una-espera en journeys de verdad. _(S)_

**DoD:** crear un journey "enviar WhatsApp → esperar 2d → si no respondió, llamar (encola dialer) → si respondió, mover stage" y verlo avanzar un lead real end-to-end en el tick; supresión respetada; drop-off visible en el reporte.

**Dependencias:** Fase 2 (scoring + segmentos). Es la fase de mayor riesgo → design doc + confirmación de decisiones antes de codear.

---

## Fase 4 · Expansión: canales y enterprise

**Objetivo:** cerrar los ❌ del roadmap ampliado que abren mercado y desbloquean deals grandes. Bloques independientes → paralelizables.

**Incluye**

- **F4.1 — Canal Mercado Libre (#24):** `design/mercadolibre.md` + OAuth ML + webhook de preguntas/mensajes + integración al inbox omnicanal (reusa `_shared/conversations.ts`, PK `mercadolibre#userId`) + responder por la API de ML. Moat LATAM. _(L-XL)_
- **F4.2 — WhatsApp Carousel + List interactivo (#11):** extender `waTemplateComponents` + create/update-template + el composer + el `campaign-dialer` para carousels y list-messages. Sube a paridad con el WhatsApp "premium" de Kommo. _(M)_
- **F4.3 — SSO SAML/OIDC (#27):** `identityProviders` en `amplify/auth/resource.ts` + metadata IdP por-tenant + branch de login federado (el CCP ya soporta `signInUrl` SAML). Bloqueador enterprise. _(M, depende del IdP del cliente)_
- **F4.4 — Tracking de email 1:1 (Pardot P4):** pixel de apertura + wrapper de links + Lambda de tracking → eventos `email_opened`/`email_clicked` en el ledger (golpes) y como trigger de journey/scoring. Única pieza de la timeline de Pardot sin paridad. _(M)_

**DoD:** un mensaje de ML entra al inbox y se responde; una campaña envía un carousel aprobado; un tenant loguea vía su IdP SAML; una apertura de email aparece como golpe en el timeline y dispara un journey.

**Dependencias:** F4.4 se integra mejor con Journeys (Fase 3) ya listo. El resto es independiente.

---

## Fase 5 · Activación con cliente, hardening y go-live

**Objetivo:** prender todo lo que el **código ya soporta pero depende de una acción del cliente**, cerrar el R4, y endurecer para producción. Se coordina con UDEP/Adriana.

**Incluye**

- **F5.1 — SF rollback de golpes (R4) + dedup determinístico:** cuando el cliente cree `VoxLeadId__c` + `Vox*__c` (VoxTouches, VoxLastTouch, VoxDaysToClose…), activar el write-back de `summarizeGolpes` en `leadSync` (el código degrada elegante si los campos no existen — patrón ya usado). _(M)_
- **F5.2 — Deliverability WhatsApp real:** conectar el número **meta-standalone** (`+51 908 825 660`) para envío+webhook → estado por-mensaje real + cuarentena en vivo + STOP en vivo + SF DoNotCall E2E (cierra el pendiente de los Pilares 3/4). Repuntar webhook es disruptivo → ventana coordinada. _(M)_
- **F5.3 — IG comments a nivel app:** con el App Secret / App Review de Meta, suscribir el objeto `instagram` (cierra la tarea #45 del Pilar 6). _(S, gated por el cliente)_
- **F5.4 — `agent-channel-adapter` en vivo:** `DRY_RUN=false` + permiso `socialmessaging:SendWhatsAppMessage`. _(S)_
- **F5.5 — Suite e2e de flujos críticos:** Playwright para login, alta de lead, campaña, bot-test/RAG, supresión, journey. Cierra el gap de "todo verificado a mano". _(M)_
- **F5.6 — Pase de seguridad + carga + runbook:** revisión de IAM/roles asumidos, límites de rate, `DEMO_RUNBOOK.md` actualizado, y sesión de reportes con Adriana (R20). _(M)_

**DoD:** golpes visibles en Salesforce; un STOP real marca DoNotCall en SF; comentarios de IG entran al inbox; suite e2e verde en CI; runbook al día.

**Dependencias:** requiere disponibilidad del cliente (campos SF, App Secret, número, ventana de webhook) → arrancar la coordinación temprano aunque el código esté listo desde fases previas.

---

## Cross-cutting

**Decisiones de producto a confirmar (antes de Fase 2-3):**

1. **Prioridad del arco:** ¿motor de engagement (Journeys/Scoring) primero — como propone este plan — o canales (Mercado Libre/Carousel) primero? Cambia el orden 2↔4.
2. **Scoring:** ¿puntaje por reglas configurables (recomendado, transparente) o un modelo? Empezar por reglas.
3. **Journeys:** ¿motor propio (recomendado, control total, reusa react-flow) o encima del `automation-engine` extendido? El propio escala mejor a esperas/ramas.

**Riesgos principales:** (a) Journeys es XL y de estado — necesita el runner idempotente bien diseñado; (b) Mercado Libre y SSO dependen de credenciales/IdP del cliente; (c) sin la red de tests de Fase 1, cada fase grande arriesga regresión en los Lambdas que bundlean `_shared` (gotcha de re-deploy).

**Regla de oro heredada:** al tocar `_shared/*`, re-desplegar TODOS los Lambdas que lo bundlean (supresión=6, bot-runtime hand-managed). La suite de Fase 1 es justo la que atrapa eso.
