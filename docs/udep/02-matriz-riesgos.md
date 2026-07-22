# Matriz de riesgos — implementación ARIA en UDEP

**Versión:** 1.0 · **Fecha:** 22 de julio de 2026
**Alcance:** riesgos de la fase de activación (no del desarrollo, que está cerrado).

---

## 1. Cómo leer esta matriz

**Probabilidad:** Alta (>60 % de que ocurra), Media (25–60 %), Baja (<25 %).
**Impacto:** Crítico (bloquea el go-live), Alto (retrasa ≥1 semana o degrada una función central), Medio (retrasa <1 semana o afecta una función secundaria), Bajo (molesto, no bloqueante).
**Exposición:** combinación de ambos. Determina el orden de atención.

Cada riesgo tiene un **dueño nombrado**. Un riesgo sin dueño no se gestiona: se sufre.

---

## 2. Resumen de exposición

|                 | Impacto Crítico | Alto             | Medio            | Bajo |
| --------------- | --------------- | ---------------- | ---------------- | ---- |
| **Prob. Alta**  | R-01            | R-02, R-07       | R-12             | —    |
| **Prob. Media** | R-03            | R-04, R-05, R-08 | R-09, R-13, R-14 | R-16 |
| **Prob. Baja**  | —               | R-06, R-10       | R-11, R-15       | R-17 |

**Los cuatro riesgos que hay que mirar todas las semanas:** R-01, R-02, R-03 y R-07.

---

## 3. Riesgos de coordinación y dependencia del cliente

### R-01 · Los accesos que solo UDEP puede entregar llegan tarde

**Probabilidad:** Alta · **Impacto:** Crítico · **Dueño:** Zhenia Loyola (UDEP) / Miguel Vega (Novasys)

Seis de los siete elementos de la ruta crítica dependen de una acción de UDEP: sandbox de Salesforce, campos `Vox*__c`, número Meta, metadata del IdP, App de Mercado Libre e imágenes de carrusel. Ninguno depende de Novasys.

_Por qué es probable:_ son tareas pequeñas para UDEP pero que compiten con la operación diaria y atraviesan tres áreas distintas (TI, Marketing, administración de Salesforce). Históricamente, este es el patrón que más retrasa implementaciones de este tipo.

**Mitigación**

- Acta de compromisos firmada con fecha y responsable nombrado por ítem, antes del 31 de julio.
- Guías paso a paso ya escritas para cada ítem, de modo que la tarea de UDEP sea ejecutar, no averiguar.
- Revisión de estado semanal de 20 minutos, con semáforo por ítem.
- Escalamiento definido: si un ítem lleva 5 días hábiles vencido, escala a Paul De Rutte.

**Plan de contingencia:** cada ítem tiene degradación con gracia. La plataforma funciona sin ellos; lo que se pierde es una función concreta. Si al 21 de agosto falta alguno, se documenta como diferido y el go-live sigue sin él.

---

### R-02 · El sandbox de Salesforce no está disponible o llega sin permisos suficientes

**Probabilidad:** Alta · **Impacto:** Alto · **Dueño:** Carlos Olortiga / Julio (UDEP)

Es un bloqueo ya identificado y aún sin resolver. Sin sandbox no se puede probar la integración de Salesforce contra datos reales, que es el corazón de R23/R24 y del write-back de golpes de R4.

_Matiz importante:_ no alcanza con un sandbox cualquiera. Hace falta un **Developer Sandbox con permisos de administrador**, porque ARIA necesita descubrir el esquema (`describeSObject`) y escribir campos custom.

**Mitigación**

- Solicitud formal enviada en F0 con la especificación exacta del tipo de sandbox y los permisos.
- Novasys mantiene una org de Salesforce propia como banco de pruebas: la mecánica de integración se valida ahí en paralelo, de modo que cuando llegue el sandbox de UDEP solo quede validar el mapeo específico.

