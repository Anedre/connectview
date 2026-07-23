# Plan de pruebas y aceptación — ARIA en UDEP

**Versión:** 2.0 · **Fecha:** 23 de julio de 2026
**Ejecutan:** asesores, supervisores y administradores de UDEP, con acompañamiento de Novasys.
**Alcance:** verificación funcional de punta a punta antes del piloto.

---

## 1. Cómo usar este documento

Este no es un checklist de escritorio: es un guion de ejecución. Cada caso indica quién lo hace, qué se necesita antes de empezar, los pasos exactos, qué debe verse en pantalla y cuándo se da por aprobado.

**Reglas de ejecución**

1. **Los casos se ejecutan en orden dentro de cada bloque.** Muchos dependen del anterior: no se puede probar una campaña sin haber cargado leads.
2. **No se salta un caso bloqueado.** Si un caso no se puede ejecutar, se registra como _Bloqueado_ con el motivo y se sigue con el siguiente. Al final se listan todos los bloqueados.
3. **Cada caso lo ejecuta la persona que indica el campo "Ejecuta".** Novasys acompaña pero no ejecuta los casos marcados como Asesor: el punto es descubrir qué pasa cuando lo hace quien no construyó el sistema.
4. **El resultado se registra apenas termina el caso**, no al final del día. Un "creo que funcionó" a las seis de la tarde no sirve como evidencia.
5. **Todo hallazgo lleva evidencia:** captura de pantalla, o el identificador del contacto, lead o campaña involucrado.

**Cómo registrar el resultado**

Al pie de cada caso hay una línea como esta:

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

Se marca una sola casilla. Si es _Falla_ o _Bloqueado_, se anota el número del registro de hallazgos (sección 16) y se describe ahí, no al margen.

---

## 2. Convenciones de la interfaz

Estas cuatro cosas evitan la mayoría de los "no encuentro el botón".

**Los botones de acción están arriba a la derecha, en la barra superior** — no dentro de la página. «Nueva campaña», «Importar», «Nuevo lead», «Actualizar» y el buscador viven ahí, junto al selector de programa y al estado del agente. Cuando este documento dice _pulsa «Nueva campaña»_, es ahí.

**La ubicación se lee en la migaja.** Arriba a la izquierda aparece `Sección › Página`, por ejemplo `Crecimiento › Campañas`. Es la forma de confirmar dónde estás parado.

**El selector de programa filtra casi todo.** El control de la barra superior condiciona lo que se ve en Leads, Campañas y Reportes. Si un lead "desapareció", lo primero es revisar si el programa activo es el correcto; para ver todo se elige «Todos los programas».

**Buscador rápido con Ctrl+K.** Abre un buscador de comandos: escribir "Campañas" y pulsar Enter navega directo. Ahorra tiempo durante las pruebas.

**Vocabulario que no coincide entre pantallas.** La matriz de permisos (Configuración → Seguridad) llama «Bots», «Journeys» y «Automatizaciones» a lo que el menú lateral muestra como «Asistentes» y «Flujos». Es lo mismo. Se aclara porque genera dudas la primera semana.

---

## 3. Preparación del entorno

Se completa **antes** del primer caso. Si algo falta, los bloques afectados quedan bloqueados, y eso conviene saberlo con anticipación y no el día de la prueba.

| #    | Requisito                                                           | Responsable       | Bloquea          |
| ---- | ------------------------------------------------------------------- | ----------------- | ---------------- |
| E-1  | Cuentas creadas en ARIA para todos los participantes, con su rol    | Admin UDEP        | Todo             |
| E-2  | Cada persona entró al menos una vez y cambió su contraseña inicial  | Cada participante | Todo             |
| E-3  | Micrófono y audio probados en el equipo de cada asesor              | Cada asesor       | Bloque D         |
| E-4  | Navegador Chrome o Edge actualizado                                 | Cada asesor       | Todo             |
| E-5  | Sandbox de Salesforce accesible con usuario administrador           | Admin Salesforce  | Bloque G         |
| E-6  | Campos `Vox*__c` creados en el objeto Lead de Salesforce            | Admin Salesforce  | G-04             |
| E-7  | Número de WhatsApp conectado en modo Meta standalone                | Juan Gallardo     | Bloque F         |
| E-8  | Plantilla de WhatsApp aprobada por Meta y visible en ARIA           | Novasys           | F-01             |
| E-9  | Plantilla de conexión de Connect re-aplicada (permisos de horarios) | Juan Gallardo     | E-03, E-04, E-05 |
| E-10 | Al menos un horario de atención definido en Amazon Connect          | Admin Connect     | Bloque E         |
| E-11 | Archivos de prueba descargados en el equipo que ejecuta (sección 4) | Novasys entrega   | Bloque C         |
| E-12 | Formularios de Meta Lead Ads identificados y accesibles             | Adriana Gómez     | H-01             |

**Comprobación de que el entorno está listo:** entrar a ARIA, confirmar que el menú lateral muestra las secciones esperadas para tu rol, y que la barra superior **no** muestra el chip «Configura Connect».

---

## 4. Datos de prueba

### Archivos

Novasys entrega tres archivos. Deben ser **`.csv`** — ARIA no lee `.xlsx`, así que un archivo que venga de Excel hay que exportarlo como CSV primero.

| Archivo                | Contenido                                                                                   | Para qué                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `udep-base-limpia.csv` | 200 filas reales anonimizadas: teléfono, nombre, programa, origen                           | Carga normal                                  |
| `udep-base-sucia.csv`  | 20 filas con errores deliberados: teléfonos mal formados, duplicados, una fila sin teléfono | Ver qué hace el sistema con datos imperfectos |
| `udep-base-grande.csv` | 5 000 filas                                                                                 | Comprobar que no se trunca la carga           |

> El archivo con errores es indispensable. Una prueba que solo usa datos limpios no prueba nada: lo que rompe una operación real es la fila 4 300 que traía el teléfono con un espacio en medio.

### Valores fijos

| Elemento                                  | Valor                | Regla                                      |
| ----------------------------------------- | -------------------- | ------------------------------------------ |
| Número para pruebas de WhatsApp saliente  | **+51 953 730 189**  | Todos los envíos de prueba van acá         |
| Número Meta de UDEP                       | **+51 908 825 660**  | El que envía                               |
| Número en lista de no contactar           | +51 900 000 001      | **No borrar** — es la semilla de F-06      |
| Documento semilla de base de conocimiento | FAQ ADM-2026-ZX9     | **No borrar** — lo usa el Agente IA        |
| Programa de prueba                        | «UDEP QA — Posgrado» | Se crea en B-01                            |
| Segundo programa                          | «UDEP QA — Idiomas»  | Para probar el aislamiento entre programas |

### Cuentas necesarias

| Rol        | Para qué              | Cuántas       |
| ---------- | --------------------- | ------------- |
| Agente     | Bloques C, D, F, J    | 3 como mínimo |
| Supervisor | Bloques D, E, I, K    | 1             |
| Admin      | Bloques A, B, E, G, H | 1             |

---

## 5. Bloque A · Acceso, roles y permisos

### A-01 · Cada persona entra con su cuenta

**Severidad:** Crítica · **Ejecuta:** cada participante · **Duración:** 5 min por persona

**Precondiciones:** E-1 y E-2 completos.

**Pasos**

1. Abre Chrome o Edge y entra a la dirección de ARIA que entregó Novasys.
2. Escribe tu correo y tu contraseña.
3. Pulsa «Iniciar sesión».
4. Si es tu primer ingreso, el sistema pide cambiar la contraseña: elige una nueva y confírmala.
5. Espera a que cargue la pantalla principal.

**Qué debe pasar**

- Entras sin errores y ves el menú lateral a la izquierda.
- Arriba a la izquierda aparece la migaja `Operación › Inicio`.
- Arriba a la derecha ves tu estado de agente y el selector de programa.

