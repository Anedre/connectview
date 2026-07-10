# Auditoría — Traps de layout CSS ("clip por transform + overflow")

**Fecha:** 2026-07-10 · **Detonante:** el conector `.fb-out` del editor de bots se veía como "medio círculo" solo en hover (arreglado en `src/index.css`). Sospecha del usuario: _"ese tipo de errores aparece en todo ARIA"_. Este audit barre esa **clase** de bug (no diseño subjetivo) en todo el front.

**Método:** 4 agentes en paralelo + verificación manual. Cobertura: los 6 archivos CSS (`index.css` ~14.9k líneas, `styles/{aria-base,aria-components,motion,exec}.css`, `aria-cockpit/cockpit.css`) y `src/**/*.tsx` con estilos inline / framer-motion.

---

## TL;DR

|                                                 | Resultado                                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instancias VIVAS del bug transform+overflow** | **0** (fuera del `.fb-node` ya arreglado) — index.css, styles y componentes: limpios                                                                                                                                               |
| **Fragilidad sistémica**                        | **Media (latente)** — nada _enforce_ la regla, pero hoy está mitigada: las clases con transform global **no** llevan `overflow:hidden`, y el patrón badge→wrapper-`relative`-sin-overflow se respeta por convención en toda la app |
| **Primos (otros traps)**                        | `position:fixed` bajo transform de ruta (~16 modales, fragilidad media) · 4 colisiones de clase CSS (confirmadas) · flex/width y comentarios CSS: limpios                                                                          |

**Lectura:** no hay un incendio replicado; el `.fb-out` era el único caso vivo. Pero la **arquitectura de motion hace fácil reintroducirlo**, así que el valor de este audit es sobre todo **preventivo** (ver §4).

---

## 1. El mecanismo (recordatorio)

Un contenedor con `overflow:hidden` **recorta** a sus hijos `position:absolute` **solo cuando el contenedor tiene un `transform`**. Motivo: un `transform` (no-`none`) convierte al elemento en el _bloque contenedor_ de sus descendientes absolutos; recién entonces el `overflow` los alcanza. Sin transform, el bloque contenedor es un ancestro de más arriba y el hijo **escapa** al recorte.

Lo insidioso: si el `transform` es **condicional** (`:hover`, `.selected`, animación de entrada), el hijo se ve **completo en reposo** y **recortado** solo en ese estado → bug intermitente que casi nadie nota. Es exactamente lo que pasó con `.fb-node:hover { transform: translateY(-1px) }` recortando al conector `.fb-out` (que va `translate(50%,-50%)` = mitad afuera del borde).

> También aplica a `box-shadow` y `::before/::after` que se extienden más allá del borde: `overflow:hidden` los recorta igual.

---

## 2. Instancias vivas del bug: **ninguna**

- **`src/index.css`** (98 `overflow:hidden`): 0. Todos los contenedores que adquieren `transform` no tienen hijos que sobresalgan, o sus hijos salientes cuelgan de un contenedor **sin** `overflow:hidden`. Único apunte fuera de clase: `.gcal-evpop__menu` (`src/index.css:3265`) se recorta por overflow normal (no por transform); confianza baja de que moleste.
- **`src/styles/*.css`** (36 `overflow:hidden`): 0. Todo elemento con `overflow:hidden`+transform propio es además `position:relative/absolute/fixed` (ya es bloque contenedor → recorta siempre, no intermitente) y sus únicos hijos absolutos son glows/barras a ras (`inset:0`, `left:0`) recortados **a propósito** para respetar el `border-radius`.
- **Componentes `.tsx`**: 0 casos vivos. Los hijos con offset negativo que sobresalen viven en tooltips, chevrons de `select`, marcadores de waveform y el widget flotante — ninguno dentro de una tarjeta clipada con transform. Se verificaron a mano las zonas que concentran los 3 ingredientes (`StepNode`, `FloatingCallWidget`, `NotificationsBell`, `ActiveContactsTabStrip`, `ConversationList/Thread`, `CTabs`, `ChatQueueAlert`, `AgentActionsDialog`, `WaveformTimeline`, `JourneyBuilder`, y los 3 archivos con framer-motion). **El patrón badge/dot repetido en toda la app cuelga el hijo de un wrapper `position:relative` SIN overflow** → seguro por diseño.
  - _Cobertura:_ barrido completo — 105 componentes de `admin/campaigns/reports/recordings/leads/dashboard/ui/aria/automations/bots` + `workspace/inbox/vox/queue/layout` + los 3 con framer-motion. 0 candidatos. Cada `overflow:hidden` sirve a un propósito legítimo (barra de acento inset, overlay `inset:0`, redondeo, `text-overflow`, clip de imagen, track de toggle).

---

## 3. Fragilidad sistémica (los vectores que hacen fácil reintroducirlo)

