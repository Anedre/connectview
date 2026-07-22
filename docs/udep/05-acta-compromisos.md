# Acta de compromisos — implementación ARIA en UDEP

**Versión:** 1.0 (borrador para firma) · **Fecha:** 22 de julio de 2026

Este documento es el que gobierna la fecha de go-live. El cronograma de [01-plan-implementacion.md](01-plan-implementacion.md) es válido mientras se cumplan las fechas de esta acta; cada día de retraso en un ítem de la ruta crítica desplaza el go-live un día.

---

## 1. Responsables

### Universidad de Piura

| Rol en el proyecto           | Persona                 | Responsabilidad                                                       |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------- |
| Patrocinadora                | Zhenia Loyola           | Decisiones de alcance, priorización, firma de aceptación              |
| Jefatura de asesores         | Paul De Rutte           | Disponibilidad de asesores para UAT y capacitación                    |
| Marketing y automatización   | Adriana Gómez           | Definición de reportes, formularios de Meta, contenidos de plantillas |
| Técnico                      | Juan Gallardo           | Accesos, número de WhatsApp, coordinación con TI                      |
| Administración de Salesforce | Carlos Olortiga / Julio | Sandbox, campos personalizados, permisos                              |
| TI / Identidad               | Por designar            | Metadata del proveedor de identidad para SSO                          |

> **Pendiente:** designar al responsable de TI para el SSO. Sin esa persona nombrada, el ítem C-04 no tiene dueño y no se puede comprometer una fecha.

### Novasys

| Rol                   | Persona      | Responsabilidad                                           |
| --------------------- | ------------ | --------------------------------------------------------- |
| Responsable comercial | Miguel Vega  | Relación, alcance contractual, escalamiento               |
| Responsable técnico   | Andre Alata  | Configuración, integración, pruebas, capacitación técnica |
| Coordinación          | Yubiry Terán | Agenda, actas, seguimiento                                |

---

## 2. Compromisos de UDEP

| #    | Compromiso                                                                                                                             | Responsable             | Fecha límite         | Bloquea                                                      | Estado       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------- | ------------------------------------------------------------ | ------------ |
| C-01 | Entregar acceso al **Developer Sandbox de Salesforce** con permisos de administrador                                                   | Carlos Olortiga / Julio | **31 jul**           | Toda la integración con Salesforce (F3)                      | ⬜ Pendiente |
| C-02 | Crear los 7 campos personalizados `Vox*__c` en el objeto Lead                                                                          | Carlos Olortiga / Julio | **14 ago**           | Write-back de golpes (R4)                                    | ⬜ Pendiente |
| C-03 | Habilitar el número Meta **+51 908 825 660** en modo standalone y confirmar el webhook                                                 | Juan Gallardo           | **21 ago**           | Estado de entrega de WhatsApp (R5)                           | ⬜ Pendiente |
| C-04 | Entregar metadata SAML o credenciales OIDC del proveedor de identidad                                                                  | TI (por designar)       | **21 ago**           | Login federado                                               | ⬜ Pendiente |
| C-05 | Definir el set final de reportes y sus campos                                                                                          | Adriana Gómez           | **31 jul**           | Configuración de reportes (R20)                              | ⬜ Pendiente |
| C-06 | Enviar 5 programas de ejemplo y el layout programa ↔ cursos                                                                            | Zhenia Loyola           | **31 jul**           | Validación del modelo de programa                            | ⬜ Pendiente |
| C-07 | Enviar capturas de los formularios de Meta Lead Ads en uso                                                                             | Adriana Gómez           | **31 jul**           | Mapeo de la ingesta de leads                                 | ⬜ Pendiente |
| C-08 | Entregar 2–3 imágenes por tarjeta para las plantillas de carrusel                                                                      | Marketing               | **14 ago**           | Plantillas de carrusel                                       | ⬜ Pendiente |
| C-09 | Crear la App de Mercado Libre y entregar credenciales                                                                                  | Juan Gallardo           | **21 ago**           | Canal Mercado Libre                                          | ⬜ Pendiente |
| C-10 | Designar 3–5 asesores para el UAT, media jornada durante 2 semanas                                                                     | Paul De Rutte           | **4 sep**            | UAT (F4)                                                     | ⬜ Pendiente |
| C-11 | Entregar la base de contactos de prueba (200 filas reales anonimizadas)                                                                | Adriana Gómez           | **21 ago**           | Pruebas de carga masiva                                      | ⬜ Pendiente |
| C-12 | Confirmar la ventana de mantenimiento para el cambio de webhook                                                                        | Juan Gallardo           | **14 ago**           | Activación de WhatsApp                                       | ⬜ Pendiente |
| C-13 | Solicitar el App Review de Meta para comentarios de Instagram                                                                          | Adriana Gómez           | Sin fecha (diferido) | Comentarios de Instagram                                     | ⬜ Diferido  |
| C-14 | Volver a aplicar la plantilla de conexión de Amazon Connect (CloudFormation, un clic) para conceder `connect:DescribeHoursOfOperation` | Juan Gallardo           | **14 ago**           | Que las campañas usen el horario de atención real de Connect | ⬜ Pendiente |

---

## 3. Compromisos de Novasys