**Verificación adicional:** pulsa el botón de cuenta abajo a la izquierda y confirma que muestra tu nombre.

**Aprueba si:** entraste, ves el menú y no hay mensajes de error.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### A-02 · Cada rol ve solo lo que le corresponde

**Requerimiento:** R29 · **Severidad:** Alta · **Ejecuta:** un asesor, un supervisor y un admin · **Duración:** 15 min

**Precondiciones:** A-01 aprobado para los tres perfiles.

**Pasos**

1. Entra con la cuenta de **asesor**. Anota qué secciones ves en el menú lateral.
2. Cierra sesión (botón de cuenta abajo a la izquierda → «Cerrar sesión»).
3. Entra con la cuenta de **supervisor**. Anota las secciones.
4. Cierra sesión y entra con la cuenta de **admin**. Anota las secciones.

**Qué debe pasar**

- El **asesor** ve: Inicio, Agent Desktop, Conversaciones. No ve Configuración.
- El **supervisor** ve además: Cola en vivo, Programas, Campañas, Reportes, Grabaciones. No ve Configuración.
- El **admin** ve todo, incluida Configuración.

**Verificación adicional:** con la sesión de asesor, escribe manualmente `/admin` al final de la dirección del navegador. Debe rechazar el acceso, no mostrar la configuración.

**Aprueba si:** cada rol ve exactamente su conjunto y el atajo por dirección no salta el control.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### A-03 · Cambiar un permiso se aplica en vivo

**Severidad:** Media · **Ejecuta:** Admin · **Duración:** 10 min

**Pasos**

1. Entra como admin a **Configuración** → sección **Seguridad**.
2. En la tarjeta «Permisos por rol», busca la capacidad **Reportes** dentro de «Acceso a secciones».
3. Cámbiala de «Supervisor+» a «Solo Admin».
4. Pulsa «Guardar» y espera la confirmación.
5. En otra ventana (o en incógnito), entra con la cuenta de supervisor.
6. Revisa el menú lateral.
7. Vuelve a la sesión de admin, devuelve el permiso a «Supervisor+» y guarda.

**Qué debe pasar**

- Tras el paso 3 aparece el chip «Sin guardar»; desaparece al guardar.
- En el paso 6 el supervisor **ya no ve** «Reportes».
- Tras el paso 7 vuelve a verlo (puede requerir recargar la página).

**Aprueba si:** el cambio se refleja sin reinstalar ni reiniciar nada, y se puede revertir.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### A-04 · Un usuario nuevo recibe su invitación y entra

**Severidad:** Media · **Ejecuta:** Admin · **Duración:** 10 min

**Pasos**

1. Ve a **Configuración** → **Usuarios y roles**.
2. En la tarjeta «Equipo de ARIA», pulsa «Invitar usuario».
3. Completa «Nombre del trabajador» y «Email del trabajador» con una dirección real a la que tengas acceso.
4. Elige el rol **Agente**.
5. Envía la invitación.
6. Abre ese correo y sigue las instrucciones.
7. Entra a ARIA con la cuenta nueva.

**Qué debe pasar**

- El correo llega en menos de cinco minutos.
- La cuenta entra y ve solo las secciones de agente.

**Verificación adicional:** vuelve a Usuarios y roles y confirma que aparece listado con el rol Agente.

**Aprueba si:** el correo llegó, la cuenta entró y su rol es el asignado.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 6. Bloque B · Programas y tipificación

### B-01 · Crear los programas de prueba

**Requerimiento:** R1 · **Severidad:** Crítica · **Ejecuta:** Admin · **Duración:** 10 min

**Pasos**

1. Ve a **Programas** en el menú lateral.
2. En la barra superior, pulsa «Nuevo programa».
3. Completa código `qa-posgrado-01` y nombre «UDEP QA — Posgrado».
4. Asigna la facultad correspondiente y guarda.
5. Repite los pasos 2 a 4 con `qa-idiomas-01` y «UDEP QA — Idiomas».
6. En la tarjeta de cada programa nuevo, pulsa «Activar».

**Qué debe pasar**

- Ambos programas aparecen con estado **Activo**.
- El selector de programa de la barra superior ya los ofrece.

**Aprueba si:** los dos existen, están activos y se pueden elegir.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### B-02 · Las etapas del embudo son las que usa la operación

**Requerimiento:** R23 · **Severidad:** Alta · **Ejecuta:** Admin + Zhenia Loyola · **Duración:** 20 min

**Pasos**

1. Ve a **Configuración** → **Tipificación**.
2. Compara la lista de etapas contra las que hoy se usan en Salesforce.
3. Anota toda diferencia: etapas que faltan, que sobran o que se llaman distinto.
4. Ajusta las que correspondan y guarda.
5. Ve a **Leads** y confirma que las columnas del tablero reflejan las etapas.

**Qué debe pasar**

- Las etapas de ARIA coinciden con las de Salesforce en nombre y orden.
- El tablero muestra una columna por etapa.

> **Acordado con el cliente (R23):** las etapas se crean primero en Salesforce y se replican a mano acá. No hay sincronización automática, y así se acordó.

**Aprueba si:** la lista coincide con Salesforce y el tablero la refleja.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### B-03 · Importar los programas reales

**Requerimiento:** R3 · **Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 15 min

**Precondiciones:** CSV con los ~56 programas (columnas: código, nombre, facultad).

**Pasos**

1. Ve a **Programas**.
2. En la barra superior, pulsa «Importar CSV».
3. Selecciona el archivo.
4. Revisa la vista previa: confirma que código, nombre y facultad caen en la columna correcta.
5. Confirma la importación.
6. Filtra por una facultad y cuenta los programas.

**Qué debe pasar**

- El total importado coincide con las filas del archivo.
- El filtro por facultad devuelve los correctos.
- Los programas entran en estado **Borrador**: hay que activarlos explícitamente.

**Verificación adicional:** abre el archivo y cuenta las filas. El número debe coincidir exactamente con lo importado.

**Aprueba si:** los conteos coinciden y ningún programa quedó con el nombre en el campo del código.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 7. Bloque C · Carga y gestión de leads

Este bloque es el que más importa para la operación diaria: todo empieza con una base cargada.

### C-01 · Importar la base limpia a un programa

**Requerimiento:** R3 · **Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 15 min

**Precondiciones:** B-01 aprobado. Archivo `udep-base-limpia.csv` en el equipo.

**Pasos**

1. Ve a **Leads**.
2. En la barra superior, pulsa «Importar».
3. En el modal «Importar leads (CSV)», pulsa «Haz clic para subir tu CSV».
4. Elige `udep-base-limpia.csv`.
5. Espera el resumen. **Anota el número de «contactos» y el de «saltados».**
6. En «Programa destino», elige «UDEP QA — Posgrado».
7. Revisa «Mapeo de columnas»: confirma que Estado, Agente y Origen apuntan a la columna correcta del archivo. Corrige lo que esté mal.
8. En la etapa destino, elige «Nuevo lead».
9. Pulsa «Importar N leads».
10. **Anota los números del mensaje final:** nuevos y actualizados.

**Qué debe pasar**

- El paso 5 muestra 200 contactos y 0 saltados.
- El paso 10 confirma «Importados: 200 nuevos · 0 actualizados», con la línea «En "UDEP QA — Posgrado"».
- El tablero muestra los 200 en la columna «Nuevo lead».

**Verificación adicional — la más importante de este caso:** abre `udep-base-limpia.csv` en Excel y cuenta las filas con datos, sin contar el encabezado. **Ese número debe ser exactamente igual al que reportó ARIA.** Si ARIA dice 200 y el archivo tiene 203, hay un problema aunque el mensaje diga "éxito".

**Aprueba si:** los tres números coinciden — filas del archivo, contactos detectados e importados.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-02 · Importar la misma base dos veces no duplica

**Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 10 min

