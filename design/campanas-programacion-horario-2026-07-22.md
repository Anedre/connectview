# Campañas programadas + visualizador de horario de atención

**Fecha:** 22 de julio de 2026 · **Estado:** implementado, pendiente de desplegar los Lambdas

Dos capacidades que se construyeron juntas porque comparten la misma lógica: **cuándo puede marcar una campaña**.

---

## 1. Qué había antes

La campaña tenía una ventana horaria diaria (`timezone`, `windowStartHour`, `windowEndHour`, `windowDaysOfWeek`) que el discador evaluaba en cada tick. Pero:

- **No se podía programar un arranque.** El asistente de creación enviaba `startNow: true` fijo en el código: o arrancaba al guardar, o quedaba en borrador esperando un click manual.
- **Los días estaban congelados en lunes a viernes.** El backend soportaba `windowDaysOfWeek` desde siempre, pero el asistente mandaba `[1,2,3,4,5]` literal y el diálogo de edición ni siquiera exponía el campo.
- **El horario era invisible.** Tres campos numéricos sueltos. Nadie podía ver de un vistazo cuándo iba a marcar su campaña.
- **La lógica de ventana estaba duplicada.** El discador la tenía en su archivo y la página de detalle la reimplementaba en el cliente. Cuando se corrigió el bug de medianoche en el backend, la copia del frontend se quedó con el bug: el banner decía una cosa y el discador hacía otra.

---

## 2. Modelo

Dos campos nuevos en `connectview-campaigns` y un estado nuevo.

| Campo              | Tipo                    | Para qué                                                                   |
| ------------------ | ----------------------- | -------------------------------------------------------------------------- |
| `scheduledStartAt` | ISO 8601 en UTC, o nulo | Cuándo debe pasar sola a `RUNNING`. Se limpia al promover                  |
| `scheduledEndAt`   | ISO 8601 en UTC, o nulo | Fin de vigencia: al pasar, la campaña se completa aunque queden pendientes |

**Estado nuevo:** `SCHEDULED`. Máquina de estados resultante:

```
DRAFT ──schedule──> SCHEDULED ──(vence)──> RUNNING ──> COMPLETED
  │                     │                     ▲
  │                     └──unschedule─────────┤
  └──start──────────────────────────────────> ┘
```

`start` sobre una campaña `SCHEDULED` adelanta el arranque y borra la fecha. `unschedule` la devuelve a `DRAFT` conservando los contactos cargados.

### Por qué no se creó un índice nuevo

El patrón obvio habría sido copiar lo que hace `callback-dispatcher`: un índice secundario `status-scheduledAt-index` y una consulta por rango. No hizo falta.

Las campañas programadas son decenas, no millones. Consultar el índice existente `status-createdAt-index` con `status = "SCHEDULED"` y filtrar la fecha en memoria cuesta menos que mantener un índice adicional sobre la tabla — y sobre todo, **no requiere migración de infraestructura**, que era el mayor costo de la alternativa.

---

## 3. Ejecución

La promoción vive en `campaign-dialer`, que ya corre cada minuto. Sin proceso nuevo, sin regla de EventBridge nueva.

```
dialCycle()
  ├── promoteScheduledCampaigns()   ← nuevo, corre primero
  └── listRunningCampaigns()        ← ve las recién promovidas en el mismo ciclo
```

Que la promoción vaya **antes** de listar no es casual: así una campaña que vence a las 09:00 empieza a marcar en ese mismo ciclo y no pierde un minuto esperando el siguiente tick.

**Concurrencia.** El `UpdateItem` lleva `ConditionExpression: "#st = :scheduled"`. Los procesos periódicos no tienen concurrencia reservada, así que dos invocaciones solapadas son posibles; con la condición, sólo una gana la promoción y la otra recibe `ConditionalCheckFailedException` y sigue de largo. Un `ConditionalCheckFailed` acá **no es un error** y se ignora deliberadamente.

**Decisión de diseño: la campaña arranca aunque esté fuera de su horario.** Pasa a `RUNNING` y el filtro de ventana la deja esperando la primera franja hábil. Es lo que espera quien programa un domingo una campaña para el lunes: quiere verla "activa y esperando", no que el sistema le mueva la fecha.

**Fin de vigencia.** Se evalúa **antes** que el filtro de ventana. Al revés, una campaña vencida fuera de horario quedaría `RUNNING` para siempre sin que nadie la completara.

---

## 4. La lógica de ventana, ahora en un solo lugar

Dos archivos espejo, uno por lado del stack:

| Archivo                                   | Consumidores                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `amplify/functions/_shared/callWindow.ts` | `campaign-dialer`, `create-campaign`, `update-campaign`, `control-campaign` |
| `src/lib/callWindow.ts`                   | asistente de creación, diálogo de edición, detalle, lista, visualizador     |

No es un archivo único porque el frontend y el backend tienen configuraciones de TypeScript y empaquetado distintos; es el mismo patrón de espejo que ya usa `_shared/pricing.ts`. La prueba `src/test/call-window.test.ts` importa **los dos** y verifica que dan el mismo veredicto en las 168 celdas de la semana, así que una divergencia rompe la integración continua.

