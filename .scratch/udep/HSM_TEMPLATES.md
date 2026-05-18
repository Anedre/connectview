# Plantillas HSM (Meta WhatsApp) — Universidad de Piura

Estas plantillas se usan para iniciar conversación FUERA de la ventana de 24h de WhatsApp. Hay que **registrarlas en Meta Business Manager** y esperar **aprobación de Meta** (24-72h típicamente).

## Cómo cargarlas en Meta

1. Entra a [Meta Business Suite](https://business.facebook.com/) → **WhatsApp Manager** → **Cuentas de WhatsApp Business** → tu cuenta UDEP.
2. Menú izquierdo: **Plantillas de mensajes** → **Crear plantilla**.
3. Para cada template del listado abajo, configura:
   - **Categoría**: la que indico (MARKETING / UTILITY / AUTHENTICATION)
   - **Nombre**: usa exactamente el `name` que pongo (snake_case, sin acentos)
   - **Idioma**: Spanish (Peru) — `es_PE` (o `es` si no aparece PE)
   - **Tipo de encabezado**: Texto (o ninguno)
   - **Cuerpo**: copia el bloque "Body"
   - **Variables**: las marco con `{{1}}`, `{{2}}` (numeradas, en orden de aparición)
   - **Botones**: indico el tipo (Respuesta rápida / Llamada a la acción) y el texto
4. Envía a revisión. Meta responde en 24-72h.
5. Una vez **APROBADA**, Connect puede usarla referenciándola por `name + language_code`.

---

## Plantilla 1 — `udep_welcome_new` (UTILITY)

Saludo a un lead nuevo que escribió primero — útil cuando agente quiere reabrir conversación >24h.

**Categoría**: `UTILITY`
**Nombre**: `udep_welcome_new`
**Idioma**: `es_PE`
**Encabezado**: ninguno
**Cuerpo**:
```
Hola 👋 Soy el asistente virtual de la Universidad de Piura. ¿En qué te podemos ayudar hoy con tu interés académico?
```
**Pie de página**: `UDEP — Excelencia académica · www.udep.edu.pe`
**Botones (Respuesta rápida, máx 3)**:
- `Ver oferta`
- `Costos`
- `Hablar con asesor`

---

## Plantilla 2 — `udep_welcome_hot_lead` (MARKETING)

Re-contacto a lead que ya mostró interés en un programa específico (lo identifica `udep_lookup-lead` Lambda).

**Categoría**: `MARKETING`
**Nombre**: `udep_welcome_hot_lead`
**Idioma**: `es_PE`
**Encabezado**: Texto → `Hola {{1}} 👋`
**Cuerpo**:
```
Vimos tu interés en *{{2}}* de la Universidad de Piura. Las inscripciones para el próximo ciclo están abiertas y un asesor puede acompañarte en el proceso. ¿Te llamamos hoy?
```
**Pie de página**: `Universidad de Piura — Admisión 2026`
**Botones (Llamada a la acción + Respuesta rápida)**:
- 🔗 **CTA URL**: texto "Más info" → URL: `https://udep.edu.pe/admision/{{3}}` (dinámica, variable 3)
- 💬 **Respuesta rápida**: `Sí, contáctenme`

**Variables**:
- `{{1}}` = primer nombre (de `udep_first_name`)
- `{{2}}` = programa de interés (de `udep_programa_interes`)
- `{{3}}` = slug del programa para construir URL

---

## Plantilla 3 — `udep_visita_confirmada` (UTILITY)

Confirmación tras agendar una visita al campus (intent `AgendarVisita`).

**Categoría**: `UTILITY`
**Nombre**: `udep_visita_confirmada`
**Idioma**: `es_PE`
**Encabezado**: Texto → `Visita confirmada ✅`
**Cuerpo**:
```
Hola {{1}}, tu visita al campus *{{2}}* de la Universidad de Piura está confirmada para el *{{3}}* a las *{{4}}*.

📍 Dirección: {{5}}

Si necesitas reprogramar, responde a este mensaje.
```
**Pie de página**: `UDEP — ¡Te esperamos!`
**Botones (Respuesta rápida)**:
- `Reprogramar`
- `Cancelar visita`

**Variables**:
- `{{1}}` = nombre
- `{{2}}` = sede (Lima / Piura)
- `{{3}}` = fecha
- `{{4}}` = hora
- `{{5}}` = dirección completa

---

## Plantilla 4 — `udep_costos_pregrado` (UTILITY)

Respuesta automática a `SolicitarCostos` cuando el asesor ya está fuera de horario.

**Categoría**: `UTILITY`
**Nombre**: `udep_costos_pregrado`
**Idioma**: `es_PE`
**Encabezado**: ninguno
**Cuerpo**:
```
Hola, gracias por preguntar por los costos de Pregrado en la UDEP. La pensión varía según la escala asignada en el examen socioeconómico.

📄 Te compartimos el documento oficial con escalas vigentes.

Un asesor te llamará en el siguiente horario hábil (L-V 8:00-20:00) para resolver tus dudas específicas.
```
**Documento** (header tipo PDF): URL a PDF estático en S3 o sitio UDEP
**Pie de página**: `Universidad de Piura — Admisión`
**Botones (CTA URL + Respuesta rápida)**:
- 🔗 `Ver escalas completas` → URL UDEP de pensiones
- 💬 `Hablar con asesor`

---

## Cómo invocar una plantilla desde el contact flow

Una vez aprobada, en el flow usas un bloque **Send Message** con `ContentType = application/vnd.amazonaws.connect.message.interactive.json` y este payload:

```json
{
  "templateType": "WhatsAppHsm",
  "version": "1.0",
  "data": {
    "namespace": "<namespace_de_meta>",
    "templateName": "udep_welcome_hot_lead",
    "language": {"code": "es_PE", "policy": "deterministic"},
    "components": [
      {
        "type": "header",
        "parameters": [{"type": "text", "text": "$.Attributes.udep_first_name"}]
      },
      {
        "type": "body",
        "parameters": [
          {"type": "text", "text": "$.Attributes.udep_first_name"},
          {"type": "text", "text": "$.Attributes.udep_programa_interes"},
          {"type": "text", "text": "$.Attributes.udep_programa_slug"}
        ]
      }
    ]
  }
}
```

> **Namespace** lo obtienes desde Meta Business Manager → WhatsApp Manager → la cuenta UDEP → es un GUID tipo `aabbccdd-1234-…`.

---

## Resumen de qué pedirle a UDEP / a quien gestione Meta

1. **Acceso a Meta Business Manager** del Business Account asociado al número `+15557849134`.
2. **Categorías**: UDEP tiene que justificar `MARKETING` ante Meta (ya lo hacen otras universidades, es viable).
3. **PDFs/links oficiales** para usar como adjuntos / CTAs:
   - Escalas de pensión vigentes
   - Brochure por facultad (PDF)
   - URL del proceso de admisión
4. **Logo + datos de contacto** para el footer (Meta los requiere para Marketing).

Plazo realista: **3-5 días hábiles** desde que se suben hasta que están aprobadas y se pueden usar en producción.
