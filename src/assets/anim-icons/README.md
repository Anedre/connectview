# Iconos animados (Lottie)

JSON de iconos animados para momentos de deleite (empty states, éxitos,
onboarding). Se usan con `AnimatedIcon` del kit fx, que carga el player de
Lottie **lazy** (no pesa nada hasta el primer icono).

## Ya incluidos (10) — de useAnimations

`activity` · `alert` · `checkmark` · `download` · `heart` · `loading` ·
`notification` · `settings` · `star` · `trash`

> **En vivo hoy:** `notification.json` en el empty state "Estás al día" de la
> campana ([NotificationsBell](../../components/layout/NotificationsBell.tsx)).

### ⚠️ Atribución obligatoria (licencia CC BY)

Estos vienen de **[useAnimations](https://useanimations.com)** bajo Creative
Commons **Attribution** — se permite uso **comercial** y en proyectos de
cliente, pero la licencia **exige** dar crédito con un enlace a
`useanimations.com` en el proyecto publicado. Falta agregar ese crédito en un
"Acerca de" / pie / página de licencias de ARIA antes de publicar con estos
iconos. (Si prefieres evitar la atribución, reemplázalos por otros de
animatedicons.co o LottieFiles con licencia sin atribución.)

## Cómo agregar más

De [animatedicons.co](https://animatedicons.co) o
[LottieFiles](https://lottiefiles.com): descarga en formato **Lottie JSON**,
guárdalo acá en kebab-case (`bell-ring.json`) y úsalo:

```tsx
import { AnimatedIcon } from "@/components/fx";
import bellRing from "@/assets/anim-icons/bell-ring.json";

// hover (default): reproduce al pasar el mouse
<AnimatedIcon data={bellRing} size={28} />

// loop continuo
<AnimatedIcon data={bellRing} loop autoplay playOnHover={false} />

// recolorear un icono monocromo (los de useAnimations vienen en NEGRO)
<AnimatedIcon data={bellRing} tint="#33BFC8" size={30} autoplay />
```

`tint` recorre el JSON y reescribe el color de los trazos — pensado para
iconos de un solo color. Para iconos multicolor, no lo uses (aplanaría todo).

> Los iconos ESTÁTICOS de la app siguen siendo Phosphor. Esto es solo para
> momentos puntuales, no para reemplazar la iconografía general. Para las
> micro-interacciones de **hover** en botones (campana que se menea, etc.) NO
> se usa Lottie: son clases CSS `.fx-ico-*` (ver design/fx-toolkit.md).
