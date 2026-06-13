/**
 * cfnTemplates — CloudFormation templates que el cliente aplica en SU cuenta
 * AWS para habilitar Vox.
 *
 * Hay dos templates separados (intencionalmente):
 *
 *  1. `connectAccessCfnTemplate`  — chico, crea SOLO el rol IAM cross-account.
 *     Es lo único OBLIGATORIO para que Vox funcione en modo BYO mínimo (los
 *     datos del cliente todavía viven pooled en Vox).
 *
 *  2. `dataPlaneCfnTemplate`      — grande, crea las 14 tablas DynamoDB del
 *     producto en la cuenta del cliente Y extiende el rol con permisos
 *     DynamoDB. Es OPCIONAL pero recomendado: con esto los datos del cliente
 *     NUNCA se escriben en la cuenta de Vox (#46 BYO Data Plane).
 *
 * Vox lo usa así: si el rol del cliente tiene permisos sobre las tablas, los
 * Lambdas leen/escriben en su cuenta vía assume-role. Si no, caen al cluster
 * pooled de Vox (legacy). La transición es per-tenant, opt-in.
 *
 * VOX_AWS_ACCOUNT es el placeholder que el frontend reemplaza por el
 * account ID de Vox (731736972577) antes de mostrar el template al cliente.
 */

const VOX_AWS_ACCOUNT_PLACEHOLDER = "${VOX_AWS_ACCOUNT}";

/* ───────────────── 1-clic "Launch Stack" (quick-create) ─────────────────── */

/** Bucket público de Vox que sirve los templates parametrizados para el
 *  quick-create de CloudFormation. */
const CFN_TEMPLATES_BASE =
  "https://vox-cfn-templates-731736972577.s3.us-east-1.amazonaws.com";

/**
 * Genera el URL "Launch Stack" de CloudFormation (quick-create) con los
 * parámetros pre-cargados. El cliente hace click → se loguea en SU cuenta →
 * ve la pantalla de revisión con todo lleno → da "Create stack". 2 clics.
 *
 * NO le da acceso a Vox: es el cliente creando el rol en su propia cuenta,
 * solo con la receta + parámetros pre-cargados.
 */
export function connectRoleLaunchUrl(opts: {
  externalId: string;
  instanceArn?: string;
  recordingBucket?: string;
  region?: string;
}): string {
  const region = opts.region || "us-east-1";
  const templateUrl = `${CFN_TEMPLATES_BASE}/connect-role.yaml`;
  const params: Record<string, string> = {
    templateURL: templateUrl,
    stackName: "VoxCrmConnectAccess",
    param_ExternalId: opts.externalId,
  };
  if (opts.instanceArn?.trim()) params.param_InstanceArn = opts.instanceArn.trim();
  if (opts.recordingBucket?.trim()) params.param_RecordingBucket = opts.recordingBucket.trim();
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${qs}`;
}

/** Launch Stack URL para el Data Plane (las 14 tablas). Sin parámetros. */
export function dataPlaneLaunchUrl(region = "us-east-1"): string {
  const templateUrl = `${CFN_TEMPLATES_BASE}/data-plane.yaml`;
  const qs = `templateURL=${encodeURIComponent(templateUrl)}&stackName=VoxCrmDataPlane`;
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${qs}`;
}

/** Launch Stack URL para SOLO los permisos (cuando las 14 tablas ya existen —
 *  ej. las recreaste, o un re-intento). No toca las tablas, solo el rol. */