**Plan de contingencia:** probar contra la org propia de Novasys y hacer una ventana de validación acotada en el sandbox de UDEP cuando esté. Riesgo residual: diferencias de esquema no detectadas hasta esa ventana.

---

### R-03 · El número de WhatsApp anclado a Amazon Connect impide medir el estado de entrega

**Probabilidad:** Media · **Impacto:** Crítico para R5 · **Dueño:** Juan Gallardo (UDEP) + Novasys

Esta es una **restricción de arquitectura de AWS, no un defecto corregible.** AWS End User Messaging admite un solo _event destination_ por WABA. El número legacy de UDEP está anclado a Amazon Connect para recibir entrantes por contact flow. Capturar el estado por mensaje (`statuses[]`) y mantener el entrante por Connect son **mutuamente excluyentes**.

Consecuencia concreta y ya documentada: para los números anclados a Connect, el reporte de primera respuesta (R17) no puede medir la respuesta del cliente. La plataforma lo señala con el indicador `inboundTracked` en vez de mostrar un número inventado.

**Mitigación**

- Operar el número meta-standalone **+51 908 825 660** para todo lo saliente con medición de entrega.
- Mantener el número anclado a Connect solo para lo entrante de voz.
- Explicar la restricción a Adriana Gómez **antes** del UAT, no cuando aparezca en un reporte.

**Plan de contingencia:** si UDEP decide un solo número, se elige explícitamente qué se sacrifica y queda por escrito. No hay una tercera opción técnica.

---

### R-04 · El set final de reportes (R20) no se cierra a tiempo

**Probabilidad:** Media · **Impacto:** Alto · **Dueño:** Adriana Gómez (UDEP)

Es el único requerimiento funcional que sigue abierto. Si se define durante el UAT en vez de antes, cada ajuste de reporte entra como cambio tardío.

**Mitigación:** sesión dedicada agendada en F0, con los reportes actuales de Chattigo como punto de partida para comparar. Salida: lista firmada de reportes, campos y frecuencia.

---

### R-05 · Los asesores no participan del UAT con dedicación real

**Probabilidad:** Media · **Impacto:** Alto · **Dueño:** Paul De Rutte (UDEP)

Un UAT hecho por el equipo de proyecto en vez de por asesores reales encuentra los errores obvios y ninguno de los importantes. Los problemas de usabilidad y de calce con el flujo real de trabajo aparecen únicamente con usuarios reales bajo carga real.

Paul De Rutte ya pidió entrevistas con asesores en campo antes de implementar: esa solicitud es exactamente la mitigación de este riesgo y hay que ejecutarla.

**Mitigación:** 3–5 asesores nombrados con dedicación de media jornada durante dos semanas, comprometidos en el acta. Dos jornadas de acompañamiento en campo al inicio del UAT.

---

## 4. Riesgos técnicos

### R-06 · Duplicación de leads o de mensajes por concurrencia

**Probabilidad:** Baja · **Impacto:** Alto · **Dueño:** Andre Alata (Novasys)

La auditoría de idempotencia de julio de 2026 identificó unos 30 hallazgos de concurrencia y deduplicación. Los de severidad P0 y P1 ya están corregidos y desplegados: deduplicación por `wamid` en el entrante de WhatsApp, marcador antes del efecto en el motor de automatización, y resolución de la carrera entre búsqueda y escritura al crear leads.

_Por qué sigue en la matriz:_ los ticks programados todavía no tienen concurrencia reservada, así que dos invocaciones solapadas siguen siendo posibles en teoría. Las escrituras críticas están protegidas con escrituras condicionales, que es la defensa correcta, pero el riesgo residual no es cero.

**Impacto si ocurre:** un lead duplicado con doble mensaje de bienvenida es visible para el cliente final y afecta la reputación del número ante Meta.

**Mitigación:** escrituras condicionales ya implementadas; monitoreo de duplicados durante el hypercare; concurrencia reservada en los crons como endurecimiento posterior al go-live.

---

