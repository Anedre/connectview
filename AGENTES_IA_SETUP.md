# Agentes IA — Guía de publicación e infraestructura

Estado al 2026-06-02. El **hub de Agentes IA** (`/agente`) está completo y verificado:
crear/equipar agentes, **ejecución real de herramientas** (agendar cita, crear/mover
lead, buscar cliente, enviar plantilla WhatsApp), **playground** en vivo (Bedrock real)
y **monitoreo** de conversaciones. Los agentes son **solo texto** (WhatsApp / chat),
no de voz.

El motor es la Lambda **`connectview-bot-runtime`** (Claude por Bedrock, con
function-calling). Es **stateless**: recibe `{ botId|bot, state, input:{text}, source, toolEndpoints }`
y devuelve `{ messages, state, done, handoff }`. El hub la usa hoy en el playground.

---

## 0) Dos productos distintos: bot estructurado (Lex) vs Agente IA (Vox)

| | **Bot estructurado (Amazon Lex)** | **Agente IA (Vox / Claude)** |
|---|---|---|
| Naturaleza | Flujo **determinístico**, menús/botones fijos | **Inteligente**: conversa libre, entiende contexto |
| Acciones | Limitadas a intents predefinidos | **Ejecuta herramientas reales** (cita, lead, cliente, plantilla WA) |
| WhatsApp rico (botones/listas/emojis) | "De fábrica" (response cards de Lex) | Sí, **lo enviamos nosotros** vía la API de End User Messaging Social (control total, ≥ Lex) |
| Para qué cliente | Quiere un árbol de opciones controlado | Quiere un agente digital que resuelva, no un menú |
| ¿Usa Lex? | Sí | **No — es Lex-free por diseño** |

> Hoy `TECHWHATSAPP_CONNECT_V2` es del tipo **bot estructurado (Lex)** y funciona. El
> **Agente IA de Vox** es la otra oferta: se monta como un flow propio (sin Lex) que
> llama a `bot-runtime`. Los mensajes ricos de WhatsApp (botones/listas) se arman desde
> los `buttons`/`rows` que el agente ya devuelve y se mandan con la API social-messaging.

## 1) Publicar un agente IA (Vox, sin Lex) en WhatsApp vía Amazon Connect

> Esto es trabajo de **tu consola de Connect + Meta** + una pequeña Lambda "adaptador".
> El runtime ya está listo; falta cablearlo al canal.

### Arquitectura
```
WhatsApp (Meta) → Amazon Connect (canal de mensajería) → Contact Flow de chat
   └─ por cada mensaje del cliente:
        Invoke Lambda  "agent-channel-adapter"
            ├─ lee el estado de la conversación (DynamoDB por contactId)
            ├─ llama a bot-runtime { botId del agente, state, input:{text} }
            ├─ guarda el nuevo state
            └─ devuelve { reply, done, handoff }
        Send message (reply al cliente)
        Si handoff/done → Transfer to queue (a un humano);  si no → esperar próximo mensaje
```

### Prerrequisitos (consola, una vez)
1. **Canal WhatsApp en Connect**: vincular un número de WhatsApp Business (Meta WABA)
   a la instancia de Connect (Connect → *Channels / Integrations*). Requiere cuenta de
   Meta Business + número aprobado.
2. Una **cola** para las derivaciones a humano (ya las tienes).

### Pasos
1. **Adaptador** (`agent-channel-adapter`, Lambda nueva): mantiene el estado por
   `contactId` en una tabla pequeña y llama a `bot-runtime`. *(Te puedo escribir el
   código cuando quieras — es chico; solo necesita desplegarse como Lambda nueva +
   permiso a la tabla de sesiones y a invocar/llamar bot-runtime.)*
2. **Contact flow** de chat:
   - Bloque **Set logging** + **Set contact attributes** (guardar `agentBotId` = el id del agente).
   - **Invoke AWS Lambda function** → `agent-channel-adapter` (pasa el texto entrante + `contactId` + `agentBotId`).
   - **Send message** → el `reply` que devolvió el adaptador.
   - **Check contact attributes**: si `handoff == true` → **Transfer to queue**; si no → **Get customer input** (espera el siguiente mensaje) → vuelve a *Invoke Lambda*.
3. Asociar el flow al número de WhatsApp.

