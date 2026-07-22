# Análisis de brechas — ARIA en UDEP

**Versión:** 1.0 · **Fecha:** 22 de julio de 2026
**Pregunta que responde:** ¿qué distancia hay entre lo que existe hoy y lo que UDEP necesita para operar en producción?

---

## 1. Lectura rápida

De los 29 requerimientos levantados el 17 de junio de 2026, **26 están cubiertos y verificados**, 2 dependen de una acción externa y 1 sigue abierto por definir.

| Estado                                   | Cantidad | Cuáles                                                                                                                                           |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cubierto y verificado en vivo            | 24       | R1, R2, R3, R6, R7, R8, R9, R10, R12, R14, R15, R16, R17, R18, R19, R21, R22, R23, R24, R26, R27, R28, R29 y la programación de campañas (nuevo) |
| Construido, esperando una acción de UDEP | 4        | R4, R5, R13, R25                                                                                                                                 |
| Parcial                                  | 1        | R11                                                                                                                                              |
| Abierto por definir                      | 1        | R20                                                                                                                                              |

**La conclusión importante:** no hay brechas de construcción en el camino crítico. Las brechas que quedan son de habilitación (falta un acceso), de definición (falta una decisión) o de proceso (falta un documento). Se cierran con coordinación, no con desarrollo.

---

## 2. Brechas funcionales

### B-F1 · Estado de entrega de WhatsApp limitado por el número anclado a Connect

**Requerimiento:** R5 · **Severidad:** Alta · **Tipo:** restricción de arquitectura, no defecto

_Lo que hay:_ el módulo de deliverability está completo — estado por mensaje, salud del número, cuarentena automática de números inválidos y analítica de Meta.

_Lo que falta:_ que el número esté conectado en modo standalone. AWS End User Messaging admite un solo _event destination_ por WABA, así que capturar `statuses[]` y mantener el entrante por contact flow de Connect son mutuamente excluyentes.

_Cómo se cierra:_ conectar el número **+51 908 825 660** en modo Meta standalone para lo saliente, y dejar el número legacy anclado a Connect solo para voz entrante.

_Si no se cierra:_ el reporte de primera respuesta (R17) no puede medir la respuesta del cliente en los números anclados. La plataforma lo indica explícitamente con el marcador `inboundTracked` en vez de mostrar una cifra inventada — que es la conducta correcta, pero deja el dato sin cubrir.

---

### B-F2 · El write-back de golpes a Salesforce está inactivo

**Requerimiento:** R4 · **Severidad:** Alta · **Tipo:** falta un acceso

_Lo que hay:_ el código está desplegado y probado. El ledger registra cada golpe y calcula la atribución hasta la conversión.

_Lo que falta:_ los campos personalizados en el objeto Lead de Salesforce. ARIA deliberadamente **no los crea** — así se acordó en R24, porque escribir esquema en el CRM del cliente sin su control es una mala práctica.

Campos requeridos: `VoxTouches__c` (numérico), `VoxLastTouch__c` (fecha), `VoxFirstTouch__c` (fecha), `VoxConverted__c` (casilla), `VoxTouchesToClose__c` (numérico), `VoxDaysToClose__c` (numérico) y `VoxLeadId__c` (texto, identificador externo).

_Si no se cierra:_ la sincronización sigue funcionando y degrada con gracia — detecta el campo faltante, lo descarta y reintenta. Lo que se pierde es la métrica de "cuántos golpes hasta la conversión" dentro de Salesforce. Dentro de ARIA el dato sí está.

---

### B-F3 · Comentarios de Instagram

**Requerimiento:** R13 (parcial) · **Severidad:** Media · **Tipo:** dependencia de un tercero

_Lo que hay:_ mensajes directos de Instagram y Messenger funcionando en el inbox. El código para procesar comentarios está listo.

_Lo que falta:_ suscribir el objeto `instagram` con el campo `comments` y aprobar el permiso `instagram_manage_comments` en App Review de Meta. El plazo lo define Meta.