### R-07 · Truncamiento silencioso al importar bases grandes

**Probabilidad:** Alta · **Impacto:** Alto · **Dueño:** Andre Alata (Novasys)

La auditoría marcó truncamientos de paginación en varios puntos, incluido el importador masivo, cuyos contadores pueden reportar más filas de las que realmente quedaron cargadas.

_Por qué es especialmente relevante para UDEP:_ la operación se basa en cargar bases por programa. Una campaña con más de 20 000 contactos entra de lleno en el caso afectado. Un contador que miente es peor que un error: nadie va a revisar una carga que dice "éxito".

**Mitigación**

- Verificar toda carga masiva contrastando el conteo de la plataforma con el del archivo original, durante F3 y todo el hypercare.
- Cargar por lotes de tamaño acotado en la primera campaña real.
- Corregir la paginación del importador antes del piloto.

**Detección:** si el total cargado no coincide exactamente con las filas válidas del archivo, no se lanza la campaña.

---

### R-08 · El opt-out confirma al cliente sin haber persistido la baja

**Probabilidad:** Media · **Impacto:** Alto (regulatorio y reputacional) · **Dueño:** Andre Alata (Novasys)

Identificado como P1 de cumplimiento en la auditoría. Si el cliente escribe STOP, recibe "no volverás a recibir mensajes" y aun así se le sigue enviando, el problema no es sólo de experiencia: es una causal de sanción por parte de Meta y afecta la calidad del número.

**Mitigación:** confirmar la baja únicamente después de verificar la escritura; prueba explícita de extremo a extremo en el plan de UAT (caso P-14); número de prueba dedicado en la lista de no contactar.

---

### R-09 · El rol de IAM de las funciones de campaña está saturado

**Probabilidad:** Media · **Impacto:** Medio · **Dueño:** Andre Alata (Novasys)

El rol `connectview-campaign-lambda-role` está en su límite: 10 políticas administradas y cerca de 10 KB de política en línea. Cualquier permiso nuevo debe integrarse en una política existente en vez de crear una nueva.

**Impacto si ocurre:** una función nueva falla con error de permisos en un momento inoportuno, típicamente durante una activación.

**Mitigación:** ningún componente nuevo entra en la ruta del go-live; los permisos necesarios ya están concedidos y verificados. Reorganizar los roles queda como tarea posterior.

---

### R-10 · Fuga entre inquilinos por el dominio de Customer Profiles fijo en el código

**Probabilidad:** Baja · **Impacto:** Alto · **Dueño:** Andre Alata (Novasys)

El dominio `amazon-connect-novasys` está escrito directamente en unas nueve funciones. Hoy no es explotable porque UDEP es el único inquilino con datos en ese dominio, pero es una deuda estructural que crece con cada cliente nuevo.

**Mitigación:** UDEP opera bajo el modelo BYO, con sus tablas de datos en su propia cuenta de AWS. Parametrizar el dominio es tarea del endurecimiento multi-inquilino, previa al segundo cliente.

---

### R-11 · Rechazo de plantillas por parte de Meta

**Probabilidad:** Baja · **Impacto:** Medio · **Dueño:** Marketing UDEP

Las plantillas con encabezado multimedia, botones dinámicos o carrusel tienen reglas estrictas. Los errores frecuentes ya están catalogados y ARIA arma los componentes automáticamente para evitarlos, pero la aprobación final es de Meta.

**Mitigación:** enviar las plantillas con 10 días de anticipación respecto de su necesidad; tener una plantilla de texto plano como respaldo para cada plantilla crítica.

---

## 5. Riesgos de operación y adopción

### R-12 · Convivencia prolongada con Chattigo y Kommo

**Probabilidad:** Alta · **Impacto:** Medio · **Dueño:** Zhenia Loyola (UDEP)

Durante el piloto conviven dos plataformas. Si la convivencia se extiende más de lo previsto, los asesores trabajan en ambas, la información se fragmenta y ninguna de las dos refleja la verdad.