| #    | Compromiso                                                     | Responsable | Fecha límite | Estado                                                                 |
| ---- | -------------------------------------------------------------- | ----------- | ------------ | ---------------------------------------------------------------------- |
| N-01 | Entregar guías paso a paso para cada compromiso de UDEP        | Andre Alata | **25 jul**   | ✅ Entregado (`design/go-live-runbook.md`, `design/sso-setup-udep.md`) |
| N-02 | Corregir la paginación del importador masivo y de los reportes | Andre Alata | **28 ago**   | ⬜ Pendiente                                                           |
| N-03 | Añadir multimedia a nivel de campaña de WhatsApp (R11)         | Andre Alata | **28 ago**   | ⬜ Pendiente                                                           |
| N-04 | Cargar los ~56 programas con su taxonomía                      | Andre Alata | **21 ago**   | ⬜ Pendiente                                                           |
| N-05 | Configurar usuarios, roles y matriz de permisos                | Andre Alata | **17 ago**   | ⬜ Pendiente                                                           |
| N-06 | Enviar las plantillas de WhatsApp a aprobación de Meta         | Andre Alata | **21 ago**   | ⬜ Pendiente                                                           |
| N-07 | Ejecutar las pruebas técnicas del plan de UAT                  | Andre Alata | **11 sep**   | ⬜ Pendiente                                                           |
| N-08 | Capacitar a asesores, supervisores y administradores           | Andre Alata | **2 oct**    | ⬜ Pendiente                                                           |
| N-09 | Confirmar precios de telefonía Perú y WhatsApp marketing       | Miguel Vega | **4 sep**    | ⬜ Pendiente                                                           |
| N-10 | Proponer el acuerdo de nivel de servicio de soporte            | Miguel Vega | **11 sep**   | ⬜ Pendiente                                                           |
| N-11 | Soporte reforzado durante el hypercare                         | Novasys     | **30 oct**   | ⬜ Pendiente                                                           |

---

## 4. Qué pasa si un compromiso no se cumple

Cada ítem tiene una consecuencia definida por adelantado, para evitar discutirla en caliente.

| Compromiso               | Si no se cumple en fecha                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 Sandbox             | Las pruebas de integración se hacen contra la org de Novasys. Riesgo residual: diferencias de esquema detectadas tarde                                                |
| C-02 Campos `Vox*__c`    | El write-back queda inactivo. La plataforma sigue funcionando; R4 no se demuestra en Salesforce                                                                       |
| C-03 Número Meta         | Sin estado de entrega por mensaje. El reporte de deliverability queda parcial y R17 no es medible                                                                     |
| C-04 IdP                 | El acceso se hace con usuario y contraseña de Cognito. Sin impacto funcional                                                                                          |
| C-05 Reportes            | Los ajustes entran durante el UAT como cambios tardíos, con mayor costo                                                                                               |
| C-08 Imágenes            | Las plantillas de carrusel no se envían a aprobación. Se usan plantillas de texto                                                                                     |
| C-09 Mercado Libre       | El canal no se activa. Se difiere                                                                                                                                     |
| C-10 Asesores            | El UAT se hace con datos sintéticos. **El riesgo se traslada al go-live**                                                                                             |
| C-14 Permiso de horarios | Las campañas no pueden leer el horario de atención de Connect y siguen usando una ventana propia configurada a mano, que puede quedar desincronizada del horario real |

**Regla de escalamiento:** un compromiso con 5 días hábiles de retraso escala a Paul De Rutte y se registra en el acta de la reunión semanal.

---

## 5. Gobierno del proyecto

| Instancia               | Frecuencia             | Participantes                                          | Duración |
| ----------------------- | ---------------------- | ------------------------------------------------------ | -------- |
| Semáforo de compromisos | Semanal                | Zhenia Loyola, Juan Gallardo, Miguel Vega, Andre Alata | 20 min   |
| Revisión de fase        | Al cierre de cada fase | Todos los responsables                                 | 60 min   |
| Comité de escalamiento  | Bajo demanda           | Paul De Rutte, Zhenia Loyola, Miguel Vega              | 30 min   |

---

## 6. Alcance explícitamente excluido

Para evitar expectativas no dichas, esto **no** forma parte de la implementación:

- Migración del histórico de conversaciones de Chattigo.
- Reemplazo de Salesforce (se mantiene como sistema de registro).
- Reemplazo de Pardot para correo masivo.
- Integración con sistemas académicos de UDEP.
- Desarrollo de reportes fuera del set acordado en C-05.
- Comentarios de Instagram (diferido a la aprobación de Meta).
- Sincronización automática de etapas Salesforce ↔ ARIA (acordado como manual).

---

## 7. Firmas

| Parte   | Nombre        | Cargo | Fecha | Firma |
| ------- | ------------- | ----- | ----- | ----- |
| UDEP    | Zhenia Loyola |       |       |       |
| UDEP    | Paul De Rutte |       |       |       |
| Novasys | Miguel Vega   |       |       |       |
| Novasys | Andre Alata   |       |       |       |

---

_Documento vivo: el estado de cada compromiso se actualiza en la reunión semanal. La versión firmada de la tabla de fechas es la que rige._