_Cómo se cierra:_ UDEP envía la solicitud de App Review. Ya está acordado como alcance diferido.

---

### B-F4 · Multimedia en campañas de WhatsApp

**Requerimiento:** R11 · **Severidad:** Media · **Tipo:** brecha de construcción real

Es la única brecha de esta lista que requiere desarrollo, y es acotada.

_Lo que hay:_ envío de plantillas con encabezado multimedia desde el inbox y desde el módulo de plantillas.

_Lo que falta:_ llevar esa capacidad al nivel de campaña — un campo de medio por campaña, su control en el asistente de creación y el ajuste correspondiente en el discador.

_Esfuerzo estimado:_ medio (2–3 días). _Recomendación:_ incluirlo en F2, antes del UAT, porque el envío de folletos por WhatsApp es un caso de uso central para admisión.

---

### B-F5 · El set final de reportes no está definido

**Requerimiento:** R20 · **Severidad:** Media · **Tipo:** falta una decisión

_Lo que hay:_ el módulo de reportes con cinco pestañas, indicadores comparados contra el período previo, tablero por programa y exportación. En cobertura, supera al conjunto que hoy entrega Chattigo.

_Lo que falta:_ la validación de Adriana Gómez sobre cuáles son los reportes definitivos y con qué campos exactos.

_Riesgo de no cerrarlo:_ cada ajuste que aparezca durante el UAT entra como cambio tardío, cuando el costo de cambiarlo es más alto.

---

## 3. Brechas técnicas

### B-T1 · Truncamiento de paginación en cargas y consultas grandes

**Severidad:** Alta · **Dueño:** Novasys

Doce puntos de lectura truncan resultados sin avisar. Los relevantes para UDEP: el importador masivo (contadores que reportan más de lo cargado), las campañas de más de 20 000 contactos y algunos reportes que suman de menos.

_Cómo se cierra:_ corregir la paginación del importador y de los reportes antes del piloto. Verificar toda carga masiva contrastando conteos hasta entonces.

_Por qué importa acá:_ la operación de UDEP se basa en cargar bases por programa. Un contador que miente hace que nadie revise una carga fallida.

---

### B-T2 · Los procesos programados no tienen concurrencia reservada

**Severidad:** Media · **Dueño:** Novasys

Ningún proceso periódico limita su concurrencia, así que dos invocaciones solapadas son posibles. Las escrituras críticas ya usan escrituras condicionales — incluida la promoción de campañas programadas, que se implementó con esa protección desde el principio — pero la defensa correcta es también evitar el solapamiento.

_Cómo se cierra:_ fijar concurrencia reservada en 1 para los procesos periódicos. Tarea de endurecimiento, posterior al go-live.

---

### B-T3 · El webhook de Mercado Libre no valida la firma

**Severidad:** Media · **Dueño:** UDEP (entregar el secreto) + Novasys

El webhook acepta cualquier petición porque no tiene el secreto de la aplicación para validar la firma. Además falta la función de intercambio de token del flujo OAuth.

_Cómo se cierra:_ UDEP crea la App de Mercado Libre y entrega las credenciales; Novasys completa la validación y el intercambio de token.

_Mientras tanto:_ el canal está desactivado. No hay exposición real, pero el endpoint no debe habilitarse sin la validación.

---

### B-T4 · Falta limitación de tasa en los webhooks públicos

**Severidad:** Media · **Dueño:** Novasys

Los webhooks son públicos por diseño (Meta y Mercado Libre necesitan alcanzarlos). No tienen protección contra un volumen anómalo, sea por abuso o por un error de un tercero.

_Cómo se cierra:_ concurrencia reservada por función o reglas de firewall de aplicación. Endurecimiento posterior al go-live.

---

### B-T5 · Dominio de Customer Profiles fijo en el código

**Severidad:** Baja hoy, Alta al segundo cliente · **Dueño:** Novasys

El dominio `amazon-connect-novasys` está escrito directamente en unas nueve funciones, y hay claves con prefijo `udep_` acopladas a los flujos actuales.