**Precondiciones:** C-01 aprobado.

**Pasos**

1. Anota cuántos leads hay ahora en «UDEP QA — Posgrado».
2. Repite exactamente el proceso de C-01, con el mismo archivo y el mismo programa.
3. Lee el mensaje de confirmación.
4. Vuelve al tablero y cuenta los leads del programa.

**Qué debe pasar**

- El mensaje dice «0 nuevos · 200 actualizados» o similar: reconoce que ya existían.
- El total **no cambió**: siguen siendo 200, no 400.

**Aprueba si:** el total no se duplicó y el sistema informó que eran actualizaciones.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-03 · Qué hace el sistema con una base sucia

**Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 15 min

**Precondiciones:** archivo `udep-base-sucia.csv`.

**Pasos**

1. Ve a **Leads** → «Importar».
2. Sube `udep-base-sucia.csv`.
3. **Antes de confirmar**, lee con atención el resumen: cuántos detectó y cuántos saltó.
4. Anota ambos números.
5. Confirma la importación.
6. Busca en el tablero uno de los teléfonos que sabías mal formados.

**Qué debe pasar**

- El resumen declara cuántas filas se saltaron y por qué: sin teléfono válido, o duplicadas.
- Las filas con teléfono mal formado **no** entran como leads.
- Las filas válidas sí entran.
- El sistema **no** falla ni se queda cargando: procesa lo que puede e informa el resto.

**Verificación adicional:** suma importados más saltados. Debe dar el total de filas del archivo. Si no cuadra, hay filas que desaparecieron sin que nadie lo dijera — eso es un hallazgo crítico.

**Aprueba si:** los números cuadran y el sistema explicó qué descartó.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-04 · Carga masiva sin truncamiento

**Severidad:** Alta · **Ejecuta:** Asesor + Novasys · **Duración:** 20 min

**Precondiciones:** archivo `udep-base-grande.csv` con 5 000 filas.

**Pasos**

1. Ve a **Leads** → «Importar».
2. Sube `udep-base-grande.csv`.
3. Anota cuántos contactos detectó.
4. Elige el programa «UDEP QA — Idiomas» y confirma.
5. Espera a que termine. **No cierres la ventana ni navegues a otra sección mientras carga.**
6. Anota el resultado.
7. Filtra el tablero por ese programa y cuenta el total.

**Qué debe pasar**

- Detecta las 5 000 filas.
- Importa las 5 000, menos las que declare inválidas.
- El conteo del tablero coincide con lo reportado.

**Por qué existe este caso:** una carga que reporta más filas de las que guardó es peor que un error visible, porque nadie revisa una carga que dijo "éxito". Contrastar los tres números es obligatorio.

**Aprueba si:** archivo, reporte y tablero coinciden exactamente.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-05 · Los programas no se mezclan

**Requerimiento:** R1 · **Severidad:** Alta · **Ejecuta:** Asesor · **Duración:** 10 min

**Precondiciones:** C-01 y C-04 aprobados.

**Pasos**

1. En la barra superior, abre el selector de programa y elige «UDEP QA — Posgrado».
2. Ve a **Leads** y cuenta los leads visibles.
3. Cambia el selector a «UDEP QA — Idiomas» y cuenta de nuevo.
4. Cambia a «Todos los programas» y cuenta.

**Qué debe pasar**

- Cada programa muestra solo sus leads.
- «Todos los programas» muestra la suma.
- Ningún lead aparece en el programa equivocado.

**Aprueba si:** los conteos son coherentes y no hay contaminación entre programas.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-06 · Mover un lead por el embudo

**Severidad:** Alta · **Ejecuta:** Asesor · **Duración:** 10 min

**Pasos**

1. Ve a **Leads** con «UDEP QA — Posgrado» activo, en vista «Tablero».
2. Elige un lead de la columna «Nuevo lead». Anota su nombre y teléfono.
3. Arrástralo a la columna «Contactado».
4. Recarga la página (F5).
5. Búscalo por teléfono con el buscador de la barra superior.

**Qué debe pasar**

- El lead se mueve al soltarlo.
- Tras recargar **sigue** en «Contactado»: el cambio se guardó, no fue solo visual.
- El buscador lo encuentra por teléfono.

**Aprueba si:** el cambio sobrevive a la recarga.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### C-07 · Capturar un referido durante una llamada

**Requerimiento:** R8 · **Severidad:** Alta · **Ejecuta:** Asesor · **Duración:** 10 min

**Pasos**

1. Ve a **Agent Desktop**.
2. En el rail junto al marcador, busca el encabezado «Más acciones».
3. Pulsa el tile «Capturar lead» (subtítulo «Referido / nuevo nº»).
4. Escribe un teléfono real de prueba en «Teléfono \*», con formato `+51...`.
5. Escribe un nombre en «Nombre».
6. En la fuente, elige «Referido».
7. Completa «Referido por (opcional)».
8. Elige el programa «UDEP QA — Posgrado».
9. Pulsa «Crear lead».

**Qué debe pasar**

- Aparece el mensaje «Lead creado → candidato en Salesforce».
- El lead aparece en **Leads**, en el programa elegido.
- Su origen indica que vino de un referido.

**Verificación adicional:** repite el caso con el mismo teléfono. Debe decir «Ese teléfono ya era lead (actualizado)», no crear uno nuevo.

**Aprueba si:** el lead se crea, queda en el programa correcto y el segundo intento no duplica.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 8. Bloque D · Campañas de voz

> **Antes de empezar:** los asesores deben tener micrófono habilitado y estado «Disponible». Las llamadas salen a números reales — usar solo teléfonos del equipo de prueba.

### D-01 · Crear una campaña que arranca al guardar

**Requerimiento:** R7 · **Severidad:** Crítica · **Ejecuta:** Admin o Supervisor · **Duración:** 20 min

**Precondiciones:** C-01 aprobado. Al menos un asesor «Disponible».

**Pasos**

1. Ve a **Campañas**.
2. En la barra superior, pulsa «Nueva campaña».
3. Escribe el nombre en el campo del encabezado: «QA — Llamadas posgrado».
4. **Paso 1 · Audiencia:** elige la pestaña «Desde Leads».
5. Filtra por el programa «UDEP QA — Posgrado».
6. Marca 5 leads cuyos teléfonos sean del equipo de prueba.
7. Pulsa «Usar 5 leads».
8. Revisa la tabla: ningún teléfono debe aparecer marcado en rojo.
9. **Paso 2 · Configuración:** en «Canal», deja «Llamada de voz».
10. En «Programa \*», elige «UDEP QA — Posgrado».
11. En «Número saliente», elige el número de UDEP.
12. En «Ruteo», deja «Flow existente» y elige el flow correspondiente.
13. En «¿Cómo se marcan los leads?», elige «Automático — 1 a la vez».
14. Abre «Personalización avanzada».
15. En «Horario de atención», elige «Uno propio de la campaña» con un rango que **incluya la hora actual** (por ejemplo 00 a 24) y todos los días marcados.
16. En «Inicio de la campaña», deja «Iniciar al guardar».
17. Confirma que la píldora del encabezado dice «Listo para lanzar».
18. En la barra superior, pulsa «Lanzar campaña».

**Qué debe pasar**

- Aparece «Campaña creada (5 contactos). Iniciando dialing…».
- Vuelves a la lista y la campaña aparece **En curso**.
- En menos de un minuto, un asesor disponible recibe la primera llamada.

**Verificación adicional:** entra al detalle y revisa la pestaña «En vivo». Los contadores de Pendientes y Marcando deben moverse.

**Aprueba si:** la campaña arrancó sola y la primera llamada llegó en menos de un minuto.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-02 · El asesor atiende y tipifica

**Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 15 min

**Precondiciones:** D-01 en curso.

**Pasos**

