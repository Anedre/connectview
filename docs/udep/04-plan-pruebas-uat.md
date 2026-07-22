# Plan de pruebas y aceptación — ARIA en UDEP

**Versión:** 1.0 · **Fecha:** 22 de julio de 2026
**Ejecutan:** asesores y supervisores de UDEP, con acompañamiento de Novasys.
**Base:** los casos de uso de admisión de posgrado documentados en `docs/comercial/casos-uso-udep.md`.

---

## 1. Alcance y criterios de aceptación global

El sistema se acepta cuando se cumplen las cuatro condiciones:

1. **Cobertura:** los 24 casos de prueba de severidad crítica y alta pasan.
2. **Estabilidad:** dos semanas de piloto sin incidentes de severidad crítica.
3. **Datos:** el conteo de leads cargados coincide exactamente con los archivos de origen, y ningún lead se duplica.
4. **Adopción:** al menos 3 asesores completan una jornada real sin necesitar asistencia.

Los casos de severidad media que no pasen se registran como hallazgos y se acuerdan como corrección previa o diferida. Ninguno bloquea por sí solo.

---

## 2. Clasificación de severidad de hallazgos

| Nivel       | Definición                                                                           | Plazo de corrección    |
| ----------- | ------------------------------------------------------------------------------------ | ---------------------- |
| **Crítico** | Impide operar, pierde datos o envía algo incorrecto al cliente final                 | Bloquea el go-live     |
| **Alto**    | Una función central no funciona como se especificó, con solución alternativa costosa | Antes del go-live      |
| **Medio**   | Función secundaria degradada o con solución alternativa razonable                    | Acordado caso por caso |
| **Bajo**    | Cosmético o de conveniencia                                                          | Backlog                |

---

## 3. Datos de prueba

| Elemento                                                 | Valor                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| Número de WhatsApp para pruebas salientes                | **+51 953 730 189**                                              |
| Número Meta standalone de UDEP                           | **+51 908 825 660**                                              |
| Número en lista de no contactar (no borrar)              | +51 900 000 001                                                  |
| Documento semilla de la base de conocimiento (no borrar) | FAQ ADM-2026-ZX9                                                 |
| Programas de prueba                                      | 2 programas con embudos distintos                                |
| Base de contactos                                        | 200 filas reales anonimizadas + 20 filas con errores deliberados |

> La base con errores deliberados es indispensable: mide qué hace el sistema con teléfonos mal formados, filas duplicadas y columnas faltantes. Una prueba que sólo usa datos limpios no prueba nada.

---

## 4. Casos de prueba

### Bloque A · Gestión de leads y programas

| #    | Caso                            | Pasos                                                              | Resultado esperado                                                                                      | Sev.    |
| ---- | ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------- |
| P-01 | Importar una base por programa  | Cargar el archivo de 200 filas asociado a un programa              | Se cargan exactamente las filas válidas; el contador coincide; las 20 con error se listan con el motivo | Crítica |
| P-02 | Deduplicación al importar       | Cargar el mismo archivo dos veces                                  | La segunda carga no crea duplicados; informa cuántos ya existían                                        | Crítica |
| P-03 | Auto-etiquetado por programa    | Importar con el programa activo seleccionado                       | Todos los leads quedan asociados a ese programa                                                         | Alta    |
| P-04 | Lead creado al vuelo (referido) | Durante una llamada, capturar un referido con el formulario rápido | El lead se crea, queda asociado al programa y aparece en el embudo                                      | Alta    |
| P-05 | Código de programa desde UTM    | Ingresar un lead con parámetro UTM de campaña                      | El programa se deduce del código UTM                                                                    | Media   |

### Bloque B · Campañas y discador

| #    | Caso                                         | Pasos                                                                        | Resultado esperado                                                                                     | Sev.    |
| ---- | -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| P-06 | Campaña con inicio inmediato                 | Crear una campaña con "Iniciar al guardar" dentro del horario                | Empieza a marcar en menos de un minuto                                                                 | Crítica |
| P-07 | **Campaña programada**                       | Crear una campaña con fecha y hora futuras                                   | Queda en estado "Programada" con la fecha visible; no marca antes                                      | Alta    |
| P-08 | **Arranque automático**                      | Esperar a que llegue la hora programada                                      | Pasa a "En curso" sola en el minuto siguiente y comienza a marcar si está dentro del horario           | Alta    |
| P-09 | **Programada fuera del horario de atención** | Programar el arranque un domingo, con horario configurado de lunes a viernes | Pasa a "En curso" el domingo pero no marca; la primera llamada sale el lunes a la hora de apertura     | Alta    |
| P-10 | **Adelantar el arranque**                    | Sobre una campaña programada, usar "Iniciar ahora"                           | Pide confirmación, arranca de inmediato y la fecha programada desaparece                               | Media   |
| P-11 | **Cancelar la programación**                 | Sobre una campaña programada, cancelar la programación                       | Vuelve a borrador conservando los contactos cargados                                                   | Media   |
| P-12 | **Visualizador de horario**                  | Abrir el horario de atención de una campaña                                  | La grilla muestra las franjas activas, marca la hora actual y dice cuánto falta para el próximo cambio | Media   |
| P-13 | Fuera de horario con pendientes              | Con una campaña en curso, esperar a que pase la hora de cierre               | Deja de marcar, muestra el aviso y reanuda sola en la siguiente franja                                 | Alta    |
| P-14 | Ruteo exclusivo por agente                   | Campaña en modo exclusivo con 2 agentes                                      | Cada llamada llega sólo al agente asignado                                                             | Alta    |
| P-15 | Prioridad entre campañas                     | Dos campañas activas con prioridades distintas                               | La de mayor prioridad recibe más marcaciones                                                           | Media   |