### Reglas de la ventana

- **Diurna** (`start < end`): activa si el día está marcado y `start <= hora < end`.
- **24 horas** (`start === end`): todo el día marcado.
- **Nocturna** (`start > end`): cruza medianoche. **Los días marcan el día en que la ventana abre.** Con 22→06 activa los lunes, el tramo de 00:00 a 06:00 del martes pertenece a la sesión que abrió el lunes; el martes por sí solo no habilita nada. Antes esta configuración simplemente nunca abría.
- **`windowEndHour = 24`** es legal y significa medianoche del día siguiente. Es lo que escribe el botón "Discar ahora (24h)" del detalle.
- **Sin días marcados**: nunca abre. La interfaz lo señala como error en vez de dejar una campaña muerta en silencio.

### El bug de medianoche

`hour12: false` con la configuración regional `en-US` resuelve a `hourCycle: "h24"`, donde las 00:xx se formatean como `"24"`. Entonces `24 >= 0 && 24 < 24` daba falso y **toda campaña con ventana de 24 horas quedaba muerta entre 00:00 y 00:59**. La corrección es `hourCycle: "h23"`, más un cinturón por si el motor lo ignora. Está cubierto por prueba de regresión.

---

## 5. Interfaz

### Visualizador de horario de atención

`src/components/campaigns/BusinessHoursPreview.tsx` — grilla de 7 días × 24 horas que muestra:

- qué franjas atienden y cuáles no;
- dónde cae **ahora** en el huso de la campaña, con anillo verde si está abierto y ámbar si está cerrado;
- cuánto falta para el próximo cambio de estado ("Cierra en 6 h 10 min");
- dónde cae el arranque programado, si es dentro de los próximos 7 días;
- el resumen en una línea y las horas semanales ("Lun a Vie · 09:00–18:00 · 45 h/semana").

Los días son **clicables** cuando se pasa `onDaysChange`, que es como se resolvió el campo congelado: activar el sábado es un click sobre su etiqueta.

Se usa en tres lugares: el asistente de creación (editable), el diálogo de edición (editable, compacto) y el detalle de campaña (sólo lectura, compacto).

Estilos en `src/styles/call-window.css`, con prefijo `.cw-` para no chocar con `.camp-*` ni con `.ib-*`.

### Huso horario del selector

La fecha y la hora se eligen **en el huso de la campaña**, no en el del navegador. `zonedInputsToUtcIso()` hace la conversión considerando el horario de verano. Sin esto, un supervisor conectado desde Madrid programaría la campaña seis o siete horas antes de lo que ve en pantalla.

La conversión itera dos veces porque el desfase depende del instante que se está calculando: la primera pasada da una aproximación y la segunda la corrige si el ajuste cruzó un cambio de horario de verano.

---

## 6. Bug de infraestructura encontrado de paso

En `control-campaign`, el bucle que aplica `extraSets` al `UpdateItem` sólo copiaba el valor cuando venía como cadena:

```ts
setExpressions.push(`${key} = :${key}`);
if (val.S) exprVals[`:${key}`] = { S: val.S }; // ← un {NULL:true} nunca entraba
```

El resultado era una expresión `SET` que referenciaba un marcador inexistente, y DynamoDB rechazaba el update completo con `ValidationException`. No lo veía nadie porque hasta ahora ningún caso del switch limpiaba un campo. `unschedule` y `start` desde `SCHEDULED` sí lo hacen. Corregido.

---

## 7. Despliegue

Cuatro Lambdas bundlean `_shared/callWindow.ts` y hay que redesplegarlas:

```bash
node scripts/deploy-lambda.mjs campaign-dialer create-campaign update-campaign control-campaign
```

Las de lectura (`list-campaigns`, `get-campaign-stats`) devuelven el registro completo sin proyección de campos, así que los campos nuevos fluyen sin redespliegue.

El frontend se publica solo al integrar en `master` (Amplify Hosting).

**Compatibilidad hacia atrás:** las campañas existentes no tienen `scheduledStartAt` ni `scheduledEndAt`. `isScheduleDue(undefined)` e `isScheduleExpired(undefined)` devuelven falso, así que se comportan exactamente igual que antes. No hace falta migrar datos.

---

## 8. Pendientes

- **Fin de vigencia sin interfaz.** `scheduledEndAt` está implementado de punta a punta en el backend, pero ninguna pantalla lo expone todavía. Cablearlo es un campo de fecha en el asistente y en el diálogo de edición.
- **Horas de operación de Amazon Connect.** Las colas ya tienen su horario configurado en Connect, y la campaña tiene el suyo propio. Hoy son independientes y pueden contradecirse. Superponer el horario de la cola en el visualizador — o directamente permitir heredarlo — requiere exponer el detalle desde `list-queues` (hoy sólo lista identificadores y nombres, haría falta `DescribeHoursOfOperation`).
