# PULSO — concepto de página de reportes

Prototipo autocontenido (un solo `index.html`, cero dependencias) que define cómo
debería verse y comportarse la página de reportes ideal. Es un **apartado
independiente de ARIA**: paleta propia, componentes propios, datos simulados.
Sirve como north-star para reconstruir `/reports`.

**Ver en vivo:** `node design/pulso-reportes/serve.mjs` → http://localhost:4517
(o abrir `index.html` directo en el navegador).

---

## 1. Diagnóstico del caos actual (`src/pages/ReportsPage.tsx`)

- **~14 paneles importados y apilados** (Sentiment, AgentPerformance, HsmOutbound,
  WhatsAppAnalytics, Tipificaciones, BotAnalytics, ContactsTable, ChannelTrend,
  ScheduledExports, PowerBiFeed, Downloads, AutoInsights…) sin jerarquía: todo
  compite, nada lidera.
- **Filtros repartidos**: el período vive en el hero, `ContactFilters` abajo, y
  varios sub-reportes traen su propio rango → los números no cuadran entre sí.
- **Sin capa de respuesta**: la página muestra datos pero no responde preguntas
  ("¿qué canal crece?", "¿cuándo reforzar turnos?").
- Detalles de ejecución: gridlines punteadas (ruido), colores de serie ad-hoc sin
  validación CVD, tooltips inconsistentes entre ECharts y componentes custom.

## 2. Principios del rediseño

1. **Una sola fila de filtros arriba; alcance global.** Rango → canales →
   programa → comparación. Todo lo de abajo responde al mismo slice; los números
   siempre cuadran.
2. **Jerarquía de lectura en 3 niveles:** (1) hero + 4 KPIs con delta y
   sparkline → (2) hallazgos automáticos accionables → (3) evidencia (tendencia,
   mix, embudo, velocidad, heatmap, programas, equipo).
3. **Un gráfico = una pregunta.** Cada card tiene título-pregunta, subtítulo de
   alcance y un solo encoding. Nada de ejes duales.
4. **Los hallazgos venden la IA**: la franja "ARIA detectó" convierte datos en
   acciones (es lo que Chattigo/QuickSight no hacen).

## 3. Paleta propia (tema "ink" oscuro + menta eléctrica)

Superficies: página `#0A0D12` · card/superficie de chart `#10141B` ·
elevado `#151B26` · borde `rgba(255,255,255,.07)`.

Tinta: primaria `#F2F5FA` (16,9:1) · secundaria `#A9B4C6` (8,8:1) ·
muted/ejes `#7C8798` (5,1:1) · grid `#1E242E` · eje `#2E3646`.

### Series categóricas (el color sigue al canal, nunca a su rango)

| Slot | Canal         | Hex       | Rol     |
| ---- | ------------- | --------- | ------- |
| 1    | WhatsApp      | `#23A878` | menta   |
| 2    | Voz           | `#6D80F2` | iris    |
| 3    | Mercado Libre | `#BD8412` | ámbar   |
| 4    | Instagram     | `#DA5A9E` | magenta |
| 5    | Messenger     | `#3093D8` | cielo   |

**Validada con `dataviz/scripts/validate_palette.js`** (modo dark, superficie
`#10141B`): banda de luminosidad OK, croma OK, CVD ΔE adyacente mín **10,5**
(objetivo ≥8), visión normal mín **21,5** (piso ≥15), contraste ≥3:1 todas.
Regla derivada: **iris y cielo nunca adyacentes** (juntos fallan: ΔE 4,9).
El orden de apilado del área/dona ES este orden de slots.

### Otros roles

- **Acento de producto** `#35E0A1` (hero, focus, sparklines, meter) · track `#173327`.
- **Ordinal (embudo, 5 pasos, validada `--ordinal`)**: `#1E5A43 → #257656 → #2D9269 → #37AE7D → #45CE96`.
- **Secuencial (heatmap, 7 pasos, monótona)**: `#123126 → … → #45CE96` (en dark el cero recede a la superficie).
- **Deltas/estado**: bueno `#45CE96` (9,3:1) · malo `#F07F7F` (7,1:1) · alerta `#FAB219` — siempre con icono ▲▼, nunca color solo.
- **Tipografía**: Inter en todo (números incluidos, `tabular-nums` SOLO en tablas y ejes); Space Grotesk únicamente en el wordmark.

