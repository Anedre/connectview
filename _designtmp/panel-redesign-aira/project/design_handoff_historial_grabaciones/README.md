# Handoff: "Historial y Grabaciones" — Workspace de inteligencia conversacional (AIRA)

## Overview
**Historial y Grabaciones** es el workspace de un contact center donde un manager/admin elige un contacto y revisa **toda su actividad omnicanal en un solo lugar**: llamadas (audio + transcripción + sentimiento), WhatsApp, emails, archivos e historial de ciclo de vida — todo unido por el nombre/teléfono del cliente.

El objetivo del usuario es entender rápido *"qué pasó con este cliente"* sin saltar entre pantallas: escuchar llamadas con su transcripción, encontrar un mensaje/archivo, y ver cuándo y cómo se contactó.

Este rediseño reemplaza el layout original de 3 paneles fijos (lista de contactos · detalle · panel de contexto) por un **"workspace de una sola historia"**: la lista de contactos se vuelve un *command palette* invocable, el contexto/IA se integra en un hero + paneles contextuales, y el contenido ocupa todo el ancho.

---

## About the Design Files
Los archivos de este bundle son **referencias de diseño hechas en HTML/CSS/JS (React vía Babel in-browser)** — prototipos que muestran el look & feel y el comportamiento deseado. **No son código de producción para copiar tal cual.**

La tarea es **recrear estos diseños en el entorno del codebase destino** (React/Vue/Angular/etc.), usando sus patrones, librerías y design system establecidos. Si no existe un entorno aún, elegir el framework más apropiado e implementarlos ahí. El HTML usa React 18 con componentes funcionales y hooks; la lógica de estado e interacción es portable casi 1:1 a un proyecto React real (sólo hay que reemplazar el ruteo de `tab`/overlays por el del codebase, y mover los estilos inline/`styles.css` al sistema de estilos del proyecto).

> ⚠️ **Nota sobre animaciones en el prototipo:** para que renderizara bien en el entorno de preview, el prototipo evita estados de entrada con `opacity:0` y transiciones disparadas por cambio de clase (el preview "congela" el timeline de animación). En un codebase real **no hace falta ese workaround** — usen transiciones/animaciones normales (CSS transitions, Framer Motion, etc.). Más abajo se documenta la intención de cada animación.

---

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografía, espaciado, estados e interacciones son finales. Recrear la UI pixel-perfect usando las librerías/patrones del codebase. Los íconos son estilo **Lucide** (el codebase debería usar `lucide-react` o equivalente). Los gráficos (sparklines, heatmap, waveform) están dibujados a mano con SVG/divs — pueden recrearse con una librería de charts o mantenerse custom.

---

## Design Tokens

### Color — Superficies (tema claro; existe intención de tema oscuro)
| Token | Hex | Uso |
|---|---|---|
| `--bg-0` | `#F6F7F9` | Fondo de la app |
| `--bg-1` | `#FFFFFF` | Paneles / cards |
| `--bg-2` | `#FBFCFD` | Cards anidadas / inputs |
| `--bg-3` | `#F1F3F7` | Hover / chips neutros |

### Color — Bordes
| Token | Hex |
|---|---|
| `--border-1` | `#E7EAF0` |
| `--border-2` | `#DCE0E8` |

### Color — Texto
| Token | Hex | Uso |
|---|---|---|
| `--text-1` | `#0E1525` | Texto principal / títulos |
| `--text-2` | `#4F5C75` | Texto secundario |
| `--text-3` | `#7A879F` | Texto terciario / metadata |

### Color — Acentos por canal / semántica
Cada acento tiene 3 variantes: **base**, **-soft** (fondo suave) y **-2** (hover/oscuro).

| Canal / Semántica | base | -soft | -2 (hover) |
|---|---|---|---|
| **Cian** — Llamadas | `#0F84A0` | `#E2F2F6` | `#0a6c84` |
| **Verde** — WhatsApp / positivo | `#138354` | `#E0F1EA` | `#0f6e46` |
| **Ámbar** — Emails / mixto | `#B8761A` | `#F6EDDD` | `#9c6314` |
| **Violeta** — IA / Historial / Archivos | `#6253CE` | `#EAE7FA` | `#5141b8` |
| **Rojo** — Perdidas / negativo | `#C0353A` | `#F8E5E6` | `#a32a2f` |