**Hallazgo raíz (por qué hoy está contenido):** las clases que reciben transform global —`.card` (`aria-base.css:236`/`index.css:4491`), `.chip`/`.pill` (`aria-base.css:246`), `.btn`/`.btn--*` (`aria-base.css:210+`)— **no declaran `overflow:hidden`**. Por lo tanto el transform-en-hover global **no puede recortar nada** a menos que alguien añada `overflow:hidden` en el MISMO nodo (inline o utilidad Tailwind). Esa combinación no existe hoy. El riesgo es real pero requiere un gatillo específico.

Hay **tres fuentes de `transform`** que aplican a muchísimos elementos:

1. **Hover global** (`src/styles/motion.css:69-137`): `.card`, `button.card`, `a.card`, `.card--tap`, `.chip`, `.pill`, `.btn--primary/success/danger`, `.btn--icon` reciben `transform: translateY(-1/-2px)` en `:hover`. El bug aparece solo si a un elemento con esas clases se le agrega **`overflow:hidden`** (p. ej. `overflow-hidden` de Tailwind) **+** un hijo que sobresalga. Gatillo poco común, pero nada lo impide.
2. **Entrada de página** (`src/styles/motion.css:29-49`): `.page > *` anima `aria-rise` (translateY) con `fill:backwards`. Durante ~0.44s por navegación, **todo bloque de primer nivel de una página** tiene `transform` no-`none` → se vuelve bloque contenedor → su `overflow:hidden` recorta hijos salientes. Transitorio (una vez por navegación), no intermitente por hover, pero real.
3. **Tarjetas "a un edit del bug"**: `.stat` (`aria-base.css:286`), `.exec-stat` (`exec.css:544`), `.exec-ins` (`exec.css:1128`) ya combinan `overflow:hidden` + hover-transform. El día que alguien les agregue un **badge de notificación, dot de esquina, anillo por box-shadow o tooltip** que sobresalga, quedará recortado — y por ser `position:relative`, recortado **siempre** (Tipo 2), no solo en hover.

Legacy sin uso (no aplican en ningún `.tsx`, ignorables): `.insight`, `.heromet`.

---

## 4. Prevención (evitar "ese tipo de errores" a futuro)

**Regla de oro:** _un elemento que debe sobresalir del borde de su tarjeta (conector, badge, anillo, tooltip, dot) NO debe ser descendiente de un `overflow:hidden`._ Si necesitas ambos:

- **Opción A (preferida):** poné el `overflow:hidden` en un **wrapper interno** (que envuelva riel/header/cuerpo) y dejá el hijo saliente como hijo directo del contenedor **no** clipado. Así el clip redondea las esquinas pero no toca al hijo.
- **Opción B:** no le pongas `transform` (hover/entrada/animación) al mismo elemento que tiene `overflow:hidden` + hijo saliente. El realce podés darlo con `box-shadow` (como se hizo en `.fb-node`).
- **Opción C:** colgá el hijo saliente de un ancestro sin `overflow:hidden` (o renderízalo en portal si es un popover).

**Checklist de review (agregar a la guía de front):** antes de mergear una tarjeta nueva, si tiene `overflow:hidden` preguntá: ¿recibe transform por hover/entrada/clase global (`card/chip/pill/btn--*`)? ¿tiene algún hijo con `translate(50%)`, offset negativo, box-shadow grande o pseudo que se salga? Si ambas → aplicá A/B/C.

**Guardrail automatizado (opcional, propuesto):** una regla de lint que marque selectores con `overflow:hidden` **y** `transform` a la vez, con opt-out por comentario (`/* clip-ok */`) para los glows intencionales. Hoy el CI es `tsc → eslint → vitest → build` (sin stylelint); esto sumaría stylelint. Lo dejo como follow-up a decidir.

> Memoria del proyecto actualizada: `reference_flowbuilder_connector` (gotcha del conector) enlaza a `reference_fixed_vs_route_transform` — ambos son la misma familia "transform crea bloque contenedor".

---

## 5. Primos encontrados (traps relacionados, cleanups aparte)

### 5.1 `position:fixed` bajo el `<motion.div>` de rutas — ✅ RESUELTO EN LA RAÍZ

**Fix aplicado (2026-07-10):** la transición de ruta en `src/App.tsx` (`AnimatedRoutes`) pasó a **opacity pura** (antes `y: 8→0→-8`). Sin transform en el wrapper, deja de ser bloque contenedor de sus `position:fixed` descendientes → los ~16 overlays quedan anclados al viewport **sin editar cada archivo**, y ningún modal futuro reintroduce el bug. Costo: el slide vertical de 8px pasó a un fade limpio (la entrada escalonada `.page > *` sigue dando motion). Portalizar caso por caso habría sido churn desproporcionado para una fragilidad que solo aparece durante los ~0.2s de transición.

