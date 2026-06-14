# Diagrama de Flujo de Procesos — ARIA (Connectview)

**Documento técnico** · v1.0 · 2026-06-04

Procesos de negocio clave de la plataforma, en notación de flujo / secuencia. Cada
proceso indica los componentes (frontend, Lambdas, servicios AWS) que intervienen.

Índice:
1. [Autenticación e identidad](#1-autenticación-e-identidad)
2. [Onboarding de un tenant (BYO)](#2-onboarding-de-un-tenant-byo)
3. [Campaña de salida (outbound)](#3-campaña-de-salida-outbound)
4. [Atención de un contacto entrante](#4-atención-de-un-contacto-entrante-agente)
5. [Bot de WhatsApp entrante](#5-bot-de-whatsapp-entrante)
6. [Resumen de llamada con IA](#6-resumen-de-llamada-con-ia)

---

## 1. Autenticación e identidad

Dos capas independientes: **identidad de ARIA** (Cognito, obligatoria) y
**softphone de Amazon Connect** (opcional; si falla, la app sigue sin voz).

```mermaid
flowchart TB
    A["Usuario abre ARIA"] --> B{"¿Sesión Cognito<br/>válida?"}
    B -->|No| C["Amplify Authenticator<br/>(login / registro)"]
    C --> C1["Registro: email, contraseña,<br/>nombre, empresa"]
    C1 --> D["provision-tenant<br/>crea la organización (tenantId)"]
    B -->|Sí| E["fetchAuthSession()<br/>→ ID Token (custom:tenantId, grupos)"]
    D --> E
    E --> F["App carga UI según rol"]
    F --> G{"¿Abrir softphone?"}
    G -->|Botón 'Conectar'| H["initCCP() — Amazon Connect Streams"]
    H --> I{"¿Federación<br/>disponible?"}
    I -->|Sí| J["get-federation-token → SSO silencioso"]
    I -->|No| K["Popup de login de Connect"]
    J --> L["Softphone listo (voz/chat)"]
    K --> L
    G -->|No| M["App funciona sin softphone<br/>(softphoneUnavailable = true)"]
```

**Componentes:** `VoxAuthContext`, `ConnectAuthContext`, `CCPContext`,
`src/lib/connect.ts`; Lambdas `provision-tenant`, `get-federation-token`,
`set-connect-link`.

---

## 2. Onboarding de un tenant (BYO)

Una empresa nueva conecta **sus** recursos sin que ARIA toque su cuenta. Ver también
el diagrama de despliegue en [02-arquitectura-fisica.md](02-arquitectura-fisica.md#3-onboarding-físico-de-un-tenant-cloudformation-1-clic).

```mermaid
sequenceDiagram
    autonumber
    participant AD as Admin del cliente
    participant ARIA as ARIA (Integraciones)
    participant CF as CloudFormation (cuenta cliente)
    participant DB as connectview-connections

    AD->>ARIA: Inicia "Conectar Amazon Connect"
    ARIA->>ARIA: Genera ExternalId (CSPRNG) + URL Launch Stack
    AD->>CF: Clic → aplica connect-role.yaml en SU cuenta
    CF-->>AD: Crea rol VoxCrmConnectAccess (Role ARN)
    AD->>ARIA: Pega Role ARN + ARN de instancia Connect
    ARIA->>DB: Guarda config del tenant
    opt BYO Data Plane
        AD->>CF: Aplica data-plane.yaml (14 tablas)
    end
    AD->>ARIA: "Verificar"
    ARIA->>CF: diagnose-connection (assume-role, tablas, S3, Contact Lens)
    ARIA-->>AD: ✅ Conectado (N OK · 0 error)
    opt Integraciones adicionales
        AD->>ARIA: Conectar Salesforce (OAuth) / WhatsApp (número + WABA)
    end
```

**Componentes:** `IntegrationsManager`, `ConnectSetupWizard`, `cfnTemplates.ts`;
Lambdas `manage-connections`, `verify-connect-connection`, `diagnose-connection`,
`salesforce-oauth-start/callback`.

---

## 3. Campaña de salida (outbound)

```mermaid
flowchart TB
    subgraph CRE["Creación (Supervisor/Admin)"]
        A["Cargar audiencia<br/>(CSV · leads · pegar números)"] --> B["Configurar canal<br/>(voz predictivo/power/preview · WhatsApp · email)"]
        B --> C["Asignar agentes + reglas<br/>(horario, reintentos)"]
        C --> D["create-campaign<br/>(status = DRAFT / RUNNING)"]
    end
    D --> E[("connectview-campaigns<br/>+ campaign-contacts")]
    subgraph EXE["Ejecución (automática)"]
        F["EventBridge ~1 min →<br/>campaign-dialer (tick loop sub-minuto)"]
        F --> G{"¿Canal?"}
        G -->|Voz| H["Connect StartOutboundVoiceContact<br/>(respeta % abandono / pacing)"]
        G -->|WhatsApp| I["send-whatsapp-template<br/>(desde el número del tenant)"]
        H --> J["Agente atiende → workspace"]
        I --> K["Cliente responde → bot / agente"]
    end
    E --> F
    J --> L["Wrap-up: tipificación + notas<br/>save-agent-notes"]
    L --> M["get-campaign-stats<br/>(KPIs en vivo: contactados, conversión, AHT)"]
    L -.->|si Salesforce| N["salesforce-sync (upsert Lead/Task)"]
```

**Componentes:** `CampaignCreatePage`, `CampaignDetailPage`; Lambdas
`create-campaign`, `control-campaign`, `campaign-dialer`, `assign-campaign-agents`,
`get-campaign-stats`, `send-whatsapp-template`, `save-agent-notes`.

---

## 4. Atención de un contacto entrante (agente)

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente final
    participant CN as Amazon Connect
    participant AG as Agente (Workspace)
    participant LB as Lambdas
    participant AI as Bedrock (IA)

    C->>CN: Llama / escribe (voz, chat, WhatsApp, email)
    CN->>AG: Contacto entrante (Streams) → overlay
    AG->>CN: Aceptar
    AG->>LB: get-contact-detail / get-customer-thread (carga 360°)
    LB-->>AG: Perfil, historial, transcripción
    loop Durante el contacto
        CN-->>AG: Transcripción en vivo (Contact Lens)
        AG->>AI: generate-call-summary (sugerencias / copiloto)
        AI-->>AG: Réplicas sugeridas / próxima acción
        opt Acciones
            AG->>LB: transferir · conferencia · agendar callback · crear lead
        end
    end
    C->>CN: Fin del contacto
    AG->>LB: Wrap-up → save-agent-notes (tipificación + notas)
    LB->>LB: update-customer-profile · wrapup-history · (Salesforce)
```

**Componentes:** `AgentDesktopPage` + paneles (perfil, historial, transcripción,
copiloto, coach); Lambdas `get-contact-detail`, `get-live-transcript`,
`generate-call-summary`, `get-q-suggestions`, `save-agent-notes`,
`update-customer-profile`, `schedule-callback`.

---

## 5. Bot de WhatsApp entrante

El bot **razona** con el Bedrock del cliente y **responde** desde el número del
cliente (BYO de punta a punta).

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente (WhatsApp)
    participant EUM as End User Messaging (cuenta cliente)
    participant FL as Contact Flow (Connect)
    participant ADP as agent-channel-adapter
    participant BR as bot-runtime
    participant BED as Bedrock (cuenta cliente)

    C->>EUM: Mensaje de WhatsApp
    EUM->>FL: Entra al flujo de Connect
    FL->>ADP: Invoca con {tenantId, contactId, mensaje}
    ADP->>BR: { botId, state, input, source: whatsapp }
    BR->>BR: Recorre el grafo del bot (nodos / aristas)
    alt Nodo de IA (ai_agent)
        BR->>BED: InvokeModel (Claude) — razona la respuesta
        BED-->>BR: Texto / decisión (continuar / resolver / derivar)
    end
    BR-->>ADP: { mensajes, nuevo estado, done/handoff }
    ADP->>EUM: Envía la respuesta DESDE el número del cliente
    EUM-->>C: Respuesta de WhatsApp
    opt Derivar a humano
        ADP->>FL: handoff → cola de agentes
    end
```

**Componentes:** Lambdas `agent-channel-adapter`, `bot-runtime`,
`send-whatsapp-template`; tablas `connectview-bots`, `connectview-ai-conversations`;
núcleo `resolveBedrock` / `resolveWhatsApp` de `tenantConnect`.

---

## 6. Resumen de llamada con IA

```mermaid
flowchart LR
    A["Llamada finalizada<br/>(o contacto histórico)"] --> B{"¿Transcripción<br/>disponible?"}
    B -->|En vivo| C["Contact Lens<br/>ListRealtimeContactAnalysisSegments"]
    B -->|Histórica| D["Frontend envía la transcripción inline"]
    C --> E["generate-call-summary"]
    D --> E
    E --> F["resolveBedrock → Bedrock del tenant"]
    F --> G["Claude genera:<br/>resumen · tipificación sugerida ·<br/>próxima acción · reescritura"]
    G --> H["Agente ve la sugerencia<br/>en el panel de wrap-up / copiloto"]
    G -.->|degradado| I["Si falla: mensaje suave,<br/>el agente redacta manual"]
```

**Componentes:** Lambda `generate-call-summary` (modos: `summary`, `wrap-up-suggest`,
`next-action`, `suggest-replies`, `rewrite`, `assistant`); Bedrock por tenant.

---

## 7. Referencias

- Componentes lógicos: [01-arquitectura-aplicacion.md](01-arquitectura-aplicacion.md)
- Recursos físicos: [02-arquitectura-fisica.md](02-arquitectura-fisica.md)
- Manual de uso por rol: [04-manual-usuario-instalacion.md](04-manual-usuario-instalacion.md)
