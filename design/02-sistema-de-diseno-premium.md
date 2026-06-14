# 02 · Sistema de diseño premium (el brief)

> Esta es la **fuente de verdad**. Todo diseño nuevo o rediseñado debe respetarla.
> Si una decisión no está aquí, se deriva de los **7 principios**.

---

## North-star

ARIA es una **consola de operaciones para contact centers** — densa en datos pero respirable,
oscura por defecto, rápida bajo presión. La meta estética: que se sienta de la familia de
**Linear, Vercel y Stripe**, no de un panel de Bootstrap.

**Referencias y qué tomar de cada una:**
- **Linear** → densidad con aire, foco de teclado impecable, command palette, motion sutil con propósito.
- **Vercel** → claridad, dark deep-black neutro, jerarquía tipográfica limpia.
- **Stripe** → formularios y estados de confianza, jerarquía editorial, microcopy preciso.
- **Attio / Pipedrive** → tarjetas de CRM ricas (owner, tags, próxima acción).
- **Intercom** → bandeja omnicanal unificada (una sola conversación, varios canales).

**Lo que YA es nuestro y hay que proteger:** el dark deep-black (`#0A0A0B`, sin tinte azul),
el acento **ámbar** como firma, la fuente **Geist**, los números tabulares, y el lenguaje
"operations console" (rails de acento, KPIs densos, severidad operativa).

---

## Los 7 principios

1. **Una sola familia, obsesivamente.** El mismo concepto se pinta igual en todas las pantallas.
   Un "contacto", un "agente", un "KPI", una "tabla" tienen **un** componente, no cinco.
2. **Dark-first deep-black; el ámbar es el único acento de acción.** Los demás acentos
   (cyan/green/red/violet/pink) son **semánticos** (estado, canal, severidad), no decorativos.
   Si todo es acento, nada lo es.
3. **Densidad con aire.** Mucha información, pero con ritmo vertical y jerarquía claros.
   Tabular-nums siempre que haya números que cambian.
4. **Los datos son ciudadanos de primera.** Un solo motor de charts, una sola paleta de datos
   derivada de la marca, ejes/tooltips/animaciones uniformes.
5. **Accesible bajo presión.** Foco de teclado visible siempre; eventos en vivo anunciados
   (`aria-live`); severidad nunca solo por color; targets ≥ 40px.
6. **Motion con propósito.** La animación comunica estado o continuidad, no adorna. Siempre
   respeta `prefers-reduced-motion`.
7. **Todos los estados, siempre.** Cada superficie diseña empty / loading (skeleton) / error
   (recuperable) / success — y los de dominio (stale, buffering, hold…).

---

## Tokens

### Tokens actuales (mantener — ya están bien) · `src/index.css:35-117`

```css
/* Superficies (dark, default) — deep-black neutro, sin tinte azul */
--bg-0:#0A0A0B; --bg-1:#101011; --bg-2:#161617; --bg-3:#1E1E20;
--bg-hover:#1C1C1E; --bg-active:#232325;
--border-1:#242426; --border-2:#2E2E31; --border-strong:#3A3A3E;

/* Texto */
--text-1:#F2F2F3; --text-2:#A8A8AD; --text-3:#6E6E76; --text-4:#48484E;

/* Acentos (cada uno con su variante -soft) */
--accent-amber:#F5A524;  /* PRIMARIO — acción */
--accent-cyan:#2BC6E6; --accent-green:#25B873; --accent-red:#ED5257;
--accent-violet:#9B8CF0; --accent-pink:#ED84C2;

/* Sombras, radios, tipografía, dimensiones de layout */
--shadow-card; --shadow-pop; --shadow-call;
--radius-1:4px; --radius-2:6px; --radius-3:8px; --radius-4:12px;
--font-ui:'Geist Variable'…; --font-mono:'Geist Mono'…;
--header-h:52px; --sidebar-w:232px; --rightrail-w:320px; --calldock-h:88px;
```
El `light` theme existe (`[data-theme="light"]`) y el `@theme inline` (`index.css:12-33`) ya
**puentea los tokens shadcn** (`--color-card:var(--bg-1)`, `--color-primary:var(--accent-amber)`,
`--color-ring:var(--accent-amber)`…). **No tocar este puente** — es lo que hace que los
primitivos shadcn hereden la marca.

### Tokens NUEVOS a añadir (cierran los gaps P2, P7, P9, P12)