## 4. Inventario de componentes

| Componente       | Especificación clave                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hero figure      | 54px, 1 por vista, figuras proporcionales, delta + caption                                                                                                                                 |
| Stat tile        | label + valor + delta (▲▼ con signo semántico) + sparkline 12 pts                                                                                                                          |
| Área apilada     | fill 22 % + borde 2px por serie + **gap 2px color superficie** entre bandas; crosshair que imanta al día; tooltip con todas las series + total + período anterior; leyenda siempre visible |
| Comparación      | línea gris sólida de-énfasis (`#66738A`), toggle global "vs período anterior"                                                                                                              |
| Dona             | gaps de superficie entre arcos, centro vivo (hover→valor del arco), % directo SOLO en el segmento mayor, lista lateral con valores                                                         |
| Embudo           | rampa ordinal menta, extremo de dato redondeado 4px / base recta, valores fuera de barra, conversión paso a paso                                                                           |
| Velocidad        | P50 + P90, meter con track del mismo ramp, marcador de meta, severidad accent→warn→danger, icono+texto de estado                                                                           |
| Heatmap          | 7×14, celda 24px, rampa secuencial + leyenda de escala, tooltip y foco por celda                                                                                                           |
| Barras nominales | una serie → un solo color (slot 1), ≤24px, valor al tip + delta                                                                                                                            |
| Leaderboard      | orden por columna (click/Enter), avatar iniciales, mini-meter conversión, sparkline por fila                                                                                               |
| Tooltip          | singleton, valores en negrita primero, line-keys de color, `textContent` (nunca innerHTML)                                                                                                 |
| Twin de tabla    | **cada gráfico alterna a tabla** (botón en el card) — accesibilidad + export mental                                                                                                        |
| Motion           | entrada stagger 50-60ms, draw-in 0,9s, count-up 0,7s, todo respeta `prefers-reduced-motion`                                                                                                |

## 5. Interacciones incluidas en el prototipo

- Rango 7/30/90 días re-computa TODO (con count-up y re-draw suave).
- Chips de canal filtran globalmente (mínimo 1 activo; los colores nunca se reasignan).
- Select de programa escala el slice completo.
- Toggle "vs período anterior" (línea fantasma + filas extra en tooltips).
- Crosshair en tendencia; hover/foco con tooltip en dona, embudo, heatmap, barras.
- Sort del leaderboard; toggle gráfico↔tabla por card; export CSV real del slice.
- Hallazgos calculados del dataset (canal top, pico horario) con anchors a la evidencia.
- **Modo recorrido (carrusel deslizante)**: botón "Recorrido" → los mismos cards se
  vuelven slides a pantalla completa (scroll-snap + flechas + puntos + ← → + Esc),
  con avance automático cada 8 s para modo TV/wallboard. Decisión de diseño: el
  carrusel es **narrativa** (reunión semanal, pantalla del piso), nunca la
  navegación primaria — el canvas escaneable sigue siendo el default. Los charts
  se re-dibujan al tamaño del slide y el DOM se restaura al salir.

## 6. Plan de port a ARIA (cuando se apruebe la dirección)

1. **Tokens**: mapear la paleta a CSS vars de ARIA (`--pulso-*` o extender los chart
   tokens de `EChart.tsx`); decidir si Reportes adopta el tema ink oscuro o se
   re-valida la paleta sobre la superficie clara de ARIA (re-correr el validador
   con `--mode light --surface <hex>` — los pasos cambiarán).
2. **IA**: reducir `/reports` a este canvas único + 2 tabs de profundidad
   (p. ej. "Resumen" = esto; "Detalle" = tablas/descargas; "Pipeline" ya existe).
   Matar los paneles sueltos o moverlos a "Detalle".
3. **Charts**: los ECharts existentes pueden replicar los specs (grid sólido
   hairline, fills 22 %, gaps de superficie, tooltip unificado) — o portar los
   SVG custom de este prototipo como componentes React (son ~600 líneas).
4. **Datos**: el slice global ya existe (`queryContacts` + período real); falta
   unificar los sub-reportes al MISMO filtro (hoy cada uno consulta lo suyo).
5. Los hallazgos se alimentan de `AutoInsights` (ya existe) con este formato
   accionable.

---

_Concepto: julio 2026 · datos simulados con PRNG sembrado (mismo render siempre) ·
paleta validada con el método dataviz (six checks)._
