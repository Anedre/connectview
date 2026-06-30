# Pilar 1 — "Programa" como objeto operativo · Diseño técnico

> Diseño de la solución completa para R1/R2/R3/R26 (ver `REQUERIMIENTOS-UDEP-MEJORAS.md`). Aterrizado en el código actual (mapeo en cabeza de este doc). Objetivo: que "Programa" deje de ser un filtro y sea **la unidad de operación** de ARIA.

## 0. Contexto y alcance

UDEP maneja **~56 programas en paralelo**, de **vida corta (~3 meses)**, con leads **casi disjuntos** (5–10% de cruce). En Chattigo el "programa" es el contexto de todo (filtra dashboard, etiqueta cada chat, agrupa plantillas y envíos). En ARIA hoy **no existe** la dimensión.

**Lo que entregamos (no un filtro):** un objeto Programa de primer nivel con ciclo de vida, un **hub** con salud por programa, un **switcher global** que scopea toda la app, **membership N:N** lead↔programa (etapa por programa) y **auto-tagging** por origen para que nadie etiquete a mano.

---

## 1. ⚠️ Grano de "Programa" — decisión a confirmar con el cliente

Hay dos granos candidatos en la evidencia:
- **Facultad/unidad** (lo que Chattigo llama "campaign": `Humanidades_UDEPP`, `Medicina_UDEPP`, `Idiomas_UDEPP`, `Derecho_UDEPP`, `CCEE_UDEPP`, `Posgrado_UP`) → ~10-15.
- **Programa comercial específico** (lo que dijo Zhenia: "Programa de Verano", y los códigos `ded261`, `toefl264`, `dap261`, `pmi261`…) → ~56.

**Decisión de diseño:** modelamos **Programa = programa comercial (grano fino, ~56)**, con un campo opcional **`faculty`/`unidad`** para agrupar (Posgrado, CCEE, etc.). Así soporta ambos: el switcher filtra por programa, y el hub puede agrupar/colapsar por facultad. Se confirma el grano exacto cuando el cliente mande sus **5 programas de ejemplo + layout** (pendiente acordado en la reunión). El modelo no se bloquea por esto.

---

## 2. Modelo de datos

### 2.1 Tabla nueva `connectview-programs`
PK=`programId` (UUID). Pooled Vox-side (como `connectview-leads`/`-campaigns`).

```ts
interface Program {
  programId: string;            // PK
  tenantId?: string;            // BYO multi-tenant (como en campaigns)
  code: string;                 // código corto del cliente (ej. "ded261", "verano26") — único por tenant
  name: string;                 // "Diplomado en Educación 2026-I"
  faculty?: string;             // agrupador opcional: "Posgrado", "CCEE", "Idiomas"...
  description?: string;
  status: "borrador" | "activo" | "pausado" | "cerrado" | "archivado";
  color?: string;               // para chips/cards

  // Ventana de vida (~3 meses)
  startDate?: string;           // ISO
  endDate?: string;             // ISO → dispara auto-archivado
  autoArchive?: boolean;        // default true

  // Defaults operativos del programa (heredan a sus campañas/leads)
  defaultQueueId?: string;      // cola Connect por defecto
  defaultContactFlowId?: string;
  defaultStageId?: string;      // etapa inicial de un lead nuevo del programa
  kpiTargets?: { contactRate?: number; conversion?: number; leadsGoal?: number };

  // Snapshot al cerrar (métricas congeladas)
  metricsSnapshot?: ProgramMetrics;

  createdAt: string; createdBy: string;
  updatedAt?: string; archivedAt?: string;
}

interface ProgramMetrics {       // calculado on-read; persistido solo al cerrar
  leads: number;
  byStage: Record<string, number>;
  contactRate?: number;          // % contactados
  conversion?: number;           // % cierre/matrícula
  touches?: number;              // golpes totales (Pilar 2)
  lastActivityAt?: string;
}
```

### 2.2 Tabla nueva `connectview-lead-programs` (membership N:N) ⭐
El corazón del pilar. Un lead puede estar en varios programas con **etapa propia por programa** (resuelve el 5–10% de cruce que un campo plano rompería).