```css
:root {
  /* ── Foco (P2) ── un solo anillo, tokenizado ── */
  --ring: var(--accent-amber);
  --ring-offset: var(--bg-0);
  /* uso: *:focus-visible { outline:2px solid var(--ring); outline-offset:2px } */

  /* ── Scrim de overlays (unifica 3 recetas de modal) ── */
  --scrim: rgba(8,10,16,0.6);
  --shadow-modal: 0 24px 64px -16px rgba(0,0,0,0.7), 0 0 0 1px var(--border-1);

  /* ── Escala tipográfica (P9) — mata los 9.5/10.5/11.5/12.5 mágicos ── */
  --text-2xs:10px; --text-xs:11px; --text-sm:12.5px; --text-base:13.5px;
  --text-md:15px;  --text-lg:18px; --text-xl:22px;   --text-2xl:28px; --text-3xl:34px;
  --leading-tight:1.2; --leading-normal:1.45;
  --weight-regular:400; --weight-medium:500; --weight-semibold:600; --weight-bold:700;

  /* ── Espaciado (P9) — escala de 4px ── */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  --space-5:20px; --space-6:24px; --space-8:32px; --space-10:40px; --space-12:48px;

  /* ── Z-index (P9) — mata 20/50/60/200 mágicos ── */
  --z-base:0; --z-sticky:10; --z-dropdown:30; --z-overlay:40;
  --z-modal:50; --z-toast:60; --z-max:9999;

  /* ── Paleta de DATOS (P7) — fuente única para charts, derivada de la marca ── */
  --data-1:var(--accent-amber);  --data-2:var(--accent-cyan);
  --data-3:var(--accent-green);  --data-4:var(--accent-violet);
  --data-5:var(--accent-pink);   --data-6:var(--accent-red);
  --data-7:#6E8BFF;              --data-8:#E0A458; /* extensiones armónicas */

  /* ── Color de CANAL (P7) — unifica las 2-3 taxonomías contradictorias ── */
  --ch-voice:var(--accent-cyan);    --ch-chat:var(--accent-violet);
  --ch-whatsapp:var(--brand-whatsapp); --ch-email:var(--accent-amber);
  --ch-sms:var(--accent-pink);      --ch-task:var(--accent-green);

  /* ── SEVERIDAD (P2 — no solo color: cada uno lleva forma+icono asociado) ── */
  --sev-ok:var(--accent-green);    /* ● círculo / Check */
  --sev-info:var(--accent-cyan);   /* ● círculo / Info  */
  --sev-warn:var(--accent-amber);  /* ◆ rombo  / Triangle */
  --sev-crit:var(--accent-red);    /* ▲ triángulo / Alert */

  /* ── Marca de terceros (sacar los hex mágicos repetidos) ── */
  --brand-whatsapp:#25D366; --brand-salesforce:#00A1E0; --brand-connect:#FF9900;
}
```

> **Light theme:** la paleta de datos y de canal debe tener su variante en `[data-theme="light"]`
> (hoy `EChart.tsx` adapta texto/borde pero deja la paleta constante → contraste dudoso en claro).

---

## Paletas — reglas de uso

| Uso | Token | NO usar |
|---|---|---|
| Acción primaria (CTA, activo) | `--accent-amber` | cualquier otro acento como "primario" |
| Series de datos en charts | `--data-1…8` (en orden) | hex hardcodeados (`#15485A`, `#22c55e`) |
| Color por canal | `--ch-*` | `sky/emerald/violet` crudos; dos taxonomías |
| Severidad / estado | `--sev-*` **+ forma + icono + texto** | solo color |
| Logos de integración | `--brand-*` | `#25D366`/`#00A1E0`/`#FF9900` repetidos inline |
| Superficies / texto / bordes | `--bg-*` / `--text-*` / `--border-*` | `bg-emerald-100`, `text-rose-600`, `bg-card` directo en dominio |

---

## Tipografía

- **Familia:** Geist Variable (UI) + Geist Mono (números/código/IDs).
- **Escala:** usar los tokens `--text-*` (arriba). Prohibido `font-size:12.5px` inline o `text-[10px]`.
- **Números que cambian** (timers, KPIs, contadores, SLA): **siempre** `font-variant-numeric: tabular-nums`.
- **Jerarquía de página** (sugerida): título de vista `--text-2xl/semibold`; sección `--text-md/semibold`;
  cuerpo `--text-base`; meta/caption `--text-sm`/`--text-xs` en `--text-3`; eyebrow/label uppercase `--text-2xs`,
  `letter-spacing:0.06em`, `--text-3`.

---

## Catálogo de primitivos canónicos

> Construirlos es la Fase 0–2. Cada uno **reemplaza** N implementaciones ad-hoc. El número entre
> paréntesis es a cuántas variantes duplicadas sustituye.

### Base / interacción
- **`<Button variant size>`** — extender el shadcn existente (ya tiene focus-visible). Variantes:
  `primary` (ámbar) · `secondary` · `ghost` · `outline` · `destructive` · `link`.
- **`<IconButton aria-label>`** *(reemplaza `.tb__iconbtn`, `.btn--icon`, `Icon.Close onClick`)* —
  hit-area **≥40px**, `aria-label` **obligatorio**, focus ring. Nunca un SVG con `onClick` suelto.
