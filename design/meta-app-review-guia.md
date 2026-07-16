# Meta App Review — desbloquear nombres de Instagram/Messenger

**Objetivo:** que ARIA reciba DMs/comentarios de Instagram y Messenger de **cualquier** cliente (no solo de quien tiene rol en la app) y vea su **nombre real** (hoy sale `Instagram · 1825` porque Meta no expone el perfil con acceso Standard).

**Estado hoy (verificado):** app `Novasys del Perú` (932893188309221) en modo **Live** ✅, con Privacy Policy ✅, pero todos los permisos en **Standard access** ("No se solicitó revisar la app"). App Review lo hace **el cliente** desde su cuenta de Meta — ARIA no puede enviarlo.

## Por qué hoy sale `Instagram · 1825` y no el nombre

Con acceso **Standard**, la Graph API devuelve el perfil del usuario **solo si esa persona tiene rol en la app** (admin/desarrollador/tester). Para el resto, `GET /{sender-id}?fields=name` viene vacío → ARIA cae al fallback (etiqueta de canal + últimos 4 dígitos). Con acceso **Advanced** (tras App Review), Meta sí devuelve el nombre público → aparece solo, sin tocar código.

## Lo que hay que solicitar (acceso avanzado)

En **developers.facebook.com → app → Revisión de la app → Permisos y funciones**, pedir "Solicitar acceso avanzado" para:

| Permiso                     | Para qué en ARIA                     |
| --------------------------- | ------------------------------------ |
| `instagram_manage_messages` | recibir y responder DMs de Instagram |
| `pages_messaging`           | recibir y responder Messenger        |
| `instagram_manage_comments` | comentarios de Instagram al inbox    |
| `pages_manage_metadata`     | webhooks de la página (ya suscritos) |

`pages_show_list` y `instagram_basic` suelen venir con acceso avanzado automático.

## Requisitos previos (bloquean el envío)

1. **Business Verification** de Novasys en Meta Business Manager (Configuración del negocio → Seguridad → Verificación del negocio). Documento del negocio (RUC/constitución). Tarda días.
2. **App en Live** ✅ (ya está).
3. **Privacy Policy URL** ✅ (novasys.com.pe/contacto — idealmente una página dedicada de privacidad).
4. **Rol de administrador** en la app (el que envía).

## Caso de uso a pegar (por permiso)

Texto base — ajustar el "nosotros" a Novasys:

> Novasys opera un centro de contacto omnicanal (ARIA) para atención al cliente. Cuando un cliente nos escribe un mensaje directo por Instagram/Messenger, ARIA lo recibe vía webhook, lo muestra en la bandeja unificada del agente junto a WhatsApp y llamadas, y el agente responde desde la misma pantalla usando la Graph API. Usamos `<permiso>` exclusivamente para leer el mensaje entrante del cliente, mostrar su nombre para personalizar la atención, y enviar la respuesta del agente. No compartimos ni vendemos estos datos.

## Guion del screencast (Meta exige video end-to-end)

Grabar 1–2 min mostrando, con una cuenta que NO sea admin de la app:

1. Un usuario cualquiera envía un DM a @novasysperu (Instagram) y a la página (Messenger).
2. El mensaje aparece en **Conversaciones** de ARIA con el nombre del cliente.
3. El agente responde desde ARIA y el usuario recibe la respuesta.
4. (Para comentarios) un usuario comenta un post → aparece en el inbox → el agente responde.

Subir el video en cada solicitud de permiso.

## Tras la aprobación

Nada que tocar en código: ARIA ya llama `GET /{sender-id}?fields=name` (`meta-messaging-webhook` → `fetchName`). Con acceso avanzado empieza a devolver el nombre y el auto-vínculo por teléfono + el `fetchName` cubren el resto. El fallback `Instagram · 1825` solo se verá para quien no tenga nombre público.

## Resumen de bloqueos

- **App Review**: lo envía el cliente (su cuenta + Business Verification + video). ARIA no puede.
- **Business Verification**: documento del negocio, tarda días.
- Mientras tanto: IG/Messenger **ya funcionan** para admins/testers de la app y muestran su nombre; el resto entra con el fallback legible.