```
PK = programId      (Query "leads del programa X" = barato, reemplaza el full-scan actual)
SK = leadId
GSI "byLead": PK = leadId   (Query "programas del lead Y")
attrs: stageId (etapa EN este programa), source, addedAt, updatedAt, untyped?
```

- "Listar leads del programa activo" → `Query(PK=programId)` — **más rápido que el scan actual de `connectview-leads`**.
- "Ver a qué programas pertenece un lead" → `Query GSI byLead(PK=leadId)`.
- Lead sin membership → cae en **"Sin programa"** (legacy/no asignados).

### 2.3 Cambio mínimo en `connectview-leads`
- Agregar `primaryProgramId?` (conveniencia: el programa "principal" del lead, para vistas no-scopeadas y back-compat). La verdad por-programa vive en la membership.
- `lead.stageId` se mantiene como la etapa del `primaryProgram` (o la última tocada). **Cuando hay programa activo, el board lee `membership.stageId`.**

### 2.4 Ciclo de vida (state machine)
```
borrador ──activar──► activo ──pausar──► pausado ──reactivar──► activo
                          │                  │
                          └──── cerrar ──────┴──► cerrado ──(auto, +Xd)──► archivado
```
- **cerrar:** congela `metricsSnapshot`, pausa campañas asociadas, libera colas.
- **archivado:** sale del switcher por defecto (filtro "incluir archivados"); sus leads quedan accesibles en "Sin programa activo".
- **auto-archivado:** un tick (EventBridge) archiva programas `cerrado`/vencidos por `endDate`. Reusa el patrón de `campaign-dialer`/`automation-tick`.

---

## 3. Auto-tagging por origen (nadie etiqueta a mano)

Punto único: `amplify/functions/_shared/leadSync.ts` (`propagateLead()` / `bulkUpsertVoxLeads()`). Hoy reciben `source`; les agregamos `programId` y, al upsertar el lead, **escriben también la membership**.

| Origen | De dónde sale el programa |
|---|---|
| **Campaña** (`create-campaign`) | la campaña lleva `programId` → se propaga a cada lead/membership (hoy solo pone `source:"Vox Campaña: X"`) |
| **CSV** (`bulkUpsertVoxLeads`) | columna `programa`/`program` en el CSV, o el `programId` de la campaña que lo sube |
| **Web form** (`web-form-capture`) | `programId` en el payload del form (o resuelto por `utm_campaign`) |
| **Salesforce inbound** (`salesforce-inbound-webhook`) | mapeo de un campo SF → `programId` (config en el conector, Pilar 10) |
| **Meta Lead Ads** (Pilar 5) | el `form id`/campaña Meta → `programId` |
| **Manual** (`manage-leads` POST) | `programId` del contexto de programa activo en la UI |

**R26 (UTM):** `utm_campaign` = código de programa → resolver a `programId` por `code`. Si no matchea, queda en `attributes.utm_campaign` y se sugiere crear el programa.

---

## 4. Backend