1. Con estado «Disponible» en **Agent Desktop**, espera la llamada.
2. Contesta cuando suene.
3. Habla unos segundos con quien atendió.
4. Confirma que en pantalla ves el nombre y los datos del contacto.
5. Cuelga.
6. En la pantalla de cierre, elige una tipificación (por ejemplo «Interesado»).
7. Escribe una nota breve y guarda.

**Qué debe pasar**

- La llamada entra con los datos del contacto ya en pantalla, no en blanco.
- Al colgar aparece la pantalla de tipificación.
- Tras guardar, vuelves a disponible y puedes recibir la siguiente.

**Verificación adicional:** ve a **Leads** y busca ese contacto. Su etapa debe reflejar la tipificación elegida.

**Aprueba si:** la llamada llegó con contexto, la tipificación se guardó y se reflejó en el lead.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-03 · Pausar y reanudar en caliente

**Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 10 min

**Pasos**

1. Con la campaña de D-01 en curso, abre su detalle.
2. En la barra superior, pulsa «Pausar».
3. Observa los contadores durante un minuto.
4. Pulsa «Reanudar» y observa de nuevo.

**Qué debe pasar**

- Al pausar, el estado cambia a **Pausada** y dejan de salir llamadas nuevas.
- Las llamadas que ya estaban en curso **no se cortan**.
- Al reanudar, vuelven a salir en menos de un minuto.

**Aprueba si:** la pausa detiene lo nuevo sin cortar lo activo, y reanudar funciona.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-04 · Llamada exclusiva por agente

**Requerimiento:** R7 · **Severidad:** Alta · **Ejecuta:** Supervisor + 2 asesores · **Duración:** 20 min

**Pasos**

1. Crea una campaña como en D-01, pero en «Conexión y exclusividad» elige **«Exclusivo por agente»**.
2. Asigna dos asesores concretos a la campaña.
3. Pide a ambos que se pongan «Disponible».
4. Lanza la campaña.
5. Observa a quién le llega cada llamada.

**Qué debe pasar**

- Cada llamada llega **solo** al agente asignado, no a cualquiera de la cola.
- Si un agente no la toma en unos 25 segundos, se corta y se reintenta con otro.

**Aprueba si:** las llamadas respetan la asignación y no las contesta un tercero.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-05 · Prioridad entre dos campañas simultáneas

**Requerimiento:** R7 · **Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 20 min

**Pasos**

1. Ten dos campañas activas a la vez, con contactos pendientes en ambas.
2. En el detalle de la primera, ajusta su prioridad a un valor alto.
3. En la segunda, ajústala a un valor bajo.
4. Observa durante diez minutos de qué campaña salen más llamadas.

**Qué debe pasar**

- La de mayor prioridad recibe una proporción notoriamente mayor de marcaciones.
- La de menor prioridad sigue marcando, pero menos.

**Aprueba si:** el reparto refleja la prioridad configurada.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-06 · Freno de emergencia

**Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 10 min

**Pasos**

1. Con una campaña en curso y llamadas activas, abre su detalle.
2. Pulsa «Colgar todas» y confirma.
3. Observa el estado de las llamadas.

**Qué debe pasar**

- Todas las llamadas en curso se cortan de inmediato.
- El contador de conectados baja a cero.
- La campaña sigue existiendo: para detenerla del todo hay que pausarla además.

**Aprueba si:** las llamadas se cortan y el supervisor recupera el control en segundos.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### D-07 · Reintento de un número que no contestó

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 45 min (con esperas)

**Pasos**

1. Crea una campaña con «Reintentar (min)» en 5 e «Intentos máximos» en 2.
2. Incluye un teléfono que sabes que **no** va a contestar (por ejemplo, un móvil apagado).
3. Lanza la campaña y anota la hora del primer intento.
4. Espera y observa cuándo vuelve a intentarlo.
5. Espera al segundo reintento.

**Qué debe pasar**

- El primer intento queda marcado como sin contestar.
- A los ~5 minutos hay un segundo intento.
- Tras el segundo, el contacto queda cerrado: no hay un tercero.

**Aprueba si:** los reintentos respetan el intervalo y el máximo configurados.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 9. Bloque E · Horarios y programación

Cubre lo construido en julio de 2026: campañas que arrancan solas y horario tomado de Amazon Connect.

### E-01 · Programar una campaña para más adelante

**Severidad:** Alta · **Ejecuta:** Admin o Supervisor · **Duración:** 15 min

**Pasos**

1. Ve a **Campañas** → «Nueva campaña».
2. Carga una audiencia pequeña (3 contactos del equipo) y completa la configuración como en D-01.
3. En «Personalización avanzada» → «Inicio de la campaña», elige **«Programar»**.
4. Aparecen dos campos, fecha y hora. Elige **hoy**, con una hora **10 minutos en el futuro**.
5. Lee la línea de ayuda: debe decir «Arranca el …» con la fecha y hora elegidas.
6. Confirma que el botón de la barra superior ahora dice **«Programar campaña»**, no «Lanzar campaña».
7. Pulsa «Programar campaña».

**Qué debe pasar**

- El mensaje dice «Campaña programada (3 contactos) — inicia …».
- La campaña aparece bajo la pestaña **«Programadas»**, con estado **Programada** y la fecha visible.
- **No sale ninguna llamada todavía.**

**Aprueba si:** quedó en espera con la fecha visible y no marcó antes de tiempo.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-02 · La campaña arranca sola

**Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 15 min (con espera)

**Precondiciones:** E-01 aprobado, con la campaña esperando.

**Pasos**

1. Abre el detalle de la campaña programada.
2. Observa el aviso: debe decir «Programada para …» y cuánto falta.
3. Ten un asesor en estado «Disponible».
4. **Espera** hasta que llegue la hora programada.
5. Observa el estado sin hacer nada.

**Qué debe pasar**

- En el minuto siguiente a la hora fijada, el estado cambia solo de **Programada** a **En curso**.
- Nadie tuvo que pulsar nada.
- Las llamadas empiezan a salir, si está dentro del horario de atención.

**Aprueba si:** arrancó sola, dentro del minuto siguiente a la hora fijada.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-03 · La campaña usa el horario de atención de Amazon Connect

**Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 20 min

**Precondiciones:** E-9 y E-10 completos.

**Pasos**

1. Ve a **Campañas** → «Nueva campaña» y llega hasta «Personalización avanzada».
2. En «Horario de atención», elige **«El de Amazon Connect»**.
3. Se despliega un selector con los horarios de la instancia. Elige el de UDEP.
4. Observa la grilla que aparece debajo: muestra la semana completa con las franjas de atención pintadas.
5. Compara la grilla contra el horario tal como está en la consola de Amazon Connect.
6. Lee el texto de ayuda: debe indicar que ese horario se edita en Connect, no en ARIA.

**Qué debe pasar**

- El selector lista los horarios reales de la instancia por su nombre.
- La grilla refleja los días y las horas configurados en Connect.
- Arriba de la grilla se indica si en este momento está dentro o fuera del horario, y cuánto falta para el próximo cambio.

**Si el selector muestra «(sin acceso)» junto a los horarios:** falta el permiso del requisito E-9. Registra el caso como _Bloqueado_ y avisa a Juan Gallardo. No es un defecto del software.

**Aprueba si:** el horario de Connect se lee correctamente y la grilla lo representa.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-04 · Cambiar el horario en Connect se refleja en ARIA

**Severidad:** Alta · **Ejecuta:** Admin Connect + Novasys · **Duración:** 20 min

**Precondiciones:** E-03 aprobado.

**Pasos**

1. Anota el horario actual tal como lo muestra ARIA.
2. Entra a la consola de Amazon Connect.
3. Modifica el horario: por ejemplo, cambia la hora de cierre de un día.
4. Guarda en Connect.
5. Vuelve a ARIA, a la misma pantalla, y **recarga la página**.
6. Espera hasta cinco minutos y recarga otra vez.

