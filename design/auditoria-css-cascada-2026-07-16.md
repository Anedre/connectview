# Auditoría de cascada CSS — 2026-07-16

Disparada por el bug del **marco dorado** al enfocar el compositor ([[reference_ring_token_trap]]). Pregunta: _¿hay más errores de ese tipo?_ Sí. Este doc separa lo **arreglado**, lo **deliberado** (no tocar) y lo **pendiente de decisión**.

## El patrón

`main.tsx` importa: **index.css → aria-base.css → aria-components.css → motion.css**. aria-\* es el **re-skin ARIA** montado sobre el CSS viejo de Vox/Connectview, y **gana a propósito** cuando empata (así está documentado en `main.tsx:12-13`). El bug aparece cuando ese "gana el último" es **accidental**: mismo nombre, dos autores, intenciones distintas.

Tres sabores:

1. **Token con dos significados** → una de las dos reglas queda inválida y el navegador la descarta en silencio (`--ring`: sombra vs color).
2. **Empate (0,1,0) con valores distintos** → el resultado cambia si cambia el orden de carga (dev vs build).
3. **Selectores distintos que no se pisan** → ambas reglas pintan (doble riel del timeline).

## ✅ Arreglado (commits 0737b80 · 67f50c0 · fbf9bd0)

| Qué                                                  | Dónde                       | Efecto                                                   |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `--ring` sombra vs color                             | index.css / aria-base.css   | marco dorado; dev ≠ build                                |
| Foco de **todo campo** en ámbar                      | index.css:178               | **origen real** del marco dorado al escribir             |
| `.btn:focus-visible` ámbar                           | index.css:5034              | dorado en todos los botones (confirmado con Tab real)    |
| `.vox-field`, `.wa-tmpl`, `.arb-inspect`             | index.css                   | borde/halo dorados                                       |
| `border-radius` en las 2 reglas de foco (9px vs 6px) | aria-base:273 / index:13932 | empate + **deformaba los `.chip` píldora** al enfocarlos |
| Doble riel del timeline                              | index.css `.tl::before`     | dos líneas a 4px (`.tl__item::before` ya lo dibuja)      |

**Verificación:** auditor de tokens (`scratchpad/audit-tokens2.mjs`) → resuelve alias y compara el TIPO final por archivo. **0 de 225 tokens** con tipos incompatibles tras el fix.

## 🟡 Deliberado — NO tocar

- **aria-base.css:894+** — capa de alias documentada (`--accent-amber: var(--gold)`, `--radius-1: var(--r-xs)`, `--shadow-card: var(--sh-1)`): mapea los tokens viejos a la paleta ARIA. Gana por diseño.
- **`.btn` / `.sb__*` / `.av` / `.tb__status` / `.card__*`** — aria-\* pisa a index.css: **es el re-skin**. Que `.btn` sea 38px (aria) y no 32px (index) es lo esperado.
- **`.amplify-*:focus` → rosa** — identidad propia del login.
- **`.cdet-tile` / `.inc-btn` / `.vox-start__card` / `.wf-input`** — usan el color del propio componente (`--_c`, `--inc-c`, `--vsa`, `--wf-c`).
- **~85% de los `!important`** de index.css sobreescriben `@aws-amplify/ui-react` y Radix/shadcn. Legítimo.

## 🔴 Pendiente — necesita DECISIÓN (no lo toqué)

1. **Tema muerto de `.hg`** (Grabaciones). `index.css:12846` abre un `:root` para tematizar `.hg` con `--r-sm: 8px` y `--sh-1..4` propios, pero **aria-base.css:72-82 los pisa** → `.hg` se pinta con los radios/sombras de ARIA, nunca con los suyos. ~32 `var()` consumen valores que su autor nunca fijó. _Impacto visual bajo_ (8px vs 9px), pero es código muerto engañoso. Decisión: ¿scopear esos tokens bajo `.hg { … }` (revive el tema) o borrarlos (asumir ARIA)?

2. **`.app`: `display:grid` (index:207) vs `display:flex` (aria-components:6)**. Gana flex; las `grid-template-*` quedan **inertes pero vivas** — si el orden cambiara, el shell de la app se reconfiguraría entero. `.app__sidebar` (index:220) ya es **código muerto** (el sidebar real es `.sb`). Decisión: borrar las reglas grid muertas.

3. **`.btn--primary`: el borde ámbar en degradado nunca renderiza** — `aria-base.css:379 .btn { border: 1px solid transparent }` (shorthand) resetea el `border-color` del modificador `.btn--primary` (index:5036), y `aria-base:415` reemplaza su gradiente por `background: var(--accent)` plano. Puede ser intencional (el re-skin quiere botones planos) o un descuido. Decisión de diseño.

4. **`.btn--ghost` invertido**: index (transparente) vs aria-base:427 (sólido con borde y sombra) — **los 4 valores opuestos**. Hoy los ghost salen sólidos. ¿Es lo que se quiere?

5. **Orden de carga frágil**: `main.tsx:7` importa `App` **antes** que `index.css` (línea 11), así que `exec.css` y `@aws-amplify/ui-react/styles.css` entran por el árbol de `App` **antes** que index.css — al revés de lo que dice el comentario de `main.tsx:12-13`. Hoy no muerde (exec.css scopea todo bajo `.exec` con prefijo `--e-`), pero el contrato es ilusorio. Arreglo real: `@layer` (base → componentes → utilidades) en vez de depender del orden.

6. **Riesgos de shorthand latentes** (hoy pierden, catastróficos si el orden cambia): `index.css:547 .sb__item { font: inherit }` borraría toda la tipografía del sidebar; `index.css:518 .sb__nav { overflow: auto }` reactivaría el scroll horizontal.

## Recomendación

Lo urgente y visible está arreglado. Lo de fondo es que **el sistema depende del orden de carga en vez de declararlo**: mover a `@layer` mataría la clase entera de bug (los empates dejarían de depender del orden). Es un cambio acotado (3 `@layer` + envolver los archivos) pero toca todo → merece su propia sesión con verificación visual página por página.

## Revisión de los pendientes (2026-07-16)

Al evaluarlos para acción:

- **Los 4 "pendientes de decisión" (1-4) son residuo del re-skin ARIA, NO bugs visibles.** El tema muerto de `.hg`, el grid muerto de `.app`/`.app__*`, el borde ámbar de `.btn--primary` y el `.btn--ghost` "invertido" son todos CSS viejo de Vox que el re-skin ARIA (aria-base/aria-components) pisa a propósito. Lo que se RENDERIZA hoy es el look ARIA que el usuario aprobó en toda la sesión — plano/navy sobrio, no gradiente. Cambiar los botones a gradiente iría CONTRA la estética actual aprobada. Conclusión: **no son bugs, no se tocan**; limpiar el código muerto es higiene de bajo valor y no-cero riesgo (el shell `.app` es lo más central) → se deja documentado aquí para una limpieza dedicada futura, no vale el riesgo ahora.
- **El único de valor real es el `@layer` (punto 5).** Mata la clase entera de bug (empates decididos por orden de carga). Pendiente de decisión del usuario: es un refactor que toca los 5 CSS y requiere verificación página por página.