> Tema oscuro (intención, no implementado en el prototipo): bg `#0A0A0B`, text `#F2F2F3`, cian `#2BC6E6`, verde `#25B873`, ámbar `#F5A524`, violeta `#9B8CF0`, rojo `#ED5257`.

### Mapeo de color de sentimiento (para llamadas)
`positivo → verde` · `neutral → --text-3` · `mixto → ámbar` · `negativo → rojo`.

### Tipografía
- **UI:** `"Plus Jakarta Sans"`, fallback `system-ui, sans-serif`. Pesos usados: 400 / 500 / 600 / 700 / 800.
- **Mono / números tabulares:** `"JetBrains Mono"` (`font-feature-settings:"tnum"`) — usada en duraciones, horas, conteos, %.
- Escala (px): metadata ~11–12.5 · cuerpo 13–14 · labels 12–13.5 · subtítulos 15 · números de stat 20–28 · H1 27 · nombre del cliente 23.
- `letter-spacing` negativo en títulos y números grandes (≈ -0.02 a -0.03em). `text-wrap: pretty` en párrafos.

### Radios
`--r-sm 8px` · `--r-md 10px` · `--r-lg 14px` · `--r-xl 20px`. Chips/pills: `99px`. Avatares: 14–18px.

### Sombras (premium, suaves)
| Token | Valor |
|---|---|
| `--sh-1` | `0 1px 2px rgba(16,21,37,.04), 0 1px 1px rgba(16,21,37,.03)` |
| `--sh-2` | `0 2px 8px rgba(16,21,37,.06), 0 1px 2px rgba(16,21,37,.04)` |
| `--sh-3` | `0 12px 32px -8px rgba(16,21,37,.16), 0 4px 12px -4px rgba(16,21,37,.08)` |
| `--sh-4` | `0 28px 64px -16px rgba(16,21,37,.28), 0 8px 20px -8px rgba(16,21,37,.12)` |

### Easing
- Estándar: `cubic-bezier(.22,.61,.36,1)`
- Spring (entradas de overlays): `cubic-bezier(.34,1.56,.64,1)`

### Layout
- Nav lateral: **236px** fijo. Topbar: **60px** alto. Content scroll: `max-width 1480px`, padding `26px 34px 60px`, centrado.
- Hover "lift" en cards: `translateY(-2px)` + sombra `--sh-3`.

---

## Screens / Views

La pantalla es un **shell** (nav + topbar + header + hero + navegador de canales) con una **vista activa** intercambiable debajo, más **overlays** globales.

### Shell — Nav lateral (236px)
Marca **AIRA** (logo: cuadrado 30px, radius 9px, gradiente radial `#FF9D6C → #E8576B → #B5408A`). Grupos: **OPERACIÓN** (Inicio, Agent Desktop, Cola en vivo) · **CRECIMIENTO** (Leads, Campañas, Bots, Automatizaciones, Agente IA, Citas, Reportes, **Grabaciones** ← activo) · **SISTEMA** (Configuración) · **INTEGRACIONES** (WhatsApp ●verde, Salesforce ●cian, Amazon Connect ●ámbar). Ítem activo: fondo `--bg-3`, ícono cian, barra de acento cian a la izquierda (3px). Pie: avatar `anedre12345 / Admin` + dot verde. Íconos Lucide 18px.

### Shell — Topbar (60px)
Buscador global (pill `--bg-2`, placeholder "Buscar contactos, agentes, casos, transcripciones…", atajo **Ctrl K** a la derecha) que abre el command palette. Derecha: pill de estado "Conectando…" (dot ámbar pulsante), botones ícono moon / bell / user (36px, hover `--bg-3`).

### Shell — Header de página
- Breadcrumb: `Crecimiento › Grabaciones` (13px, `--text-3`, chevron Lucide).
- H1: **"Historial y Grabaciones"** (27px / 800 / -0.025em).
- Subtítulo (14px, `--text-2`, max 680px): "Toda la actividad del contacto —llamadas, WhatsApp, emails y archivos— conectada en un solo lugar."
- Acciones a la derecha (alineadas arriba): **Compartir** y **Exportar** (botones ghost: `--bg-2`, borde `--border-1`, ícono + texto 13px/700).