**Qué debe pasar**

- En un máximo de cinco minutos, la grilla de ARIA refleja el cambio.
- **No hizo falta tocar nada en ARIA.**

**Verificación adicional:** deshaz el cambio en Connect y confirma que ARIA vuelve al horario original.

**Aprueba si:** el cambio se propaga solo, en cinco minutos o menos.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-05 · Un feriado detiene las llamadas

**Severidad:** Alta · **Ejecuta:** Admin Connect + Novasys · **Duración:** 30 min

**Precondiciones:** E-03 aprobado.

> Este caso importa especialmente para una universidad peruana: sin él, una campaña llamaría un 28 de julio como si fuera un martes cualquiera.

**Pasos**

1. En la consola de Amazon Connect, crea una **excepción de horario** para **hoy**, con un rango que **no** incluya la hora actual — por ejemplo, de 01:00 a 02:00.
2. Guarda en Connect.
3. En ARIA, crea una campaña vinculada a ese horario, con contactos pendientes, y lánzala.
4. Espera cinco minutos.
5. Abre el detalle de la campaña.

**Qué debe pasar**

- La campaña queda **En curso** pero **no marca a nadie**.
- El detalle indica que está fuera del horario de atención.
- Al abrir la vista del horario se muestra un aviso de día especial con la fecha de hoy.

**Verificación adicional:** elimina la excepción en Connect, espera cinco minutos y confirma que la campaña empieza a marcar.

**Aprueba si:** el feriado detuvo las llamadas sin que nadie pausara la campaña, y quitarlo las reanudó.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-06 · Programar fuera del horario de atención

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 15 min

**Pasos**

1. Crea una campaña con horario de atención de lunes a viernes.
2. En «Inicio de la campaña», elige «Programar» y fija la fecha para un **domingo**.
3. Lee la línea de ayuda debajo de los campos.
4. Programa la campaña.

**Qué debe pasar**

- La ayuda advierte que ese momento cae fuera del horario y que la campaña quedará activa hasta la primera franja hábil.
- La campaña se programa igual: la advertencia informa, no bloquea.

**Aprueba si:** el sistema avisó en lugar de dejar que el usuario lo descubra el domingo.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-07 · Adelantar el arranque de una campaña programada

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 10 min

**Pasos**

1. Crea una campaña programada para mañana.
2. En la lista de campañas, abre su menú «⋯».
3. Elige «Iniciar ahora».
4. Lee el mensaje de confirmación y acepta.

**Qué debe pasar**

- Pide confirmación antes de arrancar, no lo hace de golpe.
- Tras confirmar, la campaña pasa a **En curso**.
- La fecha programada desaparece: ya no está en espera.

**Aprueba si:** pidió confirmación y el arranque anticipado funcionó.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-08 · Cancelar la programación

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 10 min

**Pasos**

1. Crea otra campaña programada para mañana, con 5 contactos.
2. En su menú «⋯», elige «Cancelar programación».
3. Ve a la pestaña «Borradores» y abre la campaña.

**Qué debe pasar**

- Sale de «Programadas» y aparece en «Borradores».
- **Los 5 contactos siguen cargados:** no se perdió el trabajo de armar la audiencia.
- Se puede volver a programar o iniciar cuando se quiera.

**Aprueba si:** volvió a borrador conservando la audiencia.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-09 · Cierre automático por vigencia

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 20 min (con espera)

**Pasos**

1. Crea una campaña con muchos contactos pendientes (por ejemplo 50).
2. En «Personalización avanzada» → «Cierre automático (opcional)», fija **hoy** con una hora **10 minutos en el futuro**.
3. Lee la ayuda: debe decir que se cierra sola en esa fecha aunque queden contactos.
4. Lanza la campaña.
5. Abre el detalle y confirma que aparece el aviso de cuándo se cierra.
6. **Espera** a que llegue la hora.

**Qué debe pasar**

- Marca normalmente hasta la hora fijada.
- Al llegar la hora pasa sola a **Terminada**, aunque queden contactos sin llamar.
- Nadie tuvo que intervenir.

**Aprueba si:** se cerró sola en la fecha fijada.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### E-10 · Fuera de horario, la campaña espera sin perder contactos

**Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 15 min

**Pasos**

1. Crea una campaña con «Uno propio de la campaña» y un horario que **no** incluya la hora actual (por ejemplo 03:00 a 04:00).
2. Lánzala con 10 contactos.
3. Abre el detalle y anota el número de pendientes.
4. Espera diez minutos y vuelve a mirar.

**Qué debe pasar**

- Queda **En curso** pero no marca.
- El detalle muestra el aviso de estar fuera del horario, con los pendientes.
- Indica cuándo se reanudará.
- **Los pendientes no se pierden ni se marcan como fallidos.**

**Verificación adicional:** el aviso ofrece un botón para forzar la marcación de inmediato. Pruébalo y confirma que empieza a llamar.

**Aprueba si:** esperó sin descartar contactos y el forzado funcionó.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 10. Bloque F · WhatsApp, supresión y conversaciones

### F-01 · Enviar una plantilla de WhatsApp

**Requerimiento:** R5 · **Severidad:** Crítica · **Ejecuta:** Admin · **Duración:** 15 min

**Precondiciones:** E-7 y E-8 completos.

**Pasos**

1. Ve a **Campañas** → «Nueva campaña».
2. En «Canal», elige **«WhatsApp»**.
3. En el Paso 1, usa «Pegar lista» y escribe `+51953730189`.
4. Pulsa «Parsear lista».
5. En el Paso 2, elige el programa y la plantilla aprobada.
6. Si la plantilla tiene variables, mapéalas a las columnas correspondientes.
7. Lanza la campaña.
8. Revisa el teléfono de pruebas.

**Qué debe pasar**

- El mensaje llega en menos de un minuto.
- El texto coincide con la plantilla y las variables están reemplazadas: no aparece `{{1}}`.

**Verificación adicional:** en el detalle de la campaña, el contador de enviados debe subir.

**Aprueba si:** el mensaje llegó bien formado.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-02 · Estado de entrega del mensaje

**Requerimiento:** R5 · **Severidad:** Crítica · **Ejecuta:** Admin · **Duración:** 15 min

**Precondiciones:** F-01 aprobado.

**Pasos**

1. Tras recibir el mensaje de F-01, **ábrelo** en el teléfono para que quede como leído.
2. Espera dos minutos.
3. En ARIA, ve a **Reportes** → pestaña «WhatsApp».
4. Busca el envío de la prueba.

**Qué debe pasar**

- El reporte muestra el mensaje como **entregado** y luego como **leído**.
- Los tiempos son coherentes con lo ocurrido.

> **Restricción conocida:** esto solo funciona con el número en modo Meta standalone. Si el número está anclado a Amazon Connect, el estado por mensaje **no se puede capturar** — es una limitación de AWS, no un defecto. Antes de registrar una falla, verifica con Novasys en qué modo está el número.

**Aprueba si:** el reporte refleja entregado y leído.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-03 · Un cliente escribe y llega al inbox

**Requerimiento:** R13 · **Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 10 min

**Pasos**

1. Desde el teléfono de pruebas, escribe un mensaje al número de WhatsApp de UDEP.
2. En ARIA, ve a **Conversaciones**.
3. Busca la conversación nueva y ábrela.
4. Responde desde ARIA.
5. Revisa el teléfono.

**Qué debe pasar**

- La conversación aparece en menos de un minuto, marcada como no leída.
- Al abrirla se ve el mensaje del cliente.
- El panel derecho muestra el contexto del cliente.
- La respuesta llega al teléfono.

**Aprueba si:** el mensaje entró, se pudo responder y la respuesta llegó.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-04 · Baja del cliente (STOP) — caso de cumplimiento

**Requerimiento:** R6 · **Severidad:** Crítica · **Ejecuta:** Asesor + Admin · **Duración:** 20 min