### Bloque C · WhatsApp y supresión

| #    | Caso                           | Pasos                                                           | Resultado esperado                                                                                     | Sev.    |
| ---- | ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| P-16 | Envío de plantilla con estado  | Enviar una plantilla al número de prueba                        | Llega, y el reporte muestra entregado y leído                                                          | Crítica |
| P-17 | **Opt-out efectivo**           | Responder STOP y luego intentar enviar una campaña a ese número | Confirma la baja **sólo tras persistirla**; el envío posterior se bloquea y queda registrado el motivo | Crítica |
| P-18 | Guardia anti-doble envío       | Lanzar dos campañas que incluyan el mismo contacto              | El segundo envío se bloquea por regla de frecuencia                                                    | Alta    |
| P-19 | Horas de silencio              | Programar un envío en horario nocturno                          | Se bloquea por horas de silencio y se reintenta al abrir                                               | Alta    |
| P-20 | Número inválido                | Incluir un número inexistente en una campaña                    | Se marca como inválido y entra en cuarentena; no se reintenta indefinidamente                          | Media   |
| P-21 | Conversación entrante al inbox | Escribir desde un número externo al número de UDEP              | Aparece en el inbox con la ficha del cliente                                                           | Crítica |
| P-22 | Cierre de conversación         | Cerrar una conversación atendida                                | Cambia de estado y no reabre por un mensaje de cortesía                                                | Media   |

### Bloque D · Salesforce

| #    | Caso                          | Pasos                                                          | Resultado esperado                                         | Sev.    |
| ---- | ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ------- |
| P-23 | Alta de lead en Salesforce    | Crear un lead en ARIA                                          | Aparece en Salesforce con el identificador externo poblado | Crítica |
| P-24 | Sin duplicados                | Sincronizar dos veces el mismo lead                            | Se actualiza, no se duplica                                | Crítica |
| P-25 | Golpes escritos               | Registrar 3 interacciones y sincronizar                        | Los campos `Vox*__c` reflejan el conteo y las fechas       | Alta    |
| P-26 | Mapeo de campos personalizado | Remapear un campo desde la interfaz y sincronizar              | El valor cae en el campo elegido y no en el estándar       | Alta    |
| P-27 | Campo inexistente             | Sincronizar con un campo mapeado que fue borrado en Salesforce | Descarta el campo, reintenta y completa; no pierde el lead | Media   |
| P-28 | No contactar propagado        | Marcar STOP en ARIA                                            | El lead de Salesforce queda con `DoNotCall` activo         | Alta    |

### Bloque E · Ingesta y Agente IA

| #    | Caso                          | Pasos                                                      | Resultado esperado                                                    | Sev.    |
| ---- | ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| P-29 | Lead de Meta Lead Ads         | Completar un formulario real de Meta                       | Llega a ARIA en menos de un minuto y dispara el mensaje de bienvenida | Crítica |
| P-30 | Doble ingesta sin pérdida     | Con Zapier todavía activo, comparar conteos durante 3 días | Ambos caminos traen los mismos leads; ninguno se pierde               | Crítica |
| P-31 | Agente IA responde con fuente | Preguntar algo cubierto por la base de conocimiento        | Responde citando el documento de origen                               | Alta    |
| P-32 | Derivación por baja confianza | Preguntar algo fuera de la base                            | Deriva a un asesor humano en vez de inventar                          | Crítica |

### Bloque F · Reportes y permisos

| #    | Caso                 | Pasos                                             | Resultado esperado                                                                         | Sev.  |
| ---- | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| P-33 | Reporte por programa | Abrir el tablero filtrado por un programa         | Las cifras cuadran con el conteo manual de ese programa                                    | Alta  |
| P-34 | Primera respuesta    | Revisar el reporte de tiempo de primera respuesta | Muestra el dato, o indica explícitamente que no es medible para números anclados a Connect | Alta  |
| P-35 | Exportación          | Exportar un reporte a archivo                     | Descarga completo, sin truncar                                                             | Media |
| P-36 | Permisos por rol     | Entrar como asesor, supervisor y administrador    | Cada rol ve sólo su menú y sus acciones; el servidor rechaza lo no permitido               | Alta  |
| P-37 | Grabaciones          | Abrir la grabación de una llamada atendida        | Reproduce y muestra la transcripción                                                       | Media |

---

## 5. Registro de hallazgos

Cada hallazgo se registra con: identificador, caso de prueba, quién lo encontró, fecha, severidad, descripción con pasos para reproducirlo, evidencia (captura o identificador de contacto), responsable y estado.

Cierre de un hallazgo: sólo lo cierra **quien lo reportó**, tras verificar la corrección. Novasys no cierra sus propios hallazgos.

---

## 6. Calendario del UAT

| Semana    | Bloques                                     | Participantes                |
| --------- | ------------------------------------------- | ---------------------------- |
| 14–18 sep | Acompañamiento en campo + bloques A y B     | 3–5 asesores + Novasys       |
| 21–25 sep | Bloques C, D y E                            | Asesores + admin Salesforce  |
| 28–30 sep | Bloque F + reprueba de hallazgos corregidos | Supervisores + Adriana Gómez |

---

## 7. Acta de aceptación

Al cierre del UAT se firma un acta con: casos ejecutados y su resultado, hallazgos abiertos con su severidad y plazo, desvíos aceptados por escrito, y la declaración de conformidad para pasar al piloto.

**Firman:** Zhenia Loyola (UDEP), Paul De Rutte (UDEP), Miguel Vega (Novasys), Andre Alata (Novasys).