### Shell — Hero del cliente (card)
Fila: avatar 62px (radius 18px, gradiente cian `140deg, var(--cian), #0a6c84`, iniciales 800), nombre 23px/800 + chevron (botón "switch" que abre el command palette; nombre con `ellipsis`), fila de chips: `Teléfono` (chip cian-soft con ícono), `No contactado` (chip neutro), teléfono mono, "Última: llamada · hace 5 d" (dot cian). Derecha: 3 botones ícono de acción (Llamar cian, WhatsApp verde, Email ámbar — 40px, borde, hover lift) + botón primario **"Resumen IA"** (relleno cian, ícono sparkles).

### Shell — Navegador de canales (unifica conteos + navegación) ⭐
Reemplaza a las antiguas "stat cards" + tabs (eran redundantes). Card blanca (radius 16px, padding 7px, `--sh-1`), fila de botones:
- **Resumen** (ítem líder, separado por un divisor vertical 1px): chip 34px + label "Resumen" (14px/700) + sublabel "Vista general" (11.5px). Activo: relleno `--text-1`, texto blanco, chip translúcido.
- **Llamadas 118 · WhatsApp 80 · Emails 2 · Archivos 3 · Actividad 7** (cada uno `flex:1`): chip 34px (color-soft + ícono del color del canal) + columna [label 12px/700 `--text-2`] [conteo 20px/800 mono **en el color del canal**]. Activo: relleno con el color del canal, texto blanco, chip translúcido blanco.
- Estados aplicados **instantáneamente** (sin transición de fondo). Hover en inactivos: fondo `--bg-3`.

### Vista: Resumen (default)
Grid `1fr / 360px`.
- **Izquierda:** card "Mapa de actividad" (heatmap anual, ver abajo) + botón "Ver llamadas →"; card "Línea de tiempo · todos los canales" (timeline omnicanal con riel de color por canal: nodo 34px color-soft + ícono, título, who·tiempo, body; dot de sentimiento donde aplica).
- **Derecha:** card "Resumen del cliente" (última interacción, canal principal, total interacciones, barra apilada de **mezcla de canales** [cian 118 / verde 80 / ámbar 2], sugerencia en banner cian-soft); card "Sentimiento global" (chip "+12% vs mes ant.", barra apilada + leyenda positivo/neutral/mixto/negativo con %); botón-card "Sugerencia IA" (gradiente violeta-soft, next-best-action → abre slide-over IA).

### Vista: Llamadas (pieza central) ⭐
Columna vertical:
1. **4 metric cards** (`grid 4`): Llamadas total (118, cian), Contestadas % (86%, verde), Duración prom. (5:21, violeta), Perdidas (17, rojo). Cada una: número 28px/800, chip de ícono 32px color-soft, label, **sparkline** del color.
2. **Filtros:** chips `Todas / Entrantes / Salientes / Perdidas` (activo = relleno `--text-1` blanco) + selector de Agente a la derecha.
3. **Heatmap anual** (card): "Actividad de llamadas · últimos 7 meses". Grilla estilo GitHub: columnas = semanas, filas = días; cada celda **coloreada por el sentimiento dominante del día**, intensidad por volumen (alpha 0.35/0.55/0.78/1). Labels de mes arriba. Día seleccionado: anillo cian. Leyenda de sentimiento. Click en día → carga sus llamadas.
4. **Split `minmax(340px,420px) / 1fr`:**
   - **Lista del día** (card): header "domingo X · N llamadas"; filas: hora (mono), ícono de dirección (entrante=flecha cian / saliente=flecha verde / perdida=teléfono rojo en chip color-soft), sentimiento (dot), agente/cola, tipificación, chip Contestada/Perdida, duración (mono), ícono grabación (mic violeta). Fila activa: fondo cian-soft + barra de acento izquierda.
   - **Reproductor** (card) — ver "Componente: Reproductor".

### Vista: WhatsApp
Card centrada (max 760px): header (avatar verde, "Hilo unificado de WhatsApp", "80 mensajes · varias conversaciones", botón "Saltar a fecha"). Cuerpo scroll: **separadores de día** (pill), separador "● nueva conversación" (verde), **burbujas** (cliente izq = blanca con borde; agente der = verde-soft); adjuntos inline como botones (ícono archivo + nombre → abren lightbox); hora mono en cada burbuja.

### Vista: Emails
Lista centrada (max 820px) de **hilos** estilo Gmail (card lift): ícono ámbar, asunto, remitente · N mensajes · último hace X. Click expande (fondo `--bg-2`): avatar + autor·fecha + cuerpo + adjuntos como chips (→ lightbox). Chevron rota al expandir.