> Este es el caso más delicado del plan. Si falla, UDEP sigue enviando mensajes a alguien que pidió no recibirlos, con riesgo de sanción de Meta y de daño reputacional.

**Pasos**

1. Desde el teléfono de pruebas, escribe **STOP** al número de UDEP.
2. Espera la respuesta automática.
3. **Lee con atención qué responde el sistema.**
4. En ARIA, ve a **Configuración** → **Supresión** y busca ese número.
5. Crea una campaña de WhatsApp que incluya ese teléfono.
6. Antes de lanzarla, revisa la vista previa de supresión.
7. Lanza la campaña.
8. Revisa el teléfono de pruebas durante cinco minutos.

**Qué debe pasar**

- El sistema confirma la baja al cliente.
- El número aparece en la lista de supresión con el motivo de opt-out.
- La vista previa indica que ese contacto será bloqueado.
- **No llega ningún mensaje al teléfono.**

**Verificación crítica:** la confirmación al cliente («no volverás a recibir mensajes») solo debe enviarse si la baja quedó realmente guardada. Si el teléfono recibe la confirmación **y además** el mensaje de campaña, es un hallazgo crítico que bloquea el go-live.

**Verificación adicional:** escribe **ALTA** desde el mismo teléfono y confirma que se revierte la baja.

**Aprueba si:** la baja se respetó y no llegó ningún mensaje posterior.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-05 · No se envía dos veces lo mismo

**Requerimiento:** R6 · **Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 15 min

**Pasos**

1. Crea una campaña de WhatsApp con el número de pruebas y lánzala.
2. Espera a que llegue el mensaje.
3. Crea una **segunda** campaña, con la misma plantilla y el mismo número.
4. Antes de lanzarla, revisa la vista previa de supresión.
5. Lanza y revisa el teléfono.

**Qué debe pasar**

- La vista previa indica que el contacto se bloqueará por haber sido contactado recientemente.
- El segundo mensaje **no llega**.

**Aprueba si:** el guardia anti-doble-envío bloqueó el segundo.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-06 · La lista de no contactar se respeta

**Requerimiento:** R6 · **Severidad:** Crítica · **Ejecuta:** Admin · **Duración:** 10 min

**Pasos**

1. Confirma en **Configuración** → **Supresión** que **+51 900 000 001** está en la lista.
2. Crea una campaña de voz que lo incluya junto a otros dos contactos.
3. Revisa la vista previa antes de lanzar.
4. Lanza la campaña.
5. Abre el detalle y revisa el contador de suprimidos.

**Qué debe pasar**

- La vista previa lo señala como bloqueado por no contactar.
- El número **no recibe ninguna llamada**.
- El detalle lo cuenta como suprimido, no como fallido.

**Aprueba si:** no se le llamó y quedó registrado como supresión.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-07 · Horas de silencio

**Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 15 min

**Pasos**

1. Ve a **Configuración** → **Supresión**.
2. Configura horas de silencio que **incluyan** la hora actual, y guarda.
3. Crea una campaña de WhatsApp con el número de pruebas y lánzala.
4. Revisa la vista previa y el teléfono.
5. Deshaz la configuración de horas de silencio.

**Qué debe pasar**

- La vista previa indica bloqueo por estar fuera de horario.
- No llega el mensaje.
- Al quitar la restricción, el envío procede.

**Aprueba si:** las horas de silencio bloquearon el envío.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### F-08 · Cerrar una conversación

**Severidad:** Media · **Ejecuta:** Asesor · **Duración:** 10 min

**Pasos**

1. Abre una conversación atendida en **Conversaciones**.
2. Ciérrala con la acción correspondiente.
3. Desde el teléfono, envía un mensaje corto de cortesía («gracias»).
4. Observa la conversación en ARIA.

**Qué debe pasar**

- La conversación queda marcada como cerrada.
- El mensaje de cortesía **no** la reabre en bucle ni dispara al bot de nuevo.

**Aprueba si:** el cierre se respeta y no hay bucle de cortesía.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 11. Bloque G · Salesforce

**Todo este bloque requiere el sandbox (E-5).** Si no está disponible, se marca completo como bloqueado y se escala.

### G-01 · Un lead nuevo llega a Salesforce

**Requerimiento:** R24 · **Severidad:** Crítica · **Ejecuta:** Admin + Admin Salesforce · **Duración:** 15 min

**Pasos**

1. En ARIA, crea un lead nuevo con un teléfono que no exista en Salesforce.
2. Anota el teléfono y el nombre.
3. Espera dos minutos.
4. Entra al sandbox de Salesforce y busca el lead por teléfono.

**Qué debe pasar**

- El lead existe en Salesforce.
- Nombre y teléfono coinciden.
- El campo identificador de ARIA (`VoxLeadId__c`) está poblado.

**Aprueba si:** el lead llegó completo y con su identificador.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### G-02 · Sincronizar dos veces no duplica

**Severidad:** Crítica · **Ejecuta:** Admin · **Duración:** 15 min

**Pasos**

1. Toma el lead de G-01 y edita su nombre en ARIA.
2. Fuerza una sincronización.
3. Busca en Salesforce por el teléfono y cuenta los registros.

**Qué debe pasar**

- Hay **un solo** registro, no dos.
- El nombre refleja la edición hecha en ARIA.

**Aprueba si:** se actualizó el existente en lugar de crear uno nuevo.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### G-03 · Mapear un campo a otro destino

**Requerimiento:** R24 · **Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 20 min

**Pasos**

1. Ve a **Configuración** → **Integraciones** → tarjeta de Salesforce.
2. Pulsa el botón para descubrir los campos de la organización.
3. Espera a que liste los campos escribibles del objeto Lead.
4. Cambia el destino de un campo de ARIA a otro campo de Salesforce.
5. Guarda el mapeo.
6. Crea un lead nuevo con datos en ese campo y búscalo en Salesforce.

**Qué debe pasar**

- El descubrimiento lista los campos reales de la organización de UDEP.
- El valor cae en el campo elegido, **no** en el que estaba antes.

**Verificación adicional:** devuelve el mapeo a su valor original al terminar.

**Aprueba si:** el remapeo funcionó y se pudo revertir.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### G-04 · Los golpes se escriben en Salesforce

**Requerimiento:** R4 · **Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 30 min

**Precondiciones:** E-6 completo.

**Pasos**

1. Toma un lead de prueba.
2. Genera tres interacciones con él: una llamada, un WhatsApp y un cambio de etapa.
3. Espera cinco minutos.
4. Abre el lead en Salesforce.
5. Revisa `VoxTouches__c`, `VoxFirstTouch__c` y `VoxLastTouch__c`.

**Qué debe pasar**

- `VoxTouches__c` refleja el número de interacciones.
- Las fechas de primer y último contacto son coherentes.

**Si los campos no existen en Salesforce:** el caso queda bloqueado por el requisito E-6. No es un defecto: ARIA deliberadamente no crea campos en el CRM del cliente.

**Aprueba si:** los campos reflejan la actividad real.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### G-05 · La baja se propaga a Salesforce

**Severidad:** Alta · **Ejecuta:** Admin · **Duración:** 15 min

**Precondiciones:** F-04 aprobado.

**Pasos**

1. Toma el lead que se dio de baja con STOP en F-04.
2. Espera cinco minutos.
3. Ábrelo en Salesforce y revisa la casilla «No llamar» (`DoNotCall`).

**Qué debe pasar**

- La casilla está marcada en Salesforce.

**Aprueba si:** la baja hecha en WhatsApp llegó al CRM.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### G-06 · Traer cambios desde Salesforce

**Severidad:** Media · **Ejecuta:** Admin · **Duración:** 15 min

**Pasos**

1. En Salesforce, edita el nombre de un lead que existe en ambos sistemas.
2. En ARIA, ve a **Leads**.
3. En la barra superior, pulsa «Traer de SF» y espera a que termine.
4. Busca el lead.

