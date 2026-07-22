# El horario de atención sale de Amazon Connect

**Fecha:** 22 de julio de 2026 · **Estado:** implementado y desplegado
**Continúa:** [campanas-programacion-horario-2026-07-22.md](campanas-programacion-horario-2026-07-22.md)

Una campaña ya no define su propio horario a mano: usa el **Hours of Operation de Amazon Connect**, el mismo que rige sus colas. Una sola fuente de verdad en vez de dos que podían contradecirse.

---

## 1. El problema

Hasta ahora la campaña tenía tres campos sueltos —`windowStartHour`, `windowEndHour`, `windowDaysOfWeek`— que el admin copiaba a mano desde el horario real del contact center. Dos consecuencias:

- **Podían divergir.** Si el cliente cambiaba su horario en Connect, las campañas seguían marcando con el viejo. Nadie se enteraba hasta que alguien recibía una llamada a deshora.
- **No alcanzaban para representar la realidad.** Una sola franja por día no puede expresar "9 a 13 y 15 a 18", que es el horario típico de un contact center con corte de almuerzo. El modelo obligaba a elegir entre marcar durante el almuerzo o perder la tarde.

---

## 2. El modelo: horario como lista de franjas

La ventana de una sola franja pasó a ser un caso particular de un modelo más general:

```ts
interface ScheduleInterval {
  day: number; // 0=Dom … 6=Sáb — día en que la franja ABRE
  startMinutes: number; // 0-1439
  endMinutes: number; // < start ⇒ cruza medianoche; === start ⇒ 24 h
}
interface WeeklySchedule {
  timezone: string;
  intervals: ScheduleInterval[];
  source: "connect" | "manual";
  hoursOfOperationId?: string;
  hoursOfOperationName?: string;
}
```

Dos conversores alimentan el mismo motor: `scheduleFromConnectHours()` desde el `Config[]` de Connect, y `scheduleFromWindow()` desde los campos legacy. Todo lo demás —evaluar, pintar la grilla, calcular el próximo borde— trabaja sobre `WeeklySchedule`.

**Minutos, no horas.** Un Hours of Operation puede abrir a las 9:30. Evaluar por hora daría una cuenta regresiva que miente por media hora, así que la evaluación y el cálculo del próximo cambio son al minuto. La grilla del visualizador sigue siendo por hora, pero una celda se pinta activa si la franja solapa **algún** minuto de esa hora.

### Dos convenciones que no son obvias

**Connect graba "todo el día" como 00:00–23:59, no 00:00–00:00.** El horario real de UDEP es exactamente así. Se respeta tal cual, con su minuto muerto a las 23:59: inventar un redondeo haría que ARIA marcara fuera del horario que el cliente ve en su propia consola. Hay una prueba con los datos reales que lo fija.

**`start === end` significa cosas distintas según el origen.** En un intervalo de Connect son 24 horas contadas desde la apertura. En la ventana manual significa "el día natural completo", que es lo que espera quien escribe 9 y 9. Por eso `scheduleFromWindow` emite `00:00–24:00` en ese caso y no `start→start`. Un test cubre la diferencia — se descubrió al refactorizar, cuando el cambio de semántica rompió el caso existente.

---

## 3. Resolución en cascada

El dialer resuelve el horario de cada campaña en tres escalones, y nunca lanza:

| #   | Origen                                             | Cuándo                                                               |
| --- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | **Hours of Operation leído en vivo** (caché 5 min) | Siempre que la campaña tenga `hoursOfOperationId` y Connect responda |
| 2   | **Copia guardada** (`hoursOfOperationSnapshot`)    | Connect no responde, o al rol del tenant le falta el permiso         |
| 3   | **Ventana manual**                                 | La campaña no usa Connect, o no hay copia guardada                   |

La caché tiene TTL de 5 minutos a propósito: si el cliente corrige su horario en la consola, la campaña debe respetarlo en minutos, no en la próxima hora. El fallo se cachea solo 30 segundos, para no quedar ciegos ante un error transitorio.

**La copia guardada no es opcional.** Es lo que evita que un permiso faltante o una caída de Connect dejen a las campañas marcando con la ventana manual —que puede ser cualquier cosa— sin que nadie lo note. Se valida estructuralmente antes de guardarla, porque es lo que el dialer usa cuando no puede consultar: basura ahí se traduce en llamadas a deshora.

### Reestructuración del ciclo

Resolver el horario es asíncrono (puede leer Connect), y `Array.filter` no acepta promesas. El reparto de slots del Pilar 7 filtraba con `isWithinWindow()` sincrónico, así que ahora se precomputa un `Map<campaignId, WeeklySchedule>` con `Promise.all` **antes** del filtro y del loop. Con ambas cachés calientes (el rol del tenant ~50 min, el horario 5 min), en régimen no genera tráfico por tick.

---

## 4. El permiso que faltaba

`connect:DescribeHoursOfOperation` **no estaba** en el rol cross-account. El template solo concedía `ListHoursOfOperations`, que devuelve id y nombre pero no la configuración.