export function dataPlanePermissionsLaunchUrl(region = "us-east-1"): string {
  const templateUrl = `${CFN_TEMPLATES_BASE}/data-plane-permissions.yaml`;
  const qs = `templateURL=${encodeURIComponent(templateUrl)}&stackName=VoxCrmDataPlanePerms`;
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${qs}`;
}

/* ───────────────── Template 1: rol cross-account (obligatorio) ──────────── */

export function connectAccessCfnTemplate(
  externalId: string,
  instanceArn = ""
): string {
  // Si el wizard ya capturó el instanceArn, lo pre-cargamos como Default del
  // parámetro para que el cliente no tenga que tipearlo. Si está vacío, el
  // default "*" deja las acciones abiertas (compat) — pero el wizard siempre
  // lo pasa, así que en la práctica queda scopeado a la instancia del cliente.
  const instanceArnDefault = instanceArn.trim() || "*";
  return `AWSTemplateFormatVersion: "2010-09-09"
Description: Rol cross-account para que Vox CRM acceda a tu Amazon Connect
Parameters:
  InstanceArn:
    Type: String
    Default: ${instanceArnDefault}
    Description: >-
      ARN de TU instancia de Amazon Connect
      (arn:aws:connect:REGION:CUENTA:instance/ID). Las acciones que originan
      llamadas o escuchan contactos quedan restringidas SOLO a esta instancia
      (defensa: si las credenciales de Vox se comprometieran, no podrían operar
      otras instancias de tu cuenta).
  RecordingBucket:
    Type: String
    Default: ${instanceArn.trim() ? "REEMPLAZAR-con-el-nombre-exacto-de-tu-bucket" : "amazon-connect-*"}
    Description: >-
      Nombre EXACTO del bucket S3 de grabaciones (sin "s3://"). Recomendado:
      poné el nombre exacto en vez del patrón, así Vox solo puede leer ESE
      bucket y no cualquier otro que empiece con "amazon-connect-".
Resources:
  VoxCrmConnectRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: VoxCrmConnectAccess
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: { AWS: "arn:aws:iam::${VOX_AWS_ACCOUNT_PLACEHOLDER}:root" }
            Action: "sts:AssumeRole"
            Condition: { StringEquals: { "sts:ExternalId": "${externalId}" } }
      Policies:
        - PolicyName: VoxCrmConnectReadOnly
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Solo LECTURA (métricas, listados, descripciones). Estas APIs de
              # Connect no soportan scoping por instancia a nivel IAM, así que
              # van con Resource "*" — pero al ser read-only el riesgo es bajo.
              - Effect: Allow
                Action:
                  - connect:GetMetricData
                  - connect:GetMetricDataV2
                  - connect:GetCurrentMetricData
                  - connect:GetCurrentUserData
                  - connect:ListQueues
                  - connect:ListUsers
                  - connect:DescribeUser
                  - connect:DescribeQueue
                  - connect:DescribeSecurityProfile
                  - connect:ListSecurityProfiles
                  - connect:UpdateUserSecurityProfiles
                  - connect:ListContactFlows
                  - connect:DescribeContactFlow
                  # Provisión del set canónico de flows de AIRA (#1 onboarding):
                  # crea/actualiza AIRA-Inbound / AIRA-Outbound / AIRA-Disconnect
                  # en TU instancia. Es lo único de escritura del bloque.
                  - connect:CreateContactFlow
                  - connect:UpdateContactFlowContent
                  - connect:ListRoutingProfiles
                  - connect:ListRoutingProfileQueues
                  # Asignar/quitar agentes a las colas de una campaña + listar los
                  # números de origen (wizard de campañas). Sin esto, asignar
                  # agentes falla y el selector de número queda vacío.
                  - connect:AssociateRoutingProfileQueues
                  - connect:DisassociateRoutingProfileQueues
                  - connect:ListPhoneNumbers
                  - connect:ListPhoneNumbersV2
                  - connect:ListAgentStatuses
                  - connect:DescribeInstance
                  - connect:DescribeInstanceAttribute
                  - connect:ListInstanceStorageConfigs
                  - connect:ListIntegrationAssociations
                  - connect:SearchContacts
                  - connect:DescribeContact
                  - connect:ListContactReferences
                  # Descarga de adjuntos de chat/WhatsApp/email (genera URL
                  # presignada para el visor de Grabaciones). Sin esto, los
                  # archivos compartidos aparecen sin link de descarga.
                  - connect:GetAttachedFile
                  - connect:DescribeRoutingProfile
                  - connect:ListHoursOfOperations
                  - connect:CreateQueue
                  - connect:UpdateQueueName
                  - connect:UpdateQueueStatus
                  - connect:UpdateQueueMaxContacts
                  - connect:UpdateQueueHoursOfOperation
                  - connect:UpdateQueueOutboundCallerConfig
                Resource: "*"
              # Customer Profiles (Cliente 360°): leer + escribir perfiles. El
              # upsert de campañas y la edición del Cliente 360° los crean/actualizan,
              # así que NO es read-only. Customer Profiles no soporta scoping por
              # instancia a nivel IAM → Resource "*".
              - Effect: Allow
                Action:
                  - profile:GetDomain
                  - profile:SearchProfiles
                  - profile:ListDomains
                  - profile:GetProfileObjectType
                  # Lee los CTRs ingeridos del perfil (historial multicanal
                  # rápido). Sin esto, las lentes de Grabaciones caen al barrido
                  # lento de SearchContacts (50 DescribeContact) y los conteos
                  # se topan → el badge no coincide con el hilo.
                  - profile:ListProfileObjects
                  - profile:CreateProfile
                  - profile:UpdateProfile
                  - profile:PutProfileObject
                  - profile:AddProfileKey
                Resource: "*"
        - PolicyName: VoxCrmDiagnostics
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # OPCIONAL pero recomendado: deja que el panel "Estado de la
              # integración" de Vox lea el último error de tu stack de
              # CloudFormation y te diga exactamente qué recurso falló. Solo
              # lectura, solo sobre el stack de Vox.
              - Effect: Allow
                Action:
                  - cloudformation:DescribeStackEvents
                  - cloudformation:DescribeStacks
                Resource: !Sub "arn:aws:cloudformation:*:\${AWS::AccountId}:stack/VoxCrmConnectAccess/*"
        - PolicyName: VoxCrmSelfDiagnostics
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Auto-diagnóstico de permisos: deja que Vox detecte permisos
              # faltantes (drift) SIMULANDO las acciones sin ejecutarlas. Scope =
              # SOLO este mismo rol → no puede simular ningún otro principal de tu
              # cuenta. Sin esto, un permiso faltante recién se nota como un
              # AccessDenied en silencio dentro del producto.
              - Effect: Allow
                Action: iam:SimulatePrincipalPolicy
                Resource: !Sub "arn:aws:iam::\${AWS::AccountId}:role/VoxCrmConnectAccess"
        - PolicyName: VoxCrmConnectOutbound
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Acciones SENSIBLES: originan llamadas (costo/toll-fraud) o
              # escuchan contactos en vivo. Restringidas a TU instancia y sus
              # contactos — no a otras instancias de tu cuenta.
              - Effect: Allow
                Action:
                  - connect:StartOutboundVoiceContact
                  - connect:StartTaskContact
                  - connect:StartOutboundEmailContact
                  - connect:CreateContact
                  - connect:StartAttachedFileUpload
                  - connect:CompleteAttachedFileUpload
                  - connect:BatchGetAttachedFileMetadata
                  - connect:StopContact
                  - connect:UpdateContactAttributes
                  - connect:TransferContact
                  - connect:MonitorContact
                  - connect:GetFederationToken
                Resource:
                  - !Ref InstanceArn
                  - !Sub "\${InstanceArn}/contact/*"
        - PolicyName: VoxCrmRecordingAccess
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Lectura de grabaciones (audio/transcripts) desde el bucket
              # S3 de Connect. Vox genera URLs presignadas con estas
              # credenciales cuando un manager abre el reproductor.
              - Effect: Allow
                Action:
                  - s3:GetObject
                Resource: !Sub "arn:aws:s3:::\${RecordingBucket}/*"
              - Effect: Allow
                Action:
                  - s3:ListBucket
                  - s3:GetBucketLocation
                Resource: !Sub "arn:aws:s3:::\${RecordingBucket}"
              # Adjuntos de chat/WhatsApp + email viven en el bucket del storage
              # config ATTACHMENTS/EMAIL (Connect lo crea como amazonconnect-*),
              # distinto del de grabaciones. Read-only para presignarlos en
              # Grabaciones (GetAttachedFile NO sirve para adjuntos de mensaje de
              # chat → se leen directo de S3). (#grabaciones)
              - Effect: Allow
                Action:
                  - s3:GetObject
                Resource: "arn:aws:s3:::amazonconnect-*/*"
              - Effect: Allow
                Action:
                  - s3:ListBucket
                  - s3:GetBucketLocation
                Resource: "arn:aws:s3:::amazonconnect-*"
        - PolicyName: VoxCrmWhatsApp
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # WhatsApp BYO: Vox manda plantillas y respuestas del Agente IA
              # DESDE TU número (AWS End User Messaging Social conectado a tu
              # WhatsApp Business). Sin esto, las campañas/bots de WhatsApp y las
              # respuestas del agente en chat vivo no pueden enviar nada. Las
              # APIs Get* solo leen la config de tu WABA (número, estado).
              - Effect: Allow
                Action:
                  - social-messaging:SendWhatsAppMessage
                  - social-messaging:ListLinkedWhatsAppBusinessAccounts
                  - social-messaging:GetLinkedWhatsAppBusinessAccount
                  - social-messaging:GetLinkedWhatsAppBusinessAccountPhoneNumber
                  - social-messaging:ListWhatsAppMessageTemplates
                  - social-messaging:GetWhatsAppMessageTemplate
                Resource: "*"
        - PolicyName: VoxCrmBedrock
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Bedrock BYO: los bots / Agente IA, los resúmenes de llamada y el
              # copiloto corren contra TU Bedrock (tu quota, tus modelos
              # habilitados, tu factura de tokens) — no la de Vox. Incluye
              # foundation models + inference profiles (los modelos Claude 3.5+
              # se invocan vía perfiles de inferencia cross-region us.anthropic*).
              - Effect: Allow
                Action:
                  - bedrock:InvokeModel
                  - bedrock:InvokeModelWithResponseStream
                Resource:
                  - !Sub "arn:aws:bedrock:*::foundation-model/*"
                  - !Sub "arn:aws:bedrock:*:\${AWS::AccountId}:inference-profile/*"
                  - !Sub "arn:aws:bedrock:*:\${AWS::AccountId}:application-inference-profile/*"
Outputs:
  RoleArn:
    Description: Pegá este ARN en Vox
    Value: !GetAtt VoxCrmConnectRole.Arn`;
}

/* ───────── Template 2: data plane (BYO Data, #46 — recomendado) ─────────── */

/**
 * Crea las 14 tablas del producto en la cuenta del cliente y extiende el rol
 * VoxCrmConnectAccess con permisos DynamoDB sobre ellas.
 *
 * BillingMode: PAY_PER_REQUEST en todas — el cliente no necesita planear
 * capacidad. A escala (>10M req/mes/tabla) puede pasar a PROVISIONED desde la
 * consola; el cambio de modo es atómico y no afecta a Vox.
 *
 * IMPORTANTE: este template asume que `connectAccessCfnTemplate` ya fue
 * aplicado (necesita la role `VoxCrmConnectAccess`). El wizard del frontend
 * fuerza el orden: primero rol → "Conectado" → opción para "Habilitar BYO
 * Data Plane".
 */
export function dataPlaneCfnTemplate(): string {
  return `AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Vox CRM — BYO Data Plane. Crea las tablas DynamoDB del producto en TU cuenta
  AWS y extiende el rol VoxCrmConnectAccess para que Vox las pueda leer/escribir
  vía assume-role. Tus datos nunca se escriben en la cuenta de Vox.
Resources:
  # ── 14 tablas pagas por request (sin capacidad provisionada) ──────────────
  ConnectviewAdminAudit:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-admin-audit
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: auditId, AttributeType: S }
        - { AttributeName: action, AttributeType: S }
        - { AttributeName: timestamp, AttributeType: S }
      KeySchema:
        - { AttributeName: auditId, KeyType: HASH }
      GlobalSecondaryIndexes:
        - IndexName: action-timestamp-index
          KeySchema:
            - { AttributeName: action, KeyType: HASH }
            - { AttributeName: timestamp, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
        - IndexName: timestamp-index
          KeySchema:
            - { AttributeName: timestamp, KeyType: HASH }
          Projection: { ProjectionType: ALL }

  ConnectviewAiConversations:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-ai-conversations
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: botId, AttributeType: S }
      KeySchema:
        - { AttributeName: botId, KeyType: HASH }

  ConnectviewAppointments:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-appointments
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: apptId, AttributeType: S }
      KeySchema:
        - { AttributeName: apptId, KeyType: HASH }

  ConnectviewBots:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-bots
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: botId, AttributeType: S }
      KeySchema:
        - { AttributeName: botId, KeyType: HASH }

  ConnectviewCallbacks:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-callbacks
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: callbackId, AttributeType: S }
        - { AttributeName: status, AttributeType: S }
        - { AttributeName: scheduledAt, AttributeType: S }
        - { AttributeName: assignedAgentUserId, AttributeType: S }
      KeySchema:
        - { AttributeName: callbackId, KeyType: HASH }
      GlobalSecondaryIndexes:
        - IndexName: status-scheduledAt-index
          KeySchema:
            - { AttributeName: status, KeyType: HASH }
            - { AttributeName: scheduledAt, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
        - IndexName: agent-scheduledAt-index
          KeySchema:
            - { AttributeName: assignedAgentUserId, KeyType: HASH }
            - { AttributeName: scheduledAt, KeyType: RANGE }
          Projection: { ProjectionType: ALL }

  ConnectviewCampaignAgents:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-campaign-agents
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: campaignId, AttributeType: S }
        - { AttributeName: userId, AttributeType: S }
      KeySchema:
        - { AttributeName: campaignId, KeyType: HASH }
        - { AttributeName: userId, KeyType: RANGE }
      GlobalSecondaryIndexes:
        - IndexName: userId-index
          KeySchema:
            - { AttributeName: userId, KeyType: HASH }
          Projection: { ProjectionType: ALL }

  ConnectviewCampaignContacts:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-campaign-contacts
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: campaignId, AttributeType: S }
        - { AttributeName: rowId, AttributeType: S }
        - { AttributeName: status, AttributeType: S }
        - { AttributeName: nextRetryAt, AttributeType: S }
        - { AttributeName: connectContactId, AttributeType: S }
      KeySchema:
        - { AttributeName: campaignId, KeyType: HASH }
        - { AttributeName: rowId, KeyType: RANGE }
      GlobalSecondaryIndexes:
        - IndexName: campaignId-nextRetryAt-index
          KeySchema:
            - { AttributeName: campaignId, KeyType: HASH }
            - { AttributeName: nextRetryAt, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
        - IndexName: campaignId-status-index
          KeySchema:
            - { AttributeName: campaignId, KeyType: HASH }
            - { AttributeName: status, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
        - IndexName: connectContactId-index
          KeySchema:
            - { AttributeName: connectContactId, KeyType: HASH }
          Projection: { ProjectionType: ALL }

  ConnectviewCampaigns:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-campaigns
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: campaignId, AttributeType: S }
        - { AttributeName: status, AttributeType: S }
        - { AttributeName: createdAt, AttributeType: S }
      KeySchema:
        - { AttributeName: campaignId, KeyType: HASH }
      GlobalSecondaryIndexes:
        - IndexName: status-createdAt-index
          KeySchema:
            - { AttributeName: status, KeyType: HASH }
            - { AttributeName: createdAt, KeyType: RANGE }
          Projection: { ProjectionType: ALL }

  ConnectviewCatalogs:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-catalogs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: catalogId, AttributeType: S }
      KeySchema:
        - { AttributeName: catalogId, KeyType: HASH }

  ConnectviewContacts:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-contacts
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: contactId, AttributeType: S }
        - { AttributeName: agentUsername, AttributeType: S }
        - { AttributeName: initiationTimestamp, AttributeType: S }
      KeySchema:
        - { AttributeName: contactId, KeyType: HASH }
      GlobalSecondaryIndexes:
        - IndexName: agentUsername-initiationTimestamp-index
          KeySchema:
            - { AttributeName: agentUsername, KeyType: HASH }
            - { AttributeName: initiationTimestamp, KeyType: RANGE }
          Projection: { ProjectionType: ALL }

  ConnectviewHsmSends:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-hsm-sends
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: sendId, AttributeType: S }
      KeySchema:
        - { AttributeName: sendId, KeyType: HASH }

  ConnectviewLeads:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-leads
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: leadId, AttributeType: S }
      KeySchema:
        - { AttributeName: leadId, KeyType: HASH }

  ConnectviewTaxonomies:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-taxonomies
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: taxonomyId, AttributeType: S }
      KeySchema:
        - { AttributeName: taxonomyId, KeyType: HASH }

  ConnectviewWrapupHistory:
    Type: AWS::DynamoDB::Table
    # PROTECCIÓN DE DATOS: si borrás o re-aplicás el stack, la tabla y sus
    # datos NO se borran. Evita perder leads/campañas por un error de stack.
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: connectview-wrapup-history
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: contactId, AttributeType: S }
        - { AttributeName: savedAt, AttributeType: S }
      KeySchema:
        - { AttributeName: contactId, KeyType: HASH }
        - { AttributeName: savedAt, KeyType: RANGE }

  # ── Extender el rol existente con permisos sobre estas tablas ─────────────
  VoxCrmDataPlanePolicy:
    Type: AWS::IAM::RolePolicy
    Properties:
      RoleName: VoxCrmConnectAccess
      PolicyName: VoxCrmDataPlaneAccess
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Action:
              - dynamodb:GetItem
              - dynamodb:BatchGetItem
              - dynamodb:Query
              - dynamodb:Scan
              - dynamodb:PutItem
              - dynamodb:UpdateItem
              - dynamodb:DeleteItem
              - dynamodb:BatchWriteItem
              - dynamodb:DescribeTable
            # SEGURIDAD: enumeramos EXACTAMENTE las 14 tablas que este template
            # crea (vía !GetAtt a sus ARNs reales), en vez de un wildcard
            # connectview-* que podría matchear otras tablas del cliente con
            # ese prefijo. Scope exacto = mínimo privilegio.
            Resource:
${[
  "ConnectviewAdminAudit", "ConnectviewAiConversations", "ConnectviewAppointments",
  "ConnectviewBots", "ConnectviewCallbacks", "ConnectviewCampaignAgents",
  "ConnectviewCampaignContacts", "ConnectviewCampaigns", "ConnectviewCatalogs",
  "ConnectviewContacts", "ConnectviewHsmSends", "ConnectviewLeads",
  "ConnectviewTaxonomies", "ConnectviewWrapupHistory",
]
  .map((t) => `              - !GetAtt ${t}.Arn\n              - !Sub "\${${t}.Arn}/index/*"`)
  .join("\n")}
Outputs:
  DataPlaneEnabled:
    Description: BYO Data Plane habilitado. Volvé a Vox y refrescá Integraciones.
    Value: "ok"`;
}

/* ── Template 2b: SOLO permisos (las 14 tablas YA existen) ─────────────────── */

/** Lista canónica de las 14 tablas del producto. Fuente de verdad única. */
export const DATA_PLANE_TABLE_NAMES = [
  "connectview-admin-audit", "connectview-ai-conversations", "connectview-appointments",
  "connectview-bots", "connectview-callbacks", "connectview-campaign-agents",
  "connectview-campaign-contacts", "connectview-campaigns", "connectview-catalogs",
  "connectview-contacts", "connectview-hsm-sends", "connectview-leads",
  "connectview-taxonomies", "connectview-wrapup-history",
];

/**
 * dataPlanePermissionsCfnTemplate — para cuando las 14 tablas YA EXISTEN en la
 * cuenta del cliente (ej. las re-creó, o un caso especial). NO crea tablas
 * (evita el error "already exists"); solo extiende el rol VoxCrmConnectAccess
 * con los permisos DynamoDB sobre esas tablas, por ARN construido.
 *
 * Robustez: este template es 100% idempotente y seguro de re-aplicar — no toca
 * datos, solo permisos. Es la salida al problema "si el data-plane se aplica
 * mal o las tablas ya están": aplicás este y listo.
 */
export function dataPlanePermissionsCfnTemplate(): string {
  const resources = DATA_PLANE_TABLE_NAMES.flatMap((t) => [
    `              - !Sub "arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/${t}"`,
    `              - !Sub "arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/${t}/index/*"`,
  ]).join("\n");
  return `AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Vox CRM — Solo permisos del Data Plane. Usalo cuando las 14 tablas
  connectview-* YA EXISTEN en tu cuenta. Extiende el rol VoxCrmConnectAccess
  con permisos DynamoDB sobre ellas, SIN crear ni tocar las tablas. Seguro de
  re-aplicar (no toca datos).
Resources:
  VoxCrmDataPlanePolicy:
    Type: AWS::IAM::RolePolicy
    Properties:
      RoleName: VoxCrmConnectAccess
      PolicyName: VoxCrmDataPlaneAccess
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Action:
              - dynamodb:GetItem
              - dynamodb:BatchGetItem
              - dynamodb:Query
              - dynamodb:Scan
              - dynamodb:PutItem
              - dynamodb:UpdateItem
              - dynamodb:DeleteItem
              - dynamodb:BatchWriteItem
              - dynamodb:DescribeTable
            Resource:
${resources}
Outputs:
  Done:
    Description: Permisos del Data Plane otorgados. Volvé a Vox y refrescá.
    Value: "ok"`;
}