_Por qué no bloquea:_ UDEP opera bajo el modelo BYO con sus datos en su propia cuenta de AWS, así que no hay mezcla real.

_Cómo se cierra:_ parametrizar el dominio por inquilino. Requisito previo al segundo cliente, no a este go-live.

---

## 4. Brechas de proceso y documentación

Estas eran las brechas más grandes al iniciar este trabajo. Tres de las cinco se cierran con los documentos de esta carpeta.

| #    | Brecha                                                         | Estado                                                                             |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B-P1 | No existía cronograma ni Gantt de implementación               | **Cerrada** — [01-plan-implementacion.md](01-plan-implementacion.md)               |
| B-P2 | No existía matriz de riesgos                                   | **Cerrada** — [02-matriz-riesgos.md](02-matriz-riesgos.md)                         |
| B-P3 | No existía plan de pruebas de aceptación ni criterios firmados | **Cerrada** — [04-plan-pruebas-uat.md](04-plan-pruebas-uat.md)                     |
| B-P4 | No existía acta de compromisos con fechas y responsables       | **Cerrada** — [05-acta-compromisos.md](05-acta-compromisos.md), pendiente de firma |
| B-P5 | El README del repositorio es la plantilla por defecto de Vite  | Abierta — no afecta a UDEP, es higiene interna de Novasys                          |
| B-P6 | No hay acuerdo de nivel de servicio de soporte post-go-live    | **Abierta** — debe definirse antes del go-live                                     |

**B-P6 merece atención.** La propuesta comercial incluye "soporte del año 1" sin especificar tiempos de respuesta ni canales. Para una operación de admisión con campañas de vida corta, la diferencia entre 2 horas y 2 días de respuesta es la diferencia entre perder una campaña o no. Conviene cerrarlo antes del go-live, no después del primer incidente.

---

## 5. Brechas de producto (fuera del alcance de UDEP)

Se listan para dar contexto de hacia dónde va la plataforma. Ninguna afecta esta implementación.

| Brecha                               | Qué falta                                                                   | Cuándo importa                                |
| ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| Objeto de oportunidad/negocio        | No existe la primitiva de oportunidad con etapas y pronóstico               | Al integrar HubSpot u Oracle CX               |
| Primitiva de caso o ticket con SLA   | No existe el objeto de caso                                                 | Al integrar Zendesk o Jira Service Management |
| Encuestas de satisfacción (CSAT/NPS) | No hay módulo de encuestas post-interacción                                 | Paridad competitiva                           |
| Base de conocimiento propia          | El Agente IA consume documentos, pero no hay gestor de base de conocimiento | Paridad competitiva                           |
| Marco de conectores                  | Cada integración se construye a medida                                      | Al tercer conector                            |

---

## 6. Plan de cierre de brechas

| Brecha                              | Fase         | Responsable                 | Fecha objetivo        |
| ----------------------------------- | ------------ | --------------------------- | --------------------- |
| B-F2 · Campos `Vox*__c`             | F1           | Admin Salesforce UDEP       | 14 ago                |
| B-F1 · Número Meta conectado        | F1           | Juan Gallardo + Novasys     | 21 ago                |
| B-T3 · Credenciales Mercado Libre   | F1           | UDEP                        | 21 ago                |
| B-F5 · Set de reportes definido     | F0           | Adriana Gómez               | 31 jul                |
| B-F4 · Multimedia en campañas       | F2           | Novasys                     | 28 ago                |
| B-T1 · Paginación del importador    | F2           | Novasys                     | 28 ago                |
| B-P6 · Acuerdo de nivel de servicio | F4           | Miguel Vega + Zhenia Loyola | 30 sep                |
| B-F3 · Comentarios de Instagram     | Diferido     | UDEP + Meta                 | Sin fecha             |
| B-T2, B-T4 · Endurecimiento         | Post go-live | Novasys                     | Noviembre             |
| B-T5 · Multi-inquilino              | Post go-live | Novasys                     | Previo al 2.º cliente |