- **`<SegmentedControl role="radiogroup">`** (×3: `.dash-seg`, `.chart-toggle`, `.mon-seg`).
- **`<Toggle>` / `<Switch>`** — un solo estilo (hoy `.mon-auto` y otros divergen).

### Formularios (cierra P4 en admin)
- **`<FormField label hint error>`** *(×6 `inputStyle`/`labelStyle` duplicados)* — label **real**
  asociado (nunca placeholder-as-label), `hint`, **error inline** con `aria-invalid` +
  `aria-describedby`. Tokens `--input-*`.
- **`<Input> <Textarea> <Select> <Combobox> <Typeahead>`** — sobre base-ui; `<Typeahead>` extrae el
  autocompletar de `AppointmentsPage` (lo necesitarán leads/campañas).
- **`<Stepper>`** — barra de pasos del wizard, reutilizable (campaña, Connect setup).

### Superposiciones (cierra P3)
- **`<Modal>`** *(×3 recetas)* — `role="dialog"`, `aria-modal`, focus-trap, restore-focus, cierre
  por `Esc`/overlay, `--scrim`, `--shadow-modal`, radius `--radius-4`.
- **`<ConfirmDialog>`** *(×16 `confirm()` nativos)* — destructiva con variante de peligro + opción
  "deshacer" vía toast.
- **`<Popover>`** *(reemplaza menús con `position:absolute` y números mágicos)* — base-ui con flip.
- **`<Sheet/Drawer>`** — para right-rail/inspector colapsables en responsive.

### Datos y estado
- **`<DataTable>`** *(×3+ tablas)* — sticky header, sort, densidad configurable, zebra/hover,
  tabular-nums, **slots empty/loading/error**.
- **`<KpiTile value sub trend sparkline tone to>`** *(×5: `Kpi`, `StatCard`, `KPICard`, `.kpi-band`,
  `.mon-kpi`)* — número tabular, delta con icono+color semántico, sparkline opcional, meta opcional,
  drill-down con filtro.
- **`<Sparkline>`** (×2).
- **`<StatusDot status withLabel>`** y **`<SeverityBadge sev>`** *(×6 `STATUS_PILL`/`statusColor`/
  `tone`)* — **forma + color + texto** (resuelve daltonismo).
- **`<ChannelBadge channel>`** + `CHANNEL_TOKENS` *(×4 taxonomías)* — icono+color+label por canal.
- **`<Avatar name status>`** *(×3-4)* — color determinístico por nombre, anillo de presencia.
- **`<EmptyState icon title body cta>`** y **`<ErrorState retry>`** *(×N improvisados)*.
- **`<Skeleton>`** — ya existe; **usarlo de verdad** (hoy gana "Cargando…" en texto).
- **`<FreshnessPill lastRefresh stale>`** — `live` / `stale` / `disconnected` con `aria-live`
  (no existe; es el componente más necesario en pantallas en vivo).

### Visualización (cierra P6, P7)
- **`<Chart>`** — wrapper único sobre **ECharts** con `chartTheme` derivado de `--data-*`/tokens,
  tooltip/leyenda/ejes estándar, `role="img"`+`aria-label`, y empty/loading integrados. Migrar
  recharts y los SVG-a-mano a esto.

### Dominio (alto valor)
- **`<ContactCard variant="lead|live-bubble|feed">`** — una sola tarjeta de contacto/lead
  parametrizable (hoy `LeadCard` ≠ `ContactBubble` ≠ feed). Para `lead`: avatar de owner, tags de
  color, **próxima acción**, valor, días-en-etapa.
- **`<MessageBubble role channel>` + `<ConversationCanvas>`** — un solo renderer de burbujas
  (regla fija: **cliente a la izquierda, agente a la derecha**) que unifica WhatsApp/chat/transcript
  (hoy con alineación **invertida** entre vistas) + `DaySeparator`/`SystemPill`/`AttachmentBubble`.
- **`<AttachmentRenderer variant="bubble|grid|chip">`** (×4 implementaciones de adjuntos).
- **`<AudioPlayer>`** accesible con **waveform** + marcadores de sentiment; scrubber `role="slider"`
  con teclado; velocidad/volumen/descarga; estados buffering/error/ended.
- **`<Transcript>`** sincronizado: click-en-línea hace seek, auto-scroll al segmento activo,
  búsqueda. (Reusar las clases `.transcript*` ya existentes en `index.css:2154-2177`.)
- **`<CallDuration startedAtMs>`** *(×3 relojes desincronizados)* — un solo reloj wall-clock.
- **`<CallDock>`** — barra de control de llamada **única** para `/agent` y flotante (usa el token
  `--calldock-h:88px` ya definido). Mata la divergencia `FloatingCallWidget` vs hero.