### 4.1 Lambda nuevo `connectview-manage-programs` (Function URL, JWT)
- `GET` → lista de programas (con `ProgramMetrics` calculado on-read: Query membership + agregación). Filtros: `?status=`, `?faculty=`, `?includeArchived=`.
- `GET ?programId=` → un programa + su salud detallada.
- `POST` → upsert (crea/edita). Escrituras gated a **Supervisores/Admins** (permisos #28: nueva capability `manage_programs`).
- `POST {action:"transition", programId, to}` → cambia estado (activar/pausar/cerrar/archivar) con efectos (snapshot, pausar campañas).
- `POST {action:"importExcel", rows}` → **R3**: alta masiva de programas desde Excel (reusa `exceljs` ya presente). Acepta `code,name,faculty,startDate,endDate`.
- `POST {action:"assign", programId, leadIds[]}` / `{action:"remove",…}` → membership manual.
- `DELETE ?programId=` → solo si `borrador` o sin leads.

### 4.2 Cambios en Lambdas existentes
- `manage-leads`: `GET ?programId=` → Query membership en vez de scan; el lead trae su `stageId` de la membership cuando se scopea. `POST` acepta `programId`. `action:"move"` actualiza `membership.stageId` (no solo `lead.stageId`) cuando hay programa activo.
- `_shared/leadSync.ts`: `propagateLead`/`bulkUpsertVoxLeads` aceptan `programId` y escriben membership (§3).
- `create-campaign` / `update-campaign`: aceptan y persisten `programId`; el dialer y los envíos heredan defaults del programa.

### 4.3 Tick `connectview-program-tick` (EventBridge, rate 1h)
Auto-archivado por `endDate`, refresh de `metricsSnapshot` de programas activos (opcional/caché), y aviso "programa por vencer".

### 4.4 `amplify_outputs.json` + `src/lib/api.ts`
Nuevo endpoint `managePrograms` → `getApiEndpoints().managePrograms`. Provisioning idempotente vía `scripts/` (patrón `create-*.mjs`).

---

## 5. Frontend

### 5.1 `ProgramContext` (nuevo, `src/context/ProgramContext.tsx`)
```ts
interface ProgramContextValue {
  programs: Program[];                 // activos (no archivados por defecto)
  activeProgramId: string | "all" | "none";
  setActiveProgram(id): void;          // persiste en localStorage
  activeProgram?: Program;
  loading: boolean;
  refresh(): void;
}
```
- Provider en `AppLayout.tsx` (envuelve todo, como TopBarSlotProvider).
- Persistencia: `localStorage` (no hay URL params; React 19 + RR7). Sobrevive refresh y navegación — exactamente lo que la exploración marcó como necesario.

### 5.2 `ProgramSwitcher` (top bar)
- Monta en `AppTopBar.tsx`, lado derecho, **junto al selector de estado del agente** (ambos son "scope controls").
- Dropdown con **buscador** (los 56 son muchos) + atajo ⌘K. Opciones: "Todos los programas", "Sin programa", y la lista (agrupable por `faculty`). Cada item: chip de color + `code` + dot de salud (verde/amber/rojo por contact-rate o días-para-cierre).
- Al elegir → `setActiveProgram` → **toda la app se scopea** (leads, campañas, reportes, dashboard).

### 5.3 Programs Hub (`/programs` → "Crecimiento › Programas")
- Ruta nueva en `App.tsx`, entrada en `VoxSidebar` (sección Crecimiento, arriba) y en `CRUMBS` de `AppTopBar`.
- **Grid de tarjetas accionables** (no lista estática estilo QuickSight): por programa → nombre + `code` + badge de estado + facultad + ventana (start–end, "faltan N días") + **salud en vivo**: leads, mini-funnel por etapa, contact-rate, conversión, # golpes, última actividad. Orden por salud / días-para-cierre. Filtro por estado/facultad + toggle "incluir archivados".
- Acciones (gated por rol): crear/editar/cerrar/archivar/duplicar. Click en card → `setActiveProgram` (entra al contexto) + opción "ver detalle".
- **Vista cross-programa** (los 56 a la vez) **+** deep-dive de uno.

### 5.4 Program detail (deep-dive)
Reusar los widgets de `DashboardPage`/`InsightsPanel` scopeados al programa (embudo, sentimiento, ranking de agentes, golpes). MVP: el propio hub-card expandible; v2: `/programs/:id`.

### 5.5 Scoping por página (patrón uniforme)
Cada página lee `useProgram()` y pasa `activeProgramId` a su fetch:
- **LeadsPage:** nuevo `programFilter` desde contexto; `load()` llama `manageLeads?programId=`; `passesFilters()` ya es el patrón. El board usa `membership.stageId`.
- **CampaignsPage / CampaignCreatePage:** filtro + **campo Programa en el wizard** (reemplaza/absorbe la heurística `nivel` legacy de U. de Piura). 
- **ReportsPage:** agregar `programId` a `ContactFilters` (`src/components/reports/ContactFilters.tsx`).
- **DashboardPage:** pasar `programId` a `useRealtimeMetrics`/`useContacts`.

---

## 6. Mapeo a requerimientos

| Req | Cómo lo cubre |
|---|---|
| **R1** Programa en Leads | §5.5 LeadsPage scopeado + membership; switcher §5.2 |
| **R2** Programa en Campañas/Reportes/Dashboard | §5.5 + campo en wizard |
| **R3** Import de programas (Excel) | §4.1 `action:"importExcel"` (exceljs) |
| **R26** UTM = código de programa | §3 resolución `utm_campaign`→`code`→`programId` |

---

## 7. Plan de construcción por fases

**Fase A — Fundación (M-L):** tabla `connectview-programs` + `manage-programs` (CRUD + transición) + `ProgramContext` + `ProgramSwitcher` + Programs Hub (cards con conteos básicos) + ruta/sidebar/crumbs + capability `manage_programs`. *Entrega visible: crear programas y cambiar el contexto global.*

**Fase B — Membership + scoping (L):** tabla `connectview-lead-programs` (+GSI byLead) + `manage-leads ?programId` (Query scopeado) + auto-tagging en `leadSync` (campaña/CSV/form/SF) + LeadsPage scopeada (board lee membership). *Entrega: leads por programa, sin etiquetar a mano.*

**Fase C — Ciclo de vida + salud + resto (L):** `program-tick` (auto-archivado + snapshot) + métricas de salud en cards + campo programa en wizard de campañas + scope en Reportes/Dashboard + import Excel (R3) + UTM (R26). *Entrega: el programa como unidad viva con salud.*

> Esfuerzo total: **L-XL** (coincide con el doc de mejoras). Cada fase es desplegable y verificable en Chrome de forma independiente.

### Estado de implementación
- **Fase A — ✅ HECHA y verificada en vivo (2026-06-18).** Tablas `connectview-programs` + `connectview-lead-programs` (GSI `byLead`); Lambda `connectview-manage-programs` (Function URL); `ProgramContext` + `ProgramSwitcher` (top-bar) + `ProgramsHubPage` (`/programs`) + nav/breadcrumb/`api.ts`/`amplify_outputs.json`. Provisioning idempotente: `scripts/create-programs.mjs`. **Verificado en Chrome autenticado:** crear programa (`ded261` · Humanidades) → persiste en DDB → transición Borrador→Activo → switcher global scopea (el label del top-bar cambia al programa). Switcher: buscador + "Todos"/"Sin programa" + agrupado por facultad + dot de estado.
  - ⚠️ **Gotcha IAM (clave para futuros Lambdas):** en runtime las llamadas a DynamoDB corren bajo el rol ASUMIDO del tenant **`VoxCrmConnectAccess`** (vía `resolveDynamo`), NO el rol de ejecución del Lambda. Además `connectview-campaign-lambda-role` ya llegó al límite de 10 KB de políticas inline → se usó una **managed policy** `connectview-programs-access` adjunta a AMBOS roles. Un `curl` anónimo da `{programs:[]}` y enmascara el `AccessDenied` → verificar SIEMPRE en el browser autenticado; la propagación STS tarda ~1 min.
- **Fase B — ✅ HECHA y verificada en vivo (2026-06-19).** `manage-leads`: GET `?programId=` (scoped, etapa POR-PROGRAMA vía membership) + `?programId=none` + acciones `assignProgram`/`unassignProgram` + `move` con `programId`. `_shared/leadSync.ts`: `upsertLeadProgramMembership` + `programId` en `propagateLead`/`bulkUpsertVoxLeads` (auto-tag por origen). `LeadsPage`: scopeada por el programa activo (board lee `membership.stageId`), selector "Asignar a programa…" en el toolbar masivo, `programId` en crear-lead/move. **Verificado en Chrome:** "Todos"=36 leads → seleccionar 2 → asignar a "Diplomado en Educación 2026-I" → switch al programa → board muestra solo esos 2 (Yubiry=interesado, Carlos=nuevo); membership persiste en DDB (2 filas). **Solo se redeployó `manage-leads`** — el cambio de `leadSync` es retrocompatible (`programId` opcional); los demás lambdas se redeployan en Fase C cuando pasen `programId`.
- **Fase C — ✅ HECHA (núcleo) y verificada en vivo (2026-06-19).**
  - ① **Programa en el wizard de campañas** + `create-campaign` persiste `programId` y lo pasa a `bulkUpsertVoxLeads` → **auto-tag** de los leads de la campaña (desplegado; campo visible en el wizard).
  - ② **Import de programas por CSV** en el hub (R3) — `manage-programs action:importExcel` + modal. Verificado: importó `nif262`/CCEE + `toefl264`/Idiomas.
  - ③ **Salud (mini-funnel por etapa)** en las cards — el GET de `manage-programs` devuelve `health.byStage`; barra verificada en la card de Diplomado.
  - ④ **`program-tick`** (Lambda + EventBridge rate 1h) auto-archiva programas vencidos (`endDate` pasada y `autoArchive!==false`) — desplegado vía `create-programs.mjs`.
  - **Cerrado (2026-06-19) — follow-ups del Pilar 1:** ⓐ **UTM/código → auto-tag universal (R26):** `resolveProgramIdFromAttributes` en `leadSync` (mapa código→programId, cacheado 5 min) resuelve `utm_campaign`/columna `programa` y auto-taggea desde CUALQUIER fuente (CSV, campaña, **web-form-capture**, **salesforce-inbound-webhook** — los 4 lambdas redeployados). **Verificado:** lead creado solo con `utm_campaign=ded261` → membership al programa Diplomado (sin programId explícito). ⓑ **Default del switcher** arreglado (arranca en "Todos los programas").
  - **Diferido → Pilar 9 (reportes):** scope profundo de Reportes/Dashboard por programa (join contacts→membership) — es trabajo de la capa de reportes, no del modelo de Programa.
  - **Polish de selects — ✅ HECHO (2026-06-19, global).** Causa raíz en `src/components/ui/select.tsx` (Base UI): el panel usaba `w-(--anchor-width)` + `alignItemWithTrigger=true` → quedaba clavado al ancho del trigger y cortaba textos largos ("Diplomado en Edu…", "Basic Chat Discor…"). Fix: `alignItemWithTrigger=false` (dropdown normal debajo del trigger) + `min-w-[max(9rem,var(--anchor-width))] max-w-[min(28rem,…)]` (crece al contenido con tope) + items más cómodos. **Beneficia TODOS los selects de la app** (Programa, Número saliente, Ruteo/Flow…). Verificado: Flow (nombres largos completos) + Programa. Además, el `Select` del wizard ahora muestra "Sin programa" (antes "none") vía función-children en `SelectValue`.
> **🎯 PILAR 1 CERRADO (2026-06-19).** Fases A+B+C + follow-ups (UTM universal, switcher) hechos y verificados en vivo. Único pendiente → Pilar 9 (reportes por programa).

> **Pilar 1 — núcleo COMPLETO (Fases A+B+C).** Programa es un objeto operativo con ciclo de vida, hub con salud, switcher global, membership N:N, scoping de leads y auto-tag desde campañas. Follow-ups: Reportes/Dashboard por programa, UTM, auto-tag web-form/SF.

---

## 8. Decisiones tomadas ✅ (2026-06-18, confirmadas con el usuario)

1. **Grano de Programa:** comercial fino (~56) con campo `faculty` agrupador. *(El roll-up exacto programa↔facultad se afina con los 5 ejemplos que mande el cliente; el modelo ya lo soporta.)*
2. **Membership N:N dedicada** (`connectview-lead-programs`) — confirmado (soporta el cruce 5-10% + etapa por programa + Query scopeado más rápido). Se construye desde la Fase B; en Fase A ya se crea la tabla.
3. **Switcher global single-select + "Todos"** — confirmado. Multi-select solo en el filtro de Reportes (Fase C). *(Refuerzo: Zhenia dijo "quiero ver 1:1, no necesito verlos todos a la par".)*
4. **Construcción aprobada:** se arranca por la **Fase A**.

---

### Archivos que toca (referencia rápida)
- **Backend nuevo:** `amplify/functions/manage-programs/`, `amplify/functions/program-tick/`, tablas `connectview-programs` + `connectview-lead-programs`, `scripts/create-programs.mjs`.
- **Backend editado:** `_shared/leadSync.ts`, `manage-leads/handler.ts`, `create-campaign` + `update-campaign`.
- **Frontend nuevo:** `src/context/ProgramContext.tsx`, `src/components/layout/ProgramSwitcher.tsx`, `src/pages/ProgramsHubPage.tsx`, `src/hooks/usePrograms.ts`.
- **Frontend editado:** `AppLayout.tsx`, `AppTopBar.tsx`, `App.tsx` (ruta), `VoxSidebar.tsx`, `LeadsPage.tsx`, `CampaignsPage.tsx`, `CampaignCreatePage.tsx`, `ReportsPage.tsx` + `ContactFilters.tsx`, `DashboardPage.tsx`, `src/lib/api.ts`, `amplify_outputs.json`.