### Vista: Archivos
Grid `auto-fill minmax(180px,1fr)` de tiles cuadrados (lift). Filtros: `Todos / Imágenes / PDFs / Documentos`. Cada tile: thumbnail (imágenes = patrón rayado placeholder; otros = ícono por tipo en color-soft), overlay inferior con nombre + canal · tamaño. Click → lightbox.

### Vista: Actividad (historial de ciclo de vida)
Card centrada (max 680px) con **timeline** de eventos (no conversaciones): cambios de etapa (violeta), tipificaciones (cian), sync Salesforce (violeta). Cada evento: nodo color-soft + ícono, título, meta (autor · tiempo). Riel vertical conectando nodos.

### Overlay: Command Palette (switcher de contactos)
Abre con **Ctrl/Cmd+K**, click en el buscador global, o click en el nombre del cliente en el hero. Scrim oscuro + blur. Panel centrado (max 720px, radius 20px, `--sh-4`): input de búsqueda grande (placeholder "Buscar contacto por nombre o teléfono…", "Esc"), fila de filtros por canal (`Todos / Teléfono / WhatsApp / Correo / Salesforce`), lista de contactos (avatar color por origen, nombre, sub-línea, dot, check en el actual). **Navegación con teclado: ↑↓ mueve cursor, ↵ selecciona, Esc cierra.** Footer con hints + conteo.

### Overlay: Lightbox (visor de adjuntos)
Scrim casi negro (`rgba(8,11,20,.82)` + blur). Header: ícono, nombre, meta (canal · quién · tamaño), botones abrir-en-pestaña / descargar / cerrar. Cuerpo: card blanca centrada con la imagen/PDF a tamaño (placeholder rayado en el prototipo). **Cierra con Esc o click en el fondo.**

### Overlay: Resumen IA (slide-over derecho)
Panel fijo derecho (max 440px). Header violeta (sparkles, "Resumen IA", "Generado · Amazon Bedrock"). Secciones: **Resumen de la llamada** (texto), **Sentimiento (Contact Lens)** (barra + leyenda %), **Momentos clave** (lista: tiempo mono + dot de tono + label), botón primario "Compartir resumen". Cierra con Esc o click en el scrim.

---

## Componente clave: Reproductor de llamada
- **Header:** ícono de dirección (chip color), "Llamada {entrante/saliente}" + chip de sentimiento, agente · fecha · duración; botones Compartir / Descargar.
- **Onda (waveform):** ~120 barras, **coloreadas por el sentimiento del segmento** (la transcripción define el sentimiento en cada tramo); parte reproducida en color sólido, resto atenuado (~28%); cabezal de reproducción (línea 2px); **marcadores de "momentos clave"** flotando sobre la onda (banderitas con tono). Click en la onda = seek; click en un momento = salta a ese tiempo.
- **Transporte:** retroceder 10s, **play/pause** (botón 52px relleno cian), avanzar 10s, tiempo actual/total (mono), velocidades `1× / 1.5× / 2×`.
- **Transcripción sincronizada:** líneas [tiempo mono] [hablante Agente=cian / Cliente=gris] [texto]; la línea activa se resalta (fondo cian-soft) y auto-scrollea según el cabezal; click en una línea = seek. **Buscador dentro de la transcripción** (resalta coincidencias con `<mark>`, muestra conteo).
- **Tipificación + Notas del agente** (columna) y **card "Resumen IA"** (gradiente violeta → abre el slide-over).
- Llamada perdida: estado vacío (sin grabación) con CTA "Devolver llamada".

---