Contexto original del hallazgo: `AnimatedRoutes` envolvía **todas** las rutas en un `<motion.div>` con animación de entrada/salida (translateY = transform). Un `position:fixed` dentro de una vista de ruta se anclaba a ese wrapper, no al viewport. En framer-motion v12 el wrapper queda en `transform:none` en reposo (lo enmascara), pero se dispara durante la transición de ruta (~200ms) o con `will-change` residual. **Precedente ya documentado** en el repo (full-bleed fixed roto dentro del motion.div).

~16 overlays/modales usan `position:fixed; inset:0` **inline sin portal**, montados bajo ruta. El primitivo `Modal` (`src/components/ui/modal.tsx`) sí usa portal (base-ui) y **escapa** — la recomendación es migrarlos a ese primitivo o envolverlos en `createPortal(…, document.body)`. Mayor impacto: **`ConnectSetupWizard.tsx:399`** (full-bleed). Otros: `ContactDetailModal.tsx:148`, `ScheduleCallbackModal.tsx:351`, `QuickNoteModal.tsx:121`, `LiveSummaryModal.tsx:102`, `WhatsAppQuickSendModal.tsx:156`, `EditProfileModal.tsx:313`, `PreviousChatsDrawer.tsx:40/50`, `ConversationThread.tsx:963/577`, `LeadsPage.tsx:1460`, `ProgramsHubPage.tsx:704`, `FeatureCompare.tsx:223`, `TeamManager.tsx:113/242/650`, `IntegrationsManager.tsx:2983`, `WhatsAppTemplatesManager.tsx:2184`, `ConnectUserRoleModal.tsx:82`. (Verificados **fuera** del transform y OK: `IncomingCallOverlay`, `FloatingCallWidget`, `MonitorControlBar`, `CopilotPanel`, `TasksLauncher`, etc.)

### 5.2 Colisiones de clase genérica entre archivos CSS — confirmadas

Orden de carga (`src/main.tsx`): `index.css` → `aria-base.css` → `aria-components.css` → `motion.css`. Lo posterior pisa lo anterior de forma **no-local**:

| Clase         | index.css                               | aria-base.css (gana)                    | Efecto                                                                                                                                                      |
| ------------- | --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.muted`      | `--text-3` (`:5020`)                    | `--text-2` (`:201`)                     | El `.muted` real es `--text-2`; el `--text-3` de index es código muerto (aria-base ya tiene `.dim` para `--text-3`). **Fix:** borrar `.muted` de index.css. |
| `.bar`        | `height:6px` (`:7626`), hijo `.bar>div` | `height:8px` (`:297`), hijo `.bar>span` | La barra mide 8px, no 6; nombre muy genérico. **Fix:** renombrar la de index a `.pbar`/`.progress-bar`.                                                     |
| `.card`       | `--radius-3`/`--shadow-card` (`:4491`)  | `--r-lg`/`--sh-1` (`:236`)              | Tokens de la card de index muertos; tocar `--shadow-card` no cambia nada. **Fix:** dedup hacia aria-base (el comentario en `:4489` ya lo insinúa).          |
| `.row`/`.col` | `+gap:8px` (`:5023/5028`)               | sin gap (`:193/194`)                    | No destructivo (el gap sobrevive), pero fuerza gap global desde dos fuentes. **Fix:** unificar en aria-base.                                                |

### 5.3 Limpios

- **flex-basis pisa width:** sin hallazgos (todo `flex:1;min-width:0` o `flex:0 0 Npx`+width consistentes; el fix del sidebar ya está en `aria-components.css:14-19`).
- **Comentarios CSS malformados (`*/` de más):** sin hallazgos (balance `/* */` sano en los 6 archivos).

---

## 6. Acciones recomendadas (priorizadas)

1. **Adoptar la regla de oro §4** (doc + checklist de review) — el verdadero "evitar a futuro". _(sin código)_
2. **Blindar las 3 tarjetas "a un edit del bug"** (§3.3) o al menos anotarlas, para que un badge futuro no las recorte. _(bajo esfuerzo)_
3. **Colisiones de clase §5.2** — dedup de `.muted`/`.card`, renombrar `.bar`. Bajo riesgo, alto valor de higiene. _(bajo esfuerzo)_
4. ~~Modales `position:fixed`~~ — ✅ **HECHO** vía fix de raíz (transición de ruta opacity-only en `App.tsx`); resuelve los ~16 de una y previene futuros. Portalizar caso por caso quedó innecesario.
5. ~~Guardrail de lint~~ — ✅ **HECHO**: `scripts/check-clip-traps.mjs` + `npm run css:traps` wired al CI (`.github/workflows/ci.yml`), sin dependencia nueva (más liviano que stylelint).
