# Implementación ARIA en UDEP — documentación de proyecto

Documentos de gestión de la implementación de ARIA en la Universidad de Piura.
**Fecha de corte:** 22 de julio de 2026.

Estos documentos cubren la **activación**, no el desarrollo: los 10 pilares del alcance funcional (R1–R26) están construidos y verificados. Lo que falta es coordinación, accesos, configuración, pruebas con usuarios reales y arranque.

---

## Los documentos

| #   | Documento                                              | Responde a                                                                                |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 01  | [Plan de implementación](01-plan-implementacion.md)    | ¿Cuándo estará listo y de qué depende? Gantt, fases, ruta crítica y alcance diferido      |
| 02  | [Matriz de riesgos](02-matriz-riesgos.md)              | ¿Qué puede salir mal, cuánto duele y quién lo gestiona? 17 riesgos con dueño y mitigación |
| 03  | [Análisis de brechas](03-analisis-brechas.md)          | ¿Qué distancia hay entre lo que existe y lo que UDEP necesita?                            |
| 04  | [Plan de pruebas y aceptación](04-plan-pruebas-uat.md) | ¿Cómo se verifica que funciona? 37 casos con criterios de aceptación                      |
| 05  | [Acta de compromisos](05-acta-compromisos.md)          | ¿Quién entrega qué y cuándo? **Es el documento que gobierna la fecha**                    |

---

## Lo esencial en cinco puntos

1. **El producto está construido.** 24 de los 29 requerimientos están cubiertos y verificados en vivo. No hay desarrollo pendiente en la ruta crítica.
2. **El riesgo es de coordinación, no técnico.** Cuatro de las siete tareas de la ruta crítica dependen de una acción de UDEP: sandbox de Salesforce, campos personalizados, número de WhatsApp y disponibilidad de asesores para el UAT.
3. **Fecha objetivo de go-live: 16 de octubre de 2026**, con hypercare hasta el 30 de octubre. Válida mientras se cumplan las fechas del acta de compromisos.
4. **Hay una restricción de arquitectura que conviene entender temprano:** un número anclado a Amazon Connect no puede reportar estado de entrega por mensaje. Es una limitación de AWS, no un defecto. Se resuelve operando el número meta-standalone para lo saliente.
5. **Todo lo bloqueado degrada con gracia.** Si un acceso no llega, la plataforma sigue funcionando y se pierde una función concreta, identificada de antemano. Nada rompe.

---

## Documentación técnica relacionada

| Documento                          | Contenido                                                          |
| ---------------------------------- | ------------------------------------------------------------------ |
| `design/go-live-runbook.md`        | Procedimiento técnico de activación paso a paso                    |
| `design/sso-setup-udep.md`         | Guía de configuración del login federado                           |
| `docs/interno/runbook.md`          | Inventario de infraestructura y operación                          |
| `docs/tecnico/`                    | Arquitectura de aplicación, arquitectura física, flujo de procesos |
| `docs/comercial/casos-uso-udep.md` | Los 7 casos de uso de admisión de posgrado                         |
| `docs/costos/udep-comparativa.md`  | Comparativa de costos sobre factura real de AWS                    |

---

## Versión PDF

Los cinco documentos están también en `pdf/`, listos para enviar al cliente:
portada con índice, paginación y la identidad visual del resto de los
documentos de ARIA.

```bash
node scripts/build-udep-pdfs.mjs
```

Se regeneran desde los `.md`, así que el markdown es la fuente: editar el PDF a
mano garantiza que el próximo build lo pise. El generador dibuja el Gantt y la
ruta crítica en HTML/CSS en vez de Mermaid — no hay `mermaid-cli` en el entorno
y una grilla imprime mejor que un SVG generado por JavaScript.