**Qué debe pasar**

- El cambio hecho en Salesforce se refleja en ARIA.
- No se duplicó el lead.

**Aprueba si:** el cambio bajó correctamente.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 12. Bloque H · Ingesta de leads y Agente IA

### H-01 · Un lead de Meta Lead Ads llega solo

**Requerimiento:** R12 · **Severidad:** Crítica · **Ejecuta:** Adriana Gómez + Novasys · **Duración:** 20 min

**Pasos**

1. Abre uno de los formularios de Meta Lead Ads de UDEP en modo de prueba.
2. Complétalo con datos de prueba, usando el teléfono del equipo.
3. Envíalo y anota la hora exacta.
4. En ARIA, ve a **Leads** y busca por ese teléfono.
5. Revisa el teléfono de prueba.

**Qué debe pasar**

- El lead aparece en ARIA en menos de un minuto.
- Su origen indica que vino de Meta.
- Si hay mensaje de bienvenida configurado, llega al teléfono.

**Aprueba si:** el lead llegó rápido, sin pasar por Zapier.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### H-02 · Doble ingesta sin pérdida — el control que decide el corte de Zapier

**Requerimiento:** R14 · **Severidad:** Crítica · **Ejecuta:** Adriana Gómez · **Duración:** 3 días de observación

> Este caso **decide** cuándo se apaga Zapier. No se corta por calendario, se corta por evidencia.

**Pasos**

1. Durante tres días, deja funcionando **ambos** caminos: Zapier hacia Salesforce y la ingesta de ARIA.
2. Cada día, al cierre, cuenta los leads que llegaron por cada camino.
3. Anota ambos números en la tabla.
4. Al tercer día, compara los totales y revisa uno por uno los que no coincidan.

| Día | Leads vía Zapier | Leads vía ARIA | Diferencia | Explicación de la diferencia |
| --- | ---------------- | -------------- | ---------- | ---------------------------- |
| 1   |                  |                |            |                              |
| 2   |                  |                |            |                              |
| 3   |                  |                |            |                              |

**Qué debe pasar**

- Los totales coinciden, o cada diferencia tiene una explicación concreta.
- ARIA no pierde ningún lead que Zapier sí trajo.

**Aprueba si:** tres días consecutivos sin pérdidas por el lado de ARIA.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### H-03 · El Agente IA responde con la información de UDEP

**Requerimiento:** R15 · **Severidad:** Alta · **Ejecuta:** Asesor · **Duración:** 20 min

**Precondiciones:** base de conocimiento cargada, incluido FAQ ADM-2026-ZX9.

**Pasos**

1. Desde el teléfono de prueba, escribe al WhatsApp de UDEP una pregunta cubierta por la base de conocimiento, por ejemplo sobre requisitos de admisión.
2. Espera la respuesta.
3. Lee con atención: ¿la información es correcta?
4. Repite con otras tres preguntas frecuentes reales.

**Qué debe pasar**

- Responde en segundos, con información correcta.
- La respuesta indica de dónde salió: cita el documento.
- No inventa datos que no están en la base.

**Aprueba si:** las cuatro respuestas son correctas y citan su fuente.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### H-04 · El Agente IA deriva cuando no sabe

**Requerimiento:** R15 · **Severidad:** Crítica · **Ejecuta:** Asesor · **Duración:** 15 min

> Que el agente derive importa más que que responda. Un agente que inventa una fecha de examen genera un problema real con un postulante.

**Pasos**

1. Desde el teléfono de prueba, escribe una pregunta **fuera** de la base de conocimiento: algo específico que el sistema no puede saber, como un trámite administrativo particular.
2. Lee la respuesta.
3. Ve a **Conversaciones** en ARIA.

**Qué debe pasar**

- El agente **no inventa** una respuesta.
- Indica que deriva a una persona.
- La conversación aparece en el inbox para que un asesor la tome.

**Aprueba si:** derivó en vez de improvisar.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 13. Bloque I · Reportes

### I-01 · Los números del reporte cuadran

**Requerimiento:** R16 · **Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 30 min

**Pasos**

1. Elige un día con actividad de pruebas conocida.
2. Ve a **Reportes** → pestaña «Operación».
3. Fija el rango de fechas en ese día.
4. Anota el total de llamadas.
5. Ve a **Grabaciones** y cuenta manualmente las llamadas de ese día.
6. Compara.

**Qué debe pasar**

- Los números coinciden, o la diferencia se explica (por ejemplo, llamadas en curso).

**Aprueba si:** el reporte refleja la actividad real, verificada a mano.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### I-02 · Reporte filtrado por programa

**Requerimiento:** R2 · **Severidad:** Alta · **Ejecuta:** Supervisor · **Duración:** 20 min

**Pasos**

1. En la barra superior, elige el programa «UDEP QA — Posgrado».
2. Ve a **Reportes** → pestaña «Pipeline» y anota las cifras.
3. Cambia el programa a «UDEP QA — Idiomas» y anota de nuevo.
4. Cambia a «Todos los programas».

**Qué debe pasar**

- Cada programa muestra solo sus cifras.
- «Todos» muestra el consolidado.
- Los números por programa suman el total.

**Aprueba si:** el filtro funciona y las cifras son coherentes.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### I-03 · Tiempo de primera respuesta

**Requerimiento:** R17 · **Severidad:** Alta · **Ejecuta:** Adriana Gómez · **Duración:** 20 min

**Pasos**

1. Ve a **Reportes** → pestaña «WhatsApp».
2. Busca la métrica de primera respuesta.
3. Compárala con lo observado durante las pruebas del bloque F.

**Qué debe pasar**

- Muestra el dato, **o** indica explícitamente que no es medible para el número usado.

> **Restricción conocida:** para números anclados a Amazon Connect esta métrica no se puede calcular. El sistema lo señala en vez de mostrar una cifra inventada, que es la conducta correcta. Verifica con Novasys en qué modo está el número antes de registrar una falla.

**Aprueba si:** el dato es correcto, o la limitación está declarada de forma visible.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### I-04 · Exportar un reporte

**Requerimiento:** R21 · **Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 15 min

**Pasos**

1. Ve a **Reportes** → pestaña «Descargas».
2. Elige un rango de fechas con actividad.
3. Descarga el detalle de conversaciones.
4. Abre el archivo.
5. Cuenta las filas y compara con lo que muestra la pantalla.

**Qué debe pasar**

- El archivo se descarga y abre sin errores.
- **El número de filas coincide con lo que dice la pantalla:** no está truncado.
- Los acentos y la ñ se ven bien.

**Aprueba si:** el archivo está completo y legible.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### I-05 · Programar el envío automático de un reporte

**Severidad:** Media · **Ejecuta:** Adriana Gómez · **Duración:** 20 min

**Pasos**

1. Ve a **Reportes** → pestaña «Descargas».
2. Programa un envío por correo con frecuencia diaria.
3. Indica tu dirección de correo y guarda.
4. Espera al primer envío programado.

**Qué debe pasar**

- El correo llega en el horario configurado, con el archivo adjunto.
- El contenido corresponde al período indicado.

**Verificación de seguridad:** confirma que el reporte contiene **solo** datos de UDEP.

**Aprueba si:** el envío llegó a tiempo y con los datos correctos.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 14. Bloque J · Grabaciones e historial

### J-01 · Escuchar la grabación de una llamada

**Severidad:** Media · **Ejecuta:** Supervisor · **Duración:** 15 min

**Pasos**

1. Ve a **Grabaciones**.
2. Busca un contacto con el que se hizo una llamada de prueba.
3. Abre su expediente y ve a la pestaña «Llamadas».
4. Abre una llamada y reprodúcela.

**Qué debe pasar**

- El audio se reproduce sin errores.
- Se ve la transcripción.
- Los datos de la llamada (duración, agente, fecha) son correctos.

