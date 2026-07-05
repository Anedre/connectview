# FX Toolkit — React Bits · anime.js · animatedicons.co · AnimatiSS · Spline

Kit de efectos visuales de ARIA. Componentes en `src/components/fx/`,
utilidades CSS `.fx-*` al final de `src/styles/motion.css`. Todo respeta
`prefers-reduced-motion` y nada entra al bundle principal salvo anime.js
(~10 KB gz); Lottie y Spline se cargan lazy en chunks aparte.

## Qué hay y dónde se usa ya

| Herramienta                     | Qué se integró                                                                                                                                            | Uso vivo hoy                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React Bits** (adaptados, MIT) | `BlurText`, `ShinyText`, `SpotlightCard`                                                                                                                  | Saludo del Inicio (BlurText), KPIs del agente en Inicio (SpotlightCard)                                                                            |
| **anime.js v4**                 | `animate()` directo + hook `useStaggerIn`                                                                                                                 | Pop elástico del badge de la campana de notificaciones                                                                                             |
| **animatedicons.co** / Lottie   | `AnimatedIcon` (player Lottie lazy) + `src/assets/anim-icons/`                                                                                            | 10 iconos descargados (useAnimations, CC BY); `notification` vivo en el empty state de la campana                                                  |
| **AnimatiSS** (CSS puro)        | Clases `.fx-float`, `.fx-pop`, `.fx-shake`, `.fx-pulse-ring`, `.fx-shine`, `.fx-gradient-x` + **hover de iconos** `.fx-ico-swing/spin/rock/wiggle/bounce` | Tile del logo (float) y título (gradient-x) del login, badge campana (pop); **hover: campana se menea, sol gira, luna se mece, ayuda hace wiggle** |
| **Spline**                      | `SplineScene` (runtime lazy + IntersectionObserver)                                                                                                       | Slot en el hero del login, gateado por `VITE_SPLINE_LOGIN_SCENE`                                                                                   |

## Recetas

### BlurText — títulos hero

```tsx
<BlurText text={`Hola, ${firstName} 👋`} />
```

### ShinyText — CTAs/badges con destello

```tsx
<ShinyText speed={2.5} baseColor="var(--text-1)">
  Nuevo
</ShinyText>
```

Si el texto YA tiene gradiente propio (clip text), no usar ShinyText:
agregar la clase `fx-gradient-x` al elemento y listo.

### SpotlightCard — halo que sigue al puntero

```tsx
<SpotlightCard color="color-mix(in srgb, var(--cyan) 13%, transparent)">
  <Stat ... />
</SpotlightCard>
```

Es un wrapper con `display:grid`: la card interior no se toca y sigue
siendo clickeable (el glow es `pointer-events: none`).

### anime.js — imperativo, para reaccionar a datos

```tsx
import { animate } from "animejs";
animate(el, {
  keyframes: [{ scale: 1.45 }, { scale: 1 }],
  duration: 480,
  ease: "outElastic(1, .7)",
});
```

Para listas que llegan por fetch (motion.css solo anima el mount de página):

```tsx
const ref = useStaggerIn<HTMLDivElement>(items.length);
<div ref={ref} className="grid">{items.map(…)}</div>
```

### Hover de botones de icono — CSS, sin Lottie

Poné la clase en el BOTÓN; anima su `<svg>` interior al hover. Reutilizable en
cualquier botón con un SVG dentro:

| Clase           | Efecto                           | Buen match              |
| --------------- | -------------------------------- | ----------------------- |
| `fx-ico-swing`  | se menea colgado (pivote arriba) | campana                 |
| `fx-ico-spin`   | gira 360° con rebote             | sol, refresh, sync      |
| `fx-ico-rock`   | se mece lado a lado              | luna                    |
| `fx-ico-wiggle` | sacudida corta                   | ayuda, ajustes, filtros |
| `fx-ico-bounce` | saltito vertical                 | enviar, descargar       |

```tsx
<button className="tb__ico fx-ico-swing">
  <Bell />
</button>
```

Ya aplicado: campana (intrínseco en `NotificationsBell`), sol/luna
(`ThemeToggle`), ayuda (`AppTopBar`).

### AnimatedIcon — Lottie (empty states, éxitos)

```tsx
import notif from "@/assets/anim-icons/notification.json";
// los de useAnimations vienen en negro → tint para adaptarlos a la marca
<AnimatedIcon data={notif} tint="#33BFC8" size={30} autoplay playOnHover={false} />;
```

⚠️ Licencia CC BY: exige atribución a useanimations.com en el proyecto
publicado (ver README de anim-icons).

### SplineScene — 3D

1. Crear la escena en [spline.design](https://spline.design) → Export → Code →
   React → copiar la URL `.splinecode`.
2. Para el login: `VITE_SPLINE_LOGIN_SCENE=https://prod.spline.design/XXXX/scene.splinecode`
   en `.env.local` (y en la config de Amplify Hosting para prod).
3. En cualquier otra pantalla: `<SplineScene scene={url} className="..." />` —
   el contenedor define el tamaño; el runtime (~1.5 MB) solo baja cuando el
   contenedor entra al viewport y nunca con reduced-motion.

## Reglas de uso

- **Opt-in y con criterio**: estos efectos son sal, no plato. Uno-dos por
  pantalla máximo; el sistema base de motion (motion.css) ya cubre entradas
  y hovers.
- Los iconos estáticos siguen siendo Phosphor/Tabler; `AnimatedIcon` es para
  empty states, éxitos y onboarding.
- El wordmark ARIA mantiene su regla propia (`.aria-wordmark`) — no aplicarle
  shine/gradient-x.
- Nada de Spline en vistas de trabajo densas (Inbox, Leads, Agent Desktop):
  reservarlo para login/onboarding/marketing.