**Mitigación:** ventana de convivencia acotada y declarada (piloto: 1 programa, 1 semana). El corte de Zapier tiene un criterio objetivo: N días de doble ingesta sin pérdida de leads, verificado con conteos, no con impresiones.

---

### R-13 · Resistencia al cambio de los asesores

**Probabilidad:** Media · **Impacto:** Medio · **Dueño:** Paul De Rutte (UDEP)

Los asesores llevan tiempo con un flujo conocido. Una herramienta nueva, aunque sea mejor, tiene un costo de adopción real.

**Mitigación:** involucrarlos desde el UAT (no sólo en la capacitación), acompañamiento en campo, y arranque por un solo programa para que los primeros usuarios se conviertan en referentes internos.

---

### R-14 · El modelo de "programa" no calza con la realidad de las 56 unidades

**Probabilidad:** Media · **Impacto:** Medio · **Dueño:** Zhenia Loyola (UDEP)

El modelo se construyó a partir de lo conversado: programa como unidad comercial de vida corta (~3 meses), con leads casi disjuntos. Si al cargar los 56 programas reales aparecen relaciones no previstas (programas anidados, leads compartidos entre unidades), habría que ajustar la taxonomía.

**Mitigación:** los 5 programas de ejemplo solicitados en F0 son precisamente la prueba temprana de este supuesto. Se validan antes de cargar los 56.

---

### R-15 · Los costos de AWS se desvían de lo estimado

**Probabilidad:** Baja · **Impacto:** Medio · **Dueño:** Miguel Vega (Novasys)

La estimación se basa en una factura real de UDEP de aproximadamente 4 agentes. Escalar a 25 agentes multiplica el volumen y algunos componentes no escalan linealmente. Además hay tres precios pendientes de confirmar para Perú: telefonía entrante y saliente, WhatsApp de marketing y el posible solapamiento entre WhatsApp Business Messaging y End User Messaging Social.

**Mitigación:** confirmar esos tres precios antes del go-live; alerta de presupuesto en la cuenta de AWS; revisión de costos al cierre del primer mes de operación.

---

### R-16 · Pérdida de mensajes durante el cambio del webhook

**Probabilidad:** Media · **Impacto:** Bajo · **Dueño:** Novasys

Repuntar el webhook de WhatsApp es una operación disruptiva. Durante la ventana de cambio pueden perderse mensajes entrantes.

**Mitigación:** ejecutar fuera del horario de atención, avisar a los asesores y verificar inmediatamente después con un mensaje de prueba al número **+51 953 730 189**.

---

### R-17 · Pérdida de trabajo por operaciones de git destructivas

**Probabilidad:** Baja · **Impacto:** Bajo · **Dueño:** Novasys

Ya ocurrió una vez: el 19 de junio de 2026 una operación de limpieza barrió 193 archivos sin confirmar. Se recuperaron.

**Mitigación:** confirmar cambios con frecuencia; el gate de integración continua bloquea la fusión con pruebas en rojo; nadie ejecuta operaciones destructivas de git sobre trabajo sin confirmar.

---

## 6. Rutina de gestión

| Cuándo                      | Qué                                                             | Quién                       |
| --------------------------- | --------------------------------------------------------------- | --------------------------- |
| Semanal, 20 min             | Semáforo de los ítems del acta de compromisos                   | Zhenia Loyola + Miguel Vega |
| Semanal                     | Revisión de R-01, R-02, R-03 y R-07                             | Equipo de proyecto          |
| Al cierre de cada fase      | Revisión completa de la matriz y reevaluación de probabilidades | Ambas partes                |
| Diario durante el hypercare | Cola de errores, duplicados y salud del número de WhatsApp      | Novasys                     |

**Regla de escalamiento:** un ítem del acta con 5 días hábiles de retraso escala a Paul De Rutte. Un riesgo que sube a exposición crítica se comunica en 24 horas, sin esperar a la reunión semanal.