Se agregó en los dos lugares donde vive el template — `infra/cfn/connect-role.yaml` y `src/components/admin/cfnTemplates.ts` — pero **los tenants ya provisionados tienen el rol viejo y deben volver a aplicar la plantilla** desde Configuración → Amazon Connect.

Mientras no lo hagan, todo degrada con gracia: `list-queues` devuelve el horario con `config: null` y un motivo, la interfaz explica que falta el permiso en vez de omitir la opción en silencio, y el dialer cae a la copia guardada o a la ventana manual.

### Hallazgo colateral: el rol de la plataforma tampoco los tenía

Ni `ListHoursOfOperations` ni `DescribeHoursOfOperation` estaban en `connectview-campaign-lambda-role`. O sea que la acción `hoursOfOperations` que ya usaba `QueuesPanel` **venía fallando desde siempre** — con un `.catch(() => {})` que se tragaba el error y dejaba el selector de horarios vacío sin explicación.

Agregarlos topó con el límite de 10 KB de políticas inline del rol, que estaba lleno. Se resolvió eliminando `ConnectCampaignsV2`, que era **byte a byte idéntica** a `CampaignsV2FullAccess` (respaldo de todas las políticas en el scratchpad de la sesión). Los permisos efectivos no cambiaron.

---

## 5. Interfaz

En el asistente de creación, el horario se elige primero entre dos orígenes:

- **El de Amazon Connect** — un selector con los horarios de la instancia. El visualizador los pinta en solo lectura, con el nombre del horario y una nota de que se edita en Connect.
- **Uno propio de la campaña** — el modelo anterior, con horas, huso y días clicables.

El diálogo de edición ofrece lo mismo en un único selector, con "Horario propio de la campaña" como primera opción.

**La zona horaria de la programación sigue al horario, no a la campaña.** Si el Hours of Operation está en `America/Lima`, la fecha y hora del arranque programado se interpretan en Lima aunque el campo `timezone` de la campaña diga otra cosa. Es la zona que determina cuándo se atiende de verdad.

**La ventana manual se sigue enviando siempre**, incluso cuando se elige Connect: es el respaldo final si el horario se borra en Connect o se revoca el permiso.

---

## 6. Despliegue

```bash
node scripts/deploy-lambda.mjs campaign-dialer create-campaign update-campaign control-campaign list-queues
```

`list-queues` por la acción nueva; los otros cuatro porque bundlean `_shared/callWindow.ts` y `_shared/connectHours.ts`.

**Compatibilidad hacia atrás:** las campañas existentes no tienen `hoursOfOperationId`, así que `resolveCampaignSchedule` cae directo a `scheduleFromWindow` y se comportan exactamente igual que antes. No hace falta migrar datos.

---

## 7. Feriados y días especiales

El patrón semanal no alcanza: un contact center cierra el 28 de julio aunque ese año caiga martes. Connect resuelve eso con **overrides** por fecha, y expone `GetEffectiveHoursOfOperations`, que devuelve el horario **ya resuelto** día por día para un rango.

Se usa esa API en vez de leer los overrides y combinarlos a mano: el que sabe aplicar las reglas de precedencia es AWS.

```
Config (patrón semanal)  +  overrides  ──GetEffectiveHoursOfOperations──▶  horario por fecha
```

El resultado se guarda en `schedule.overrides`, un mapa `"2026-07-28" → franjas`. La evaluación lo consulta **antes** que el patrón semanal:

- Si la fecha de hoy tiene entrada, **esa es la verdad de hoy**. Una lista vacía significa cerrado, no "sin dato" — es exactamente cómo se ve un feriado.
- La cola nocturna de la víspera se resuelve con la entrada del día anterior. Por eso el rango se pide **desde ayer**, no desde hoy.
- Si la víspera quedó fuera del rango, se consulta el patrón semanal **solo para esa cola**, nunca para el día completo. Consultar el patrón entero ahí haría que un feriado abriera igual — el test de paridad front/back cazó exactamente ese error mientras se escribía esto.

`specialDates()` compara el efectivo contra el patrón y devuelve solo las fechas que difieren, que es lo que el visualizador muestra como aviso ("mar 28 jul cerrado"). La grilla sigue mostrando la semana típica; sin ese aviso, un feriado quedaría invisible justo cuando más importa.

**El respaldo no lleva overrides**, y es correcto: caducan. Si Connect no responde, el patrón semanal es lo mejor disponible.

**Permiso:** `connect:GetEffectiveHoursOfOperations`, agregado a los mismos dos templates. Si falta, `withEffectiveHours` devuelve el horario sin tocar y se pierden los feriados, no el horario.

---

## 8. Pendientes

- **Las colas y las campañas siguen eligiendo su horario por separado.** Ahora pueden usar el mismo, pero nada obliga a que coincidan. Un paso natural sería proponer por defecto el horario de la cola de la campaña.
- **`scheduledEndAt` sigue sin interfaz** — implementado de punta a punta en el backend, sin exponer.
- **El rol de la plataforma quedó a ~38 bytes del límite** de 10 KB de políticas inline. El próximo permiso que haga falta obliga a consolidar políticas de verdad, no a buscar otro duplicado.
