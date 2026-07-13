# Guion de demo — ARIA · miércoles 15-jul-2026

> Chuleta para presentar en vivo. Tenant real **anedre123** (NO rutas `/*-demo`).
> Escenario ya armado: 2 programas con embudos distintos + Salesforce conectado.

---

## 0 · Checklist previo (10 min antes)

- [ ] **Login en la app real** (Chrome, tenant `anedre123`). Nada de `/*-demo`.
- [ ] Sidebar: **Salesforce ✓**, **WhatsApp ✓**, **Amazon Connect ✓** (los 3 con check verde).
- [ ] Navegador: **zoom 100%**, **modo claro**, cerrar notificaciones/pestañas ruidosas.
- [ ] Abrir **Leads** y confirmar que el escenario sigue vivo (otras sesiones pudieron tocar datos):
  - **Diplomado en Educación 2026-I** → columnas **Postulante / Admitido / Matriculado / Desistió** (7 leads).
  - **Especialización NIIF** → columnas **Nuevo lead / … / Cerrando** (embudo UDEP, 6 leads).
  - Si se desarmó, re-poblar (ver §Apéndice).
- [ ] **Agente IA** (/agente): fuentes = **Programas** provisto (probar 1 pregunta en el tester → debe citar `[P1]`).
- [ ] **Plan B**: tener screenshots de respaldo de cada pantalla por si el internet o el softphone fallan en vivo.

---

## 1 · El hilo (la historia que se cuenta)

> "UDEP no vende _un_ producto: vende **muchos programas** —pregrado, diplomados, idiomas, especializaciones—
> y **cada uno capta y convierte distinto**. Un postulante a un diplomado no recorre el mismo camino que un
> interesado en pregrado. Hoy eso se maneja con procesos sueltos y un Salesforce genérico.
> **ARIA unifica la captación omnicanal, adapta el embudo a CADA programa, responde con IA, y vive
> sincronizado con Salesforce — sin duplicar trabajo.**"

Mantén ese hilo: **"un sistema, el embudo correcto para cada programa"**.

---

## 2 · Recorrido paso a paso (~15 min)

### A. Panorama — _Inicio_ (1 min)

- Abre **Inicio**. Señala KPIs y el pulso del día. "Todo el equipo comercial arranca aquí."

### B. Los programas son unidades comerciales — _Programas_ (2 min)

- Abre **Programas**. "Cada tarjeta es una unidad comercial con su ficha: modalidad, precio, requisitos…"
- Abre el **Diplomado en Educación 2026-I** → muestra que tiene asignada su taxonomía **"Embudo Diplomados"**.
- Menciona que **NIIF** usa el **embudo de admisión UDEP** (la default). "El embudo es una propiedad del programa."

### C. ⭐ EL MOMENTO CLAVE — el embudo cambia por programa — _Leads_ (3–4 min)

1. Abre **Leads** con el **Diplomado** activo. Columnas: **Postulante → Admitido → Matriculado → Desistió**.
2. Usa el **switcher de programa** (arriba) → cambia a **Especialización NIIF**.
3. **El tablero se transforma**: ahora **Nuevo lead → Contactado → Interesado → Negociando → Cerrando**.
4. Frase: _"Mismo sistema, mismos agentes, pero cada programa ve **su** embudo. Esto no lo hace un CRM genérico."_
5. **Mini-wow opcional**: arrastra un lead de una columna a otra → señala que se registra el golpe en su historial
   y **se sincroniza a Salesforce** con el Status correcto del embudo de ese programa.

### D. La captación entra sola — _Conversaciones / Campañas_ (2 min)

- **Inbox omnicanal**: WhatsApp, Instagram, Messenger, Facebook en una sola bandeja.
- "Un anuncio de Meta Lead Ads crea el lead **solo**, lo etiqueta y dispara la primera acción (speed-to-lead).
  Cero Zapier, cero pegado manual."

### E. El Agente IA responde con datos reales — _Agente IA_ (2 min)

- Abre **Agente IA** → tester. Pregunta algo como _"¿Cuánto dura el diplomado en educación y cuánto cuesta?"_
- Señala que responde **citando los Programas reales** (`[P1]`) — no inventa. "Su conocimiento son tus programas."
- Menciona guardrails + derivación a humano cuando corresponde.

### F. Vive con Salesforce — _Configuración → Integraciones_ (2 min)

- Muestra la tarjeta **Salesforce** conectada + el panel **"Sincronización con Salesforce desde 0"**.
- "Importa todo lo que ya tienes en SF, o exporta ARIA→SF, **sin duplicar** (dedup por teléfono/ID)."
- Punto fino si preguntan: ARIA manda el **Status correcto por programa**; los embudos _visuales_ dentro de SF
  se configuran con **Record Types** (metadata que administra el cliente en su org).

### G. Todo se mide — _Reportes_ (1 min)

- **Reportes**: dashboard por **Programa**, KPIs vs período previo, descargas Excel/CSV.

---

## 3 · Cierre (30 seg)

> "ARIA es un CRM de admisiones que **habla el idioma de cada programa**: capta omnicanal, adapta el embudo,
> responde con IA y queda sincronizado con Salesforce. Menos herramientas, más matrículas."

---

## 4 · Preguntas típicas y cómo responder

| Pregunta                                      | Respuesta corta                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Salesforce maneja embudos por programa?      | ARIA envía el Status correcto por programa. Los embudos _visuales_ en SF = **Record Types + Sales Process** (config del cliente en su org). |
| ¿Y si un programa nuevo necesita otro embudo? | Se crea una taxonomía en **Tipificación** y se asigna al programa. Sin tocar código.                                                        |
| ¿Duplica datos con Salesforce?                | No: dedup por teléfono + ID + anti-eco. Import/export idempotentes.                                                                         |
| ¿Dónde corren los datos?                      | Modelo **BYO**: en la cuenta AWS del propio cliente (aislado por tenant).                                                                   |
| ¿El Agente IA inventa?                        | No: responde citando tus Programas/FAQ; si no sabe, deriva a un humano.                                                                     |

---

## 5 · Plan B (si algo falla en vivo)

- **Softphone ocupado en otra pestaña** → banner "Usar aquí" (es normal, explícalo con naturalidad).
- **Internet/API lento** → usa los screenshots de respaldo; no te quedes mirando un spinner.
- **Un dato se ve raro** → cambia de programa y vuelve (fuerza refresco) o recarga la página.

---

## Apéndice · Re-poblar el escenario (si se desarmó)

Los datos viven en DynamoDB y persisten, pero sesiones concurrentes pueden moverlos. Para rearmar los 2 embudos
se reutilizan leads reales del import de Salesforce y se posicionan con `manage-leads action:"move"`
(un `move` con `programId` crea la membership si no existe; **no** hay automatización de `lead_stage_changed`
activa, así que no dispara mensajes). IDs de referencia:

- **Diplomado** `c4119c4c` (taxonomía `Embudo Diplomados` = `da20a5b6`): etapas `postulante / admitido / matriculado / desistio`.
- **NIIF** `ce607bd7` (default `udep-default`): etapas `nuevo_lead / gestionado / contactado / interesado / negociando / cerrando / …`.

El script exacto de poblado quedó registrado en la sesión de Claude Code (mover 6 leads a cada programa).