- **`<DateRangePicker>`** — presets (7/30/90d) + custom + comparación; control único de rango.
- **`<FilterChipBar>`** — el `LeadFilterBar` (chip+popover+count) ya está muy bien; extraerlo.
- **`<BrandLockup size>`** *(×5 + fija marca ARIA)* — logo + "ARIA" + tag, usado en sidebar/login/loading.
- **`<FloatingLayer slot>`** — gestor de anclaje/z-index para Copilot, call widget, monitor bar, toasts
  (hoy compiten por la esquina inferior-derecha).

---

## Reglas / anti-patrones (banear por lint o revisión)

| ❌ No hacer | ✅ Hacer |
|---|---|
| `bg-emerald-100`, `from-sky-400`, `text-rose-600` (Tailwind crudo con número) | `var(--accent-*)`, `--data-*`, `--ch-*`, `--sev-*` |
| `#22c55e`, `rgba(99,102,241,…)` hex/rgba inline | tokens (o `--brand-*` para logos de terceros) |
| Emoji como icono (💬📎✅⚠️) | `lucide-react` con color de token |
| `window.confirm()` / `alert()` | `<ConfirmDialog>` |
| `font-size:12.5px` / `text-[10px]` | tokens `--text-*` |
| `z-index:200` mágico | tokens `--z-*` |
| `placeholder="Email"` como única etiqueta | `<FormField label="Email">` |
| `<div onClick>` como botón/nav | `<button>` / `role`+`tabIndex`+teclado |
| `outline:none` sin reemplazo | `:focus-visible` con `--ring` |
| overlay manual sin focus-trap | `<Modal>` |
| "Cargando…" en texto | `<Skeleton>` |
| Texto "AIRA" / "Vox" visible | "ARIA" (`<BrandLockup>`) |
| Inglés suelto en UI ("Sentiment Trend", "skipped") | español neutro consistente |
| `recharts` + ECharts + SVG a mano | un solo `<Chart>` (ECharts) |
| 5 KPIs / 4 tarjetas de agente distintas | el primitivo canónico |

---

## Motion

- **Curva estándar:** `cubic-bezier(0.2, 0.7, 0.2, 1)` (ya usada en varios sitios) · duraciones
  120–240ms para UI, 300–600ms para entradas/charts.
- **Entradas:** stagger sutil de listas/cards (Linear-style). Una sola convención (hoy unas
  animan, otras no).
- **Estado:** transiciones de estado de llamada (ringing→connected→hold→wrap-up) con morph del
  avatar/ring; charts con animación de entrada uniforme.
- **Consolidar keyframes** (`spin`, `pulse`, `ping`, `monitor-pulse`) en `index.css` una sola vez
  (hoy duplicados inline por componente).
- **`prefers-reduced-motion`:** cobertura **global** — desactivar pulsos/pings/spring/equalizer,
  no solo `.lead-card-anim`.

---

## Accesibilidad (objetivo WCAG 2.1 AA)

Checklist que todo diseño nuevo debe cumplir:

- [ ] **Foco visible** en todo control (`:focus-visible` con `--ring`).
- [ ] **Operable por teclado** (nada solo-mouse; drag&drop con alternativa: menú "mover a…").
- [ ] **`aria-live`** para eventos en vivo (llamada entrante, breach SLA, mensaje nuevo, refresh).
- [ ] **Severidad redundante** (forma + icono + texto, no solo color) → daltonismo.
- [ ] **Targets ≥ 40px** de hit-area (el brief lo pide; WCAG 2.5.8 exige ≥24px).
- [ ] **Nombre accesible** en icon-buttons (`aria-label`, no solo `title`).
- [ ] **Contraste AA** (4.5:1 texto normal, 3:1 grande) — verificar especialmente la paleta de
      datos sobre `--bg-1/2` y en light theme.
- [ ] **Modales** con `role="dialog"`, `aria-modal`, focus-trap, `Esc`, restore-focus.
- [ ] **Formularios** con label asociado, `aria-invalid`, error en `aria-describedby`.
- [ ] **`prefers-reduced-motion`** respetado.

---

## Dark / Light

- **Dark es el default y la identidad.** El deep-black neutro (`#0A0A0B`, sin azul) es firma —
  protegerlo.
- **Light theme existe** pero hay deuda: `LoginScreen`/`ErrorScreen`/`NotFound` y la sección
  `vox-auth/vox-login` fuerzan paleta clara hardcodeada (`--auth-*`, `index.css:2253-3160`), y la
  paleta de datos no tiene variante light. Para un light theme de verdad: derivar **todo** de
  tokens (sin `--auth-*` paralelos) y añadir `--data-*`/`--ch-*` en `[data-theme="light"]`.
- **Selector de tema:** exponer los **3 estados** que el `ThemeContext` ya soporta
  (`light`/`dark`/`system`) — hoy los toggles solo alternan light↔dark.
