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

## Paso a paso del wizard de envío (submission 1551739356424598)

El wizard "Enviar a revisión de apps" tiene 5 pasos. Verificado el 2026-07-16: **Verificación**, **Configuración de apps** y **Uso permitido** ya OK; faltan **Tratamiento de datos** e **Instrucciones para revisores** ("Requiere revisión"). (Meta bloquea la lectura programática de esta página — se navega a mano.)

### Antes de grabar — prepara 3 cosas

1. **Cuenta de prueba en ARIA** para el revisor de Meta: crear un usuario (rol agente) con correo+clave dedicados. Va en "Instrucciones para revisores" para que el revisor entre solo y verifique. NO usar una cuenta real de Novasys.
2. **Dos cuentas de Meta que NO sean admin/tester de la app** (un IG personal + un FB personal cualquiera). El revisor necesita ver que funciona con un usuario externo, no solo con el dueño.
3. **URL del webhook** (ya desplegada): `https://3gfqyfbd5hcsykexzp63bljlvy0bplog.lambda-url.us-east-1.on.aws/`. Página `@novasysperu` (IG `17841477339970189`, page `188013051209705`).

### Qué grabar en CADA permiso (1 video por permiso, 1–2 min, pantalla real de ARIA)

Regla de oro Meta: el video prueba el flujo **end-to-end** disparado por un **usuario externo**, mostrando la **UI real** de ARIA. Nada de slides.

- **`instagram_manage_messages`** — DM de Instagram. Grabar: (1) la cuenta IG externa manda un DM a @novasysperu; (2) el mensaje entra a **Conversaciones** de ARIA con su burbuja; (3) el agente responde desde ARIA; (4) la respuesta llega al Instagram del usuario. Cierra el círculo en cámara.
- **`pages_messaging`** — Messenger. Igual que arriba pero por Messenger de la página de Facebook: usuario externo escribe → entra a ARIA → agente responde → llega a Messenger.
- **`instagram_manage_comments`** — Comentarios de IG. Grabar: usuario externo comenta un post de @novasysperu → el comentario aparece en el inbox de ARIA → el agente responde el comentario → la respuesta se ve en el post de Instagram.
- **`pages_manage_metadata`** — Webhooks de la página. Normalmente NO necesita video propio (es la fontanería de suscripción). Se cubre por escrito en las instrucciones: "Usamos `pages_manage_metadata` para suscribir nuestro webhook a los eventos de mensajería de la página, así los mensajes entrantes llegan a ARIA en tiempo real." Si el paso te exige un video igual, reusa el de `pages_messaging` (ahí se ve el webhook entregando el mensaje).

### Paso "Instrucciones para revisores" — qué escribir

Pega instrucciones de reproducción + credenciales de prueba. Plantilla:

> **App:** ARIA — bandeja omnicanal de atención al cliente de Novasys.
> **Login de prueba:** URL `https://<app>` · usuario `revisor@novasys...` · clave `<clave temporal>`.
> **Pasos:** 1) Inicia sesión. 2) Abre "Conversaciones". 3) Desde una cuenta de Instagram/Facebook externa, envía un mensaje a @novasysperu. 4) El mensaje aparece en la bandeja en segundos. 5) Responde desde ARIA; la respuesta llega al usuario. Cada permiso solicitado corresponde a un paso de este flujo (DMs de IG, Messenger, comentarios de IG).

### Paso "Tratamiento de datos" (Data Use Checkup) — cómo responder

Es una **certificación legal** — la responde el cliente por Novasys, con la verdad de la arquitectura ARIA:

- **Almacenamiento:** los datos de Meta (mensaje, nombre, id del remitente) se guardan en **DynamoDB en la cuenta AWS de Novasys** ([[project_aws_account]]), solo para mostrar la conversación al agente.
- **Uso:** exclusivamente atención al cliente en la bandeja. **No se venden, no se comparten** con terceros, no se usan para publicidad.
- **Transferencia:** no hay transferencia a terceros; si preguntan por "proveedor tecnológico/Tech Provider", Novasys es quien opera su propia infraestructura.
- **Retención/eliminación:** describir la política de retención y que se borra a pedido.

### Reglas que evitan el rechazo

- Usuario **externo** en cámara (no el admin de la app) — es la causa #1 de rechazo.
- Mostrar la **UI real** de ARIA, no mockups.
- Idealmente narración/subtítulos en **inglés** (los revisores son internacionales).
- Que se vea el **ida y vuelta completo** (entra Y responde), no solo la recepción.
- **Business Verification** de Novasys aprobada antes de enviar (si no, el envío se traba).

## Resumen de bloqueos

- **App Review**: lo envía el cliente (su cuenta + Business Verification + video). ARIA no puede.
- **Business Verification**: documento del negocio, tarda días.
- Mientras tanto: IG/Messenger **ya funcionan** para admins/testers de la app y muestran su nombre; el resto entra con el fallback legible.