**Aprueba si:** el audio suena y la transcripción está.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

### J-02 · El historial completo del cliente

**Requerimiento:** R22 · **Severidad:** Media · **Ejecuta:** Asesor · **Duración:** 15 min

**Pasos**

1. Elige un contacto con el que hubo llamada **y** WhatsApp durante las pruebas.
2. Ábrelo en **Grabaciones**.
3. Ve a la pestaña «Resumen» y revisa la línea de tiempo.

**Qué debe pasar**

- La línea de tiempo muestra ambas interacciones, en orden cronológico.
- Se distingue el canal de cada una.

**Aprueba si:** el historial está completo y ordenado.

> **Resultado:** ☐ Pasa ☐ Falla ☐ Bloqueado — Hallazgo n.º \_\_\_\_ — Ejecutó: \_\_\_\_\_\_\_\_ — Fecha: \_\_\_\_

---

## 15. Bloque K · Prueba diaria rápida

Se ejecuta **cada mañana** durante el piloto y el hypercare. Toma diez minutos y detecta la mayoría de los problemas antes de que los note un postulante.

| #   | Comprobación            | Cómo                                                          | ☐   |
| --- | ----------------------- | ------------------------------------------------------------- | --- |
| K-1 | El sistema entra        | Iniciar sesión con una cuenta de agente                       | ☐   |
| K-2 | Amazon Connect responde | La barra superior no muestra «Configura Connect»              | ☐   |
| K-3 | Llegan mensajes         | Enviar un WhatsApp de prueba y verlo en Conversaciones        | ☐   |
| K-4 | Salen llamadas          | Una campaña activa marcando, o una llamada manual             | ☐   |
| K-5 | Los leads se ven        | Abrir Leads y confirmar que el tablero carga                  | ☐   |
| K-6 | Las campañas avanzan    | Revisar que ninguna quedó atascada sin progreso               | ☐   |
| K-7 | Los reportes cargan     | Abrir Reportes y confirmar que hay datos de ayer              | ☐   |
| K-8 | Sin duplicados          | Buscar en Leads un teléfono reciente: debe salir una sola vez | ☐   |

**Quién lo hace:** el supervisor de turno. **Dónde se registra:** en la bitácora del piloto.

---

## 16. Registro de hallazgos

Cada hallazgo se anota acá. **Lo cierra quien lo reportó**, después de verificar la corrección: Novasys no cierra sus propios hallazgos.

| N.º | Caso | Descripción breve | Severidad | Reportó | Fecha | Estado | Cerrado por |
| --- | ---- | ----------------- | --------- | ------- | ----- | ------ | ----------- |
| 1   |      |                   |           |         |       |        |             |
| 2   |      |                   |           |         |       |        |             |
| 3   |      |                   |           |         |       |        |             |
| 4   |      |                   |           |         |       |        |             |
| 5   |      |                   |           |         |       |        |             |
| 6   |      |                   |           |         |       |        |             |
| 7   |      |                   |           |         |       |        |             |
| 8   |      |                   |           |         |       |        |             |

### Cómo describir un hallazgo

Un hallazgo útil tiene cuatro cosas. Sin ellas, la corrección tarda el doble:

1. **Qué hiciste**, paso a paso, para llegar ahí.
2. **Qué esperabas** que pasara.
3. **Qué pasó** en realidad.
4. **Evidencia:** captura de pantalla, o el identificador del contacto, lead o campaña.

> Ejemplo bien descrito: «En C-01 importé `udep-base-limpia.csv` (200 filas) al programa QA Posgrado. Esperaba 200 leads. ARIA reportó "198 nuevos" y el tablero muestra 198. No indicó qué pasó con las otras 2 filas. Captura adjunta.»

### Severidad

| Nivel       | Definición                                                           | Plazo                    |
| ----------- | -------------------------------------------------------------------- | ------------------------ |
| **Crítico** | Impide operar, pierde datos o envía algo incorrecto al cliente final | Bloquea el go-live       |
| **Alto**    | Una función central no funciona como se especificó                   | Antes del go-live        |
| **Medio**   | Función secundaria degradada, con alternativa razonable              | Se acuerda caso por caso |
| **Bajo**    | Cosmético o de conveniencia                                          | Backlog                  |

---

## 17. Criterios de aceptación

El sistema se acepta cuando se cumplen las cinco condiciones:

1. **Cobertura.** Todos los casos de severidad Crítica y Alta pasan, o su desvío está aceptado por escrito.
2. **Sin hallazgos críticos abiertos.**
3. **Datos.** Los conteos de leads cargados coinciden exactamente con los archivos de origen, y ningún lead está duplicado.
4. **Adopción.** Al menos tres asesores completan una jornada real sin necesitar asistencia.
5. **Estabilidad.** Cinco días consecutivos de prueba diaria (bloque K) sin incidentes críticos.

Los casos de severidad Media que no pasen se registran y se acuerdan como corrección previa o diferida. Ninguno bloquea por sí solo.

---

## 18. Resumen de casos

| Bloque                       | Casos  | Críticos | Altos  | Medios |
| ---------------------------- | ------ | -------- | ------ | ------ |
| A · Acceso, roles y permisos | 4      | 1        | 1      | 2      |
| B · Programas y tipificación | 3      | 1        | 2      | 0      |
| C · Carga y gestión de leads | 7      | 3        | 4      | 0      |
| D · Campañas de voz          | 7      | 2        | 3      | 2      |
| E · Horarios y programación  | 10     | 0        | 6      | 4      |
| F · WhatsApp y supresión     | 8      | 4        | 3      | 1      |
| G · Salesforce               | 6      | 2        | 3      | 1      |
| H · Ingesta y Agente IA      | 4      | 3        | 1      | 0      |
| I · Reportes                 | 5      | 0        | 3      | 2      |
| J · Grabaciones              | 2      | 0        | 0      | 2      |
| **Total**                    | **56** | **16**   | **26** | **14** |

Más el bloque K, de ocho comprobaciones diarias.

---

## 19. Calendario sugerido

| Semana    | Bloques                            | Participantes                               |
| --------- | ---------------------------------- | ------------------------------------------- |
| 14–18 sep | Acompañamiento en campo + A, B, C  | 3–5 asesores + Admin + Novasys              |
| 21–25 sep | D, E, F                            | Asesores + Supervisor + Admin               |
| 28–30 sep | G, H, I, J + reprueba de hallazgos | Admin Salesforce, Adriana Gómez, Supervisor |

**Antes de empezar:** dos jornadas de acompañamiento con los asesores en su puesto de trabajo, para contrastar el flujo diseñado con el trabajo real. Lo solicitó Paul De Rutte, y es la mejor forma de descubrir los problemas de usabilidad que ninguna prueba de laboratorio encuentra.

**Nota sobre H-02:** ese caso requiere tres días de observación en paralelo y conviene arrancarlo la primera semana, no la última.

---

## 20. Acta de aceptación

Al cierre del UAT se firma el acta, con:

- Los casos ejecutados y su resultado.
- Los hallazgos abiertos, con severidad y plazo comprometido.
- Los desvíos aceptados por escrito.
- La declaración de conformidad para pasar al piloto.

**Resumen de la ejecución**

| Concepto                    | Cantidad |
| --------------------------- | -------- |
| Casos ejecutados            |          |
| Pasaron                     |          |
| Fallaron                    |          |
| Bloqueados                  |          |
| Hallazgos críticos abiertos |          |
| Hallazgos altos abiertos    |          |

**Firmas**

| Parte   | Nombre        | Cargo | Fecha | Firma |
| ------- | ------------- | ----- | ----- | ----- |
| UDEP    | Zhenia Loyola |       |       |       |
| UDEP    | Paul De Rutte |       |       |       |
| Novasys | Miguel Vega   |       |       |       |
| Novasys | Andre Alata   |       |       |       |