### Estado: adaptador ✅ construido y desplegado
- **`connectview-agent-channel-adapter`** (rol `connectview-campaign-lambda-role`, sesiones en `connectview-ai-conversations` con clave `sess#<contactId>`). Llama a `bot-runtime`, arma el payload **interactivo de WhatsApp** (texto/botones/listas) y lo enviaría por la API social-messaging. Arranca en **`DRY_RUN=true`** (no envía) — verificado: construye bien los botones interactivos.
- Env vars ya seteadas: `BOT_RUNTIME_URL`, `CONV_TABLE`, `WHATSAPP_PHONE_NUMBER_ID=phone-number-id-720bc94513454effbec925250dadf501`, `EP_*`.

### Para ir a vivo (3 pasos)
1. **Permiso de envío** (tu commit):
   ```bash
   aws iam put-role-policy --role-name connectview-campaign-lambda-role \
     --policy-name WhatsAppSend --policy-document file://social-messaging-policy.json
   ```
2. **Flip `DRY_RUN=false`** en el adaptador → lo hago yo apenas confirmes el paso 1 (y verifico que el cliente social-messaging cargue en el runtime; si falta, lo bundleo).
3. **Asociar el adaptador a Connect** (para que los flows puedan invocarlo):
   ```bash
   aws connect associate-lambda-function --instance-id 2345d564-4bd4-4318-9cf0-75649bad5197 \
     --function-arn arn:aws:lambda:us-east-1:731736972577:function:connectview-agent-channel-adapter --region us-east-1
   ```
   y un **contact flow** de WhatsApp que, por cada mensaje, invoque el adaptador, espere la próxima entrada, y derive a cola si `handoff=true`. *(Te genero el JSON del flow cuando me digas tu cola de derivación.)*

---

## 2) Migrar el log de conversaciones a una tabla dedicada (opcional)

Hoy las conversaciones se guardan en `connectview-bots` como items `conv#…` (funciona).
El código ya soporta una **tabla dedicada vía env var `CONV_TABLE`** — migrar es solo
config, **sin cambios de código**.

> Son comandos de **IAM/infra** → los corres tú (yo no toco control de acceso).

```bash
# 1) Crear la tabla (PK 'botId' para que el código no cambie)
aws dynamodb create-table \
  --table-name connectview-ai-conversations \
  --attribute-definitions AttributeName=botId,AttributeType=S \
  --key-schema AttributeName=botId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 2) Permiso al rol compartido (PutItem/Scan/Delete/Get sobre la tabla nueva)
aws iam put-role-policy \
  --role-name connectview-campaign-lambda-role \
  --policy-name AiConversationsAccess \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["dynamodb:PutItem","dynamodb:Scan","dynamodb:DeleteItem","dynamodb:GetItem"],"Resource":["arn:aws:dynamodb:us-east-1:731736972577:table/connectview-ai-conversations"]}]}'

# 3) Apuntar las dos Lambdas a la tabla nueva.
#    ⚠️ --environment REEMPLAZA todas las env vars; primero verifica las actuales:
aws lambda get-function-configuration --function-name connectview-bot-runtime --query 'Environment.Variables'
aws lambda get-function-configuration --function-name connectview-manage-bot   --query 'Environment.Variables'
#    Luego inclúyelas TODAS junto con CONV_TABLE, por ejemplo:
aws lambda update-function-configuration --function-name connectview-bot-runtime \
  --environment "Variables={CONV_TABLE=connectview-ai-conversations}"
aws lambda update-function-configuration --function-name connectview-manage-bot \
  --environment "Variables={CONV_TABLE=connectview-ai-conversations}"
```

Tras esto, las conversaciones nuevas se escriben en la tabla dedicada y el hub las lee
desde ahí. Las viejas quedan en `connectview-bots` (puedes borrarlas o migrarlas
manualmente; son items con `botId` que empieza en `conv#`).

---

## Herramientas del agente (function-calling, reales)
| Herramienta | Lambda real | Notas |
|---|---|---|
| Agendar cita | `manage-appointment` | crea la cita de verdad |
| Crear / mover lead | `manage-leads` | upsert por teléfono |
| Buscar cliente | `lookup-customer-profile` | lectura (Customer Profiles) |
| Enviar plantilla WhatsApp | `send-whatsapp-template` | **en el playground se SIMULA** (no envía); en canal real envía |

Las herramientas se ejecutan vía las **Function URLs** que el front pasa en `toolEndpoints`
(sin IAM nuevo). El agente decide cuándo llamarlas y pide los datos que le falten.