## Interactions & Behavior
- **Cambio de contacto:** command palette (Ctrl/Cmd+K) con búsqueda, filtros por canal y navegación por teclado.
- **Navegación de vista:** click en el navegador de canales (Resumen/Llamadas/WhatsApp/Emails/Archivos/Actividad). Cambiar de vista re-monta el contenido (animación de entrada sutil).
- **Llamadas:** seleccionar día en el heatmap → llena la lista del día; seleccionar llamada → carga el reproductor; filtros Todas/Entrantes/Salientes/Perdidas.
- **Reproductor:** play/pause (simula avance con timer), seek por onda/transcripción/momentos, velocidad, búsqueda en transcripción, auto-scroll de la línea activa.
- **Adjuntos:** click → lightbox (Esc / click fondo cierra).
- **Resumen IA:** botones de IA abren slide-over derecho (Esc / scrim cierra).
- **Hover:** cards "lift" (translateY -2px + sombra), botones ícono cambian fondo, filas de lista resaltan.
- **Animaciones (intención):** entradas de vista con fade+rise ~0.42s; overlays con scale/slide spring; conmutación de navegador instantánea (estado activo), tooltip flotante en `[data-tooltip]`. (En codebase real, usar transiciones normales / Framer Motion.)
- **Responsive:** el prototipo está pensado a ~1440px. En anchos angostos, los splits (lista del día / reproductor, y grids de Resumen) deberían apilar; el nav podría colapsar. Definir breakpoints según el codebase.

## State Management
Estado a nivel app (en el prototipo, `useState` en `<App>`):
- `contact` (contacto activo), `tab` (vista activa: resumen/llamadas/whatsapp/emails/archivos/actividad), `cmdOpen` (command palette), `lightbox` (archivo abierto | null), `aiCall` (llamada del slide-over IA | null).
- En **Llamadas:** `selKey` (día seleccionado), `selCall` (llamada seleccionada), `filter`, `agent`.
- En **Reproductor:** `progress` (0–1), `playing`, `speed`, `q` (búsqueda en transcripción).
- Atajo global de teclado **Ctrl/Cmd+K** togglea el command palette; **Esc** cierra overlays.

### Realidades de datos (clave para el diseño)
Un contacto puede tener **cientos de llamadas** (ej. 118–185), ~80–100 chats de WhatsApp, **pocos emails** → las llamadas dominan (por eso el heatmap/calendario rinde). **Sentimiento por llamada** vía Amazon Connect **Contact Lens**. **Resúmenes por IA** vía Amazon **Bedrock**. Totales del caso de ejemplo: 118 llamadas · 80 WhatsApp · 2 emails · 3 archivos · 7 historial · 200 interacciones.

## Assets
- **Íconos:** estilo **Lucide** (recreados como paths en `icons.jsx`). Usar `lucide-react`/equivalente. Nombres usados: home, headset, search, refresh, phone, chat (message-circle), mail, paperclip, history, chevron(R/L/D/U), play, pause, x, download, external, bell, moon, user, arrowIn/arrowOut/missed (direcciones de llamada), gauge, check, plus, filter, more, file-text, image, rewind, forward, flag, tag, trending, send, share, volume, clock, sparkles, mic, layers, users, megaphone, bot, zap, calendar, chart, settings, arrowRight.
- **Logo AIRA:** cuadrado con gradiente (placeholder) — reemplazar por el logo real del codebase.
- **Fuentes:** Plus Jakarta Sans + JetBrains Mono (Google Fonts). Sustituir por las del design system si difiere.
- **Imágenes/PDF:** placeholders rayados — se reemplazan por los assets reales (thumbnails de adjuntos, visor de PDF/imagen).
- **Charts (sparkline / heatmap / waveform):** custom SVG/divs en `ui.jsx` — recrear o usar librería.

## Files (en este bundle)
- `Historial y Grabaciones.html` — entry point (carga React 18 + Babel y los scripts).
- `styles.css` — **todos los design tokens** (`:root`) + estilos base y de componentes. Fuente de verdad de colores/sombras/radios.
- `data.js` — dataset mock denso (genera 118 llamadas con sentimiento/transcripción, 80 WhatsApp, emails, archivos, historial, agregados por día).
- `icons.jsx` — set de íconos Lucide (`<Icon name size stroke/>`).
- `ui.jsx` — primitivos: `Avatar, Chip, Sparkline, StackedBar, Dot, Heatmap, Waveform, CountUp`, helpers (`initials, fmtDur, cssv, mix`).
- `views_calls.jsx` — vista **Llamadas** + **Reproductor**.
- `views_other.jsx` — vistas Resumen / WhatsApp / Emails / Archivos / Actividad + **Lightbox** + **Resumen IA**.
- `app.jsx` — shell: Nav, Topbar, Header, Hero, **ChannelNav**, ruteo de vistas, **CommandSwitcher**.

> Nota: existe también un explorador de 3 direcciones de layout (`Conceptos de layout.html`) — **no incluido**; el usuario eligió la dirección "A · Una sola historia", que es la documentada acá.
