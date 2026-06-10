import outputs from "../../amplify_outputs.json";

interface ApiEndpoints {
  realtimeMetrics: string;
  queryContacts: string;
  getRecording: string;
  listUsers: string;
  lookupCustomerProfile: string;
  getLiveTranscript: string;
  getContactHistory: string;
  /** Optional — only present after deploying the list-missed-contacts
   *  Lambda. Used by the "Perdidas" drawer in the agent desktop. */
  listMissedContacts?: string;
  saveAgentNotes: string;
  generateCallSummary: string;
  getQSuggestions: string;
  getAgentActiveContact: string;
  getAgentLeaderboard?: string;
  getAgentWellness?: string;
  getChurnRisk?: string;
  // Campaign endpoints
  listContactFlows?: string;
  listSourcePhones?: string;
  createCampaign?: string;
  listCampaigns?: string;
  getCampaignStats?: string;
  getCampaignContacts?: string;
  controlCampaign?: string;
  // Queue manager / admin endpoints
  getLiveQueue?: string;
  adminTransferContact?: string;
  adminStopContact?: string;
  adminChangeAgentStatus?: string;
  adminMonitorContact?: string;
  adminUpdateContactAttrs?: string;
  adminListAudit?: string;
  // Campaign edit/clone/relaunch
  updateCampaign?: string;
  relaunchCampaign?: string;
  cloneCampaign?: string;
  editCampaignContacts?: string;
  listQueues?: string;
  assignCampaignAgents?: string;
  getCampaignAgents?: string;
  getFlowQueues?: string;
  // Outbound creation (task + email) — single Lambda dispatches by `type`.
  startOutboundContact?: string;
  // Lists the Connect-registered email "From" addresses for the New
  // Email composer's dropdown.
  listEmailAddresses?: string;
  // Idle Cliente 360° browser: search profiles by phone/email/name and
  // update editable fields. Same DynamoDB-audited admin-action style as
  // the rest of the privileged Lambdas.
  searchCustomerProfiles?: string;
  updateCustomerProfile?: string;
  // Lists recently-contacted customers (deduplicated by phone) for the
  // agent who's currently signed in. Powers the "Atendidos
  // recientemente" list in the idle Cliente 360° browser.
  listRecentCustomers?: string;
  // WhatsApp campaign endpoints — list Meta-approved templates and
  // send one to a single phone (used by the campaign-dialer when the
  // campaign type is "whatsapp").
  listWhatsAppTemplates?: string;
  sendWhatsAppTemplate?: string;
  // Callback / follow-up scheduling — agent promises a future
  // call/email/whatsapp; dispatcher fires (voice) or marks DUE
  // (email/whatsapp).
  scheduleCallback?: string;
  listCallbacks?: string;
  cancelCallback?: string;
  // Detailed contact view — audio recording presigned URL, transcript
  // (historical Contact Lens or chat), attachments with presigned URLs.
  getContactDetail?: string;
  // Unified WhatsApp/chat thread — merges every CHAT contact for a phone
  // into one chronological timeline with session boundaries and a per-day
  // activity histogram for the calendar picker.
  getCustomerThread?: string;
  // Cross-channel attachment grid — every file the customer shared (or we
  // sent) across all voice / chat / email contacts, with presigned URLs.
  getCustomerAttachments?: string;
  // Unified disposition taxonomy — the single source of truth every
  // channel's wrap-up reads. CRUD over connectview-taxonomies. Replaces
  // the old hardcoded tree in lib/dispositions.ts.
  manageTaxonomy?: string;
  // Vox → Salesforce sync — fired after a wrap-up is saved. Upserts a
  // Lead + logs a Task, mapping the unified tipificación to Lead Status.
  salesforceSync?: string;
  // HSM Outbound report — aggregates WhatsApp template sends by template
  // (sent/delivered/read/failed). Chattigo's flagship report.
  getHsmReport?: string;
  // Custom Lists / Catálogos — arbitrary lookup tables (products, SKUs,
  // price lists) referenceable from leads / bot / scripts.
  manageCatalog?: string;
  // Unified lead funnel — CRUD + move-stage over connectview-leads. Board
  // columns are the canonical taxonomy stages.
  manageLeads?: string;
  // Native appointment scheduling — CRUD over connectview-appointments.
  manageAppointment?: string;
  // Granular RBAC matrix — capability → minimum role. useCan() checks it.
  managePermissions?: string;
  // Visual chat-flow builder (Salesbot equivalent #16) — CRUD over
  // connectview-bots (list/get/save/delete bot graphs).
  manageBot?: string;
  // Bot runtime engine — runs a bot graph turn-by-turn (powers the in-builder
  // "Probar bot" simulator + a Connect flow in production). ai_agent → Bedrock.
  botRuntime?: string;
  // ── SaaS multi-tenant: conexiones por organización ──────────────────
  // Lee/escribe la config de integraciones del tenant (Connect / Salesforce /
  // WhatsApp). Config NO sensible en DynamoDB; secretos en Secrets Manager.
  manageConnections?: string;
  // Verifica la conexión a Amazon Connect del tenant: asume el rol cross-account
  // y hace un llamado de prueba (DescribeInstance / ListQueues).
  verifyConnectConnection?: string;
  // Provisiona el set canónico de contact flows de ARIA (ARIA-Inbound /
  // -Outbound / -Disconnect) en la instancia del tenant. dryRun previsualiza.
  provisionContactFlows?: string;
  // Inicia el flujo OAuth web de Salesforce (devuelve la URL de autorización).
  salesforceOAuthStart?: string;
  // Callback del OAuth web de Salesforce. SF redirige acá con ?code=…&state=…
  // intercambia el code por refresh_token y lo persiste en Secrets per-tenant.
  // El frontend NO lo llama; el navegador del usuario lo abre vía redirect.
  salesforceOAuthCallback?: string;
  // Federación silenciosa del CCP (#45). El frontend lo llama antes de initCCP;
  // si la instancia del tenant soporta SAML el Lambda devuelve un signInUrl que
  // el iframe del CCP usa como loginUrl. Sin SAML, devuelve signInUrl=null y el
  // frontend cae al popup login clásico (sin error visible).
  getFederationToken?: string;
  // Health-check completo de la integración: corre chequeos read-only contra
  // el Connect del cliente (Contact Lens, grabaciones, Customer Profiles, S3,
  // Data Plane, CloudFormation) y devuelve estado + remediación por cada uno.
  // Lo consume el panel "Estado de la integración".
  diagnoseConnection?: string;
  // Provisión de organización en el primer login: crea el tenant, setea
  // custom:tenantId en el usuario y lo hace Admin de su org.
  provisionTenant?: string;
  // Invita a un trabajador a la organización del admin: AdminCreateUser en
  // Cognito atado al tenant del invitador + email con contraseña temporal.
  inviteUser?: string;
  // Lista los usuarios de Vox (Cognito) del tenant + sus roles. Distinto de
  // listUsers (que lista los agentes de Amazon Connect que toman llamadas).
  listTeam?: string;
  // Vincula un usuario de Vox con un agente de Amazon Connect (capa 2):
  // guarda custom:connectUser. Admin asigna a otros; usuario auto-confirma.
  setConnectLink?: string;
  // Reglas de automatización (#15): CRUD de triggers→condiciones→acciones
  // que el automation-engine ejecuta (eventos de hooks + tick de EventBridge).
  manageAutomations?: string;
}

let endpoints: ApiEndpoints | null = null;

export function getApiEndpoints(): ApiEndpoints | null {
  if (endpoints) return endpoints;

  try {
    const custom = (outputs as Record<string, unknown>).custom as
      | Record<string, string>
      | undefined;
    if (custom?.apiEndpoints) {
      endpoints = JSON.parse(custom.apiEndpoints);
      return endpoints;
    }
  } catch {
    // Endpoints not configured yet
  }
  return null;
}
