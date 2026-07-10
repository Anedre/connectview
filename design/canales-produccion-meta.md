# Guía de producción — Canales de Meta (Messenger, Instagram, WhatsApp)

> Cómo pasar los canales de Meta de "conectado en ARIA" a **recibir/responder mensajes
> del público real**. Escrito a partir del diagnóstico del 2026-07-08 (tenant Novasys
> `t_3176`, App de Meta "Novasys del Perú" `932893188309221`).

## El concepto clave: "conectado" ≠ "en producción"

Conectar la cuenta en ARIA (Integraciones) solo guarda los IDs de la página/IG/número.
Que los mensajes **lleguen** depende de la **App de Meta**, que tiene dos modos:

| Modo                     | Quién puede escribir y que llegue                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Desarrollo** (default) | SOLO personas con un **rol en la App** (admin / desarrollador / **probador**). El público NO. |
| **Activo / Live**        | Cualquier persona.                                                                            |

> ⚠️ Ser administrador de la _Página_ **no** es lo mismo que tener rol en la _App_. En modo
> Desarrollo, el webhook solo se dispara para quien tiene rol en la **App**.

---

## 0. Base común de la App de Meta (una sola vez)

1. **App:** "Novasys del Perú" (`932893188309221`) en https://developers.facebook.com/apps/932893188309221
2. **Configuración → Básica:** URL de **Política de privacidad**, **ícono**, **categoría**.
3. **Verificación del negocio** (Business Verification) en Meta Business Manager — necesaria para
   Acceso Avanzado / producción.
4. **Modo de la App → Activo** (interruptor en la barra superior del panel).
5. **Tipo de acceso a permisos:**
   - **Estándar** → alcanza si la App maneja **solo las cuentas propias** de Novasys. _No requiere App Review._
   - **Avanzado** → necesario cuando ARIA conecte cuentas de **otros clientes** (multi-empresa). _Requiere App Review + verificación del negocio._

---

## 1. Messenger (Facebook)

**Estado en ARIA:** ✅ página `Novasys del Perú S.A.C.` (`188013051209705`) suscrita al webhook
con el campo `messages`; webhook desplegado y verificado.

**Para producción:**

- [ ] Producto **Messenger** agregado a la App, con la Página conectada (hecho).
- [ ] Webhook suscrito a `messages`, `messaging_postbacks` (hecho).
- [ ] App en **modo Activo**.
- [ ] (multi-cliente) App Review de `pages_messaging`.

**Probar antes de publicar:** escribir a https://m.me/Miguelavsm desde una cuenta con rol en la App.

---

## 2. Instagram (DM)

**Estado en ARIA:** ✅ cuenta `@novasysperu` (`17841477339970189`) vinculada a la página; permisos
`instagram_basic` + `instagram_manage_messages` concedidos.

**Para producción:**

- [ ] Producto **Instagram** en la App, webhook del objeto **Instagram** suscrito a `messages`.
- [ ] En la cuenta `@novasysperu` (app de Instagram): **Configuración → mensajes → permitir el acceso
      a mensajes de herramientas conectadas**.
- [ ] App en **modo Activo**.
- [ ] (multi-cliente) App Review de `instagram_manage_messages`.

**Probar antes de publicar:** _Roles → Probadores de Instagram →_ agregar tu `@usuario`, aceptar la
invitación desde Instagram, y escribir a `@novasysperu`.

---

## 3. WhatsApp

**Estado en ARIA:** modo `meta` (Cloud API), `metaPhoneNumberId` cargado. Recepción espejada al
inbox omnicanal.

**Para producción:**

- [ ] Número dado de alta en una **WhatsApp Business Account (WABA)**, **verificado** y con
      **nombre para mostrar aprobado**.
- [ ] Webhook de WhatsApp suscrito (campo `messages`) → `whatsapp-meta-webhook`.
- [ ] Salir del **modo de prueba** del número (límite de destinatarios) → requiere Business Verification.
- [ ] **Plantillas (HSM) aprobadas** para poder iniciar conversación (mensajes proactivos / fuera de 24h).

> Nota: WhatsApp NO usa el "modo Desarrollo/Live" de la App igual que Messenger/IG — su gate es la
> **verificación del negocio + el número fuera de modo de prueba**.

---

## Checklist de go-live (resumen)

1. [ ] Completar Configuración → Básica de la App (privacidad, ícono, categoría).
2. [ ] Verificación del negocio en Business Manager.
3. [ ] App → **modo Activo**.
4. [ ] Messenger: página suscrita a `messages` (✅).
5. [ ] Instagram: objeto Instagram suscrito a `messages` + permiso de mensajes en la cuenta IG.
6. [ ] WhatsApp: número verificado, fuera de modo prueba, plantillas aprobadas.
7. [ ] (multi-cliente) App Review de `instagram_manage_messages` + `pages_messaging`.

## Pendiente del lado de ARIA (equipo Novasys / técnico)

- [ ] Crear el secret `connectview/meta` (`{appId, appSecret}`) → activa la validación de firma del
      webhook (hoy hace _fail-open_).
- [ ] Verificar el **page token** para responder (el token guardado es de usuario; el envío a
      `/{pageId}/messages` puede requerir page token con el nuevo modelo de páginas de Meta).
