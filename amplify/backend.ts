import { defineBackend } from "@aws-amplify/backend";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib";
import { auth } from "./auth/resource";
import { getRealtimeMetrics } from "./functions/get-realtime-metrics/resource";
import { processContactEvent } from "./functions/process-contact-event/resource";
import { enrichContactLens } from "./functions/enrich-contact-lens/resource";
import { queryContacts } from "./functions/query-contacts/resource";
import { getRecording } from "./functions/get-recording/resource";
import { listUsers } from "./functions/list-users/resource";
import { lookupCustomerProfile } from "./functions/lookup-customer-profile/resource";
import { getLiveTranscript } from "./functions/get-live-transcript/resource";
import { getContactHistory } from "./functions/get-contact-history/resource";
import { listMissedContacts } from "./functions/list-missed-contacts/resource";
import { saveAgentNotes } from "./functions/save-agent-notes/resource";
import { generateCallSummary } from "./functions/generate-call-summary/resource";
import { getQSuggestions } from "./functions/get-q-suggestions/resource";
import { getAgentActiveContact } from "./functions/get-agent-active-contact/resource";

const CONNECT_INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197";
const CONNECT_INSTANCE_ARN = `arn:aws:connect:us-east-1:731736972577:instance/${CONNECT_INSTANCE_ID}`;
const ACCOUNT_ID = "731736972577";
const REGION = "us-east-1";

// Fixed table name to avoid circular cross-stack references
const CONTACTS_TABLE_NAME = "connectview-contacts";
const CUSTOMER_PROFILES_DOMAIN = "amazon-connect-novasys";
// connectview-leads: tabla hand-managed (NO la crea este stack; vive fuera de
// Amplify, como el resto de connectview-*). process-contact-event solo la LEE por
// el GSI phone-index y le estampa el agente (assignedAgent) al cerrar una llamada.
const LEADS_TABLE_NAME = "connectview-leads";
const LEADS_PHONE_INDEX = "phone-index";

// Config de save-agent-notes (follow-up tasks + hook de automatizaciones).
// Estaban seteadas por CLI → el próximo `ampx` deploy las borraba (drift). Ahora
// viven acá para que persistan. (El secreto VOX_INTERNAL_SECRET NO va acá — ver
// nota abajo en el bloque de notesLambda.)
const FOLLOWUP_FLOW_ID = "29bb28ad-0419-40d4-97db-332f2c8d50c7";
const FOLLOWUP_QUEUE_ID = "9ff3b0a1-90aa-4d2a-8029-c4526a22adc8";
const AUTOMATION_ENGINE_URL =
  "https://qs6iucpkdm2uashflmlrfvxnha0isdzz.lambda-url.us-east-1.on.aws/";

const backend = defineBackend({
  auth,
  getRealtimeMetrics,
  processContactEvent,
  enrichContactLens,
  queryContacts,
  getRecording,
  listUsers,
  lookupCustomerProfile,
  getLiveTranscript,
  getContactHistory,
  listMissedContacts,
  saveAgentNotes,
  generateCallSummary,
  getQSuggestions,
  getAgentActiveContact,
});

// Helper to cast IFunction to Function for addEnvironment
function asFunction(fn: lambda.IFunction): lambda.Function {
  return fn as lambda.Function;
}

// ---- Cognito User Pool: correo por SES + validez de la contraseña temporal ----
// Por defecto el pool usa el correo "de prueba" de Cognito (COGNITO_DEFAULT, tope
// 50 emails/día para TODO el pool) → las invitaciones y los códigos de "olvidé mi
// contraseña" no llegan de forma confiable. Lo apuntamos a SES (dominio
// novasys.com.pe verificado con DKIM y fuera de sandbox) y subimos la validez de
// la contraseña temporal de 7 → 30 días, para que una invitación no caduque antes
// de que la persona alcance a entrar (ese caso deja al usuario en
// FORCE_CHANGE_PASSWORD, donde Cognito NO permite "olvidé mi contraseña").
// NOTA: este bloque toma efecto con `npx ampx pipeline-deploy`. Se aplicó también
// en vivo por CLI (update-user-pool) para efecto inmediato; el código lo persiste
// para que un deploy futuro no revierta el cambio (drift).
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.emailConfiguration = {
  emailSendingAccount: "DEVELOPER",
  from: "ARIA <no-reply@novasys.com.pe>",
  sourceArn: `arn:aws:ses:${REGION}:${ACCOUNT_ID}:identity/novasys.com.pe`,
};
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    requireUppercase: true,
    temporaryPasswordValidityDays: 30,
  },
};

// ---- DynamoDB Table + EventBridge in the "data" resource group stack ----
const dataStack = cdk.Stack.of(backend.processContactEvent.resources.lambda);

new dynamodb.Table(dataStack, "ContactsTable", {
  tableName: CONTACTS_TABLE_NAME,
  partitionKey: { name: "contactId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true,
}).addGlobalSecondaryIndex({
  indexName: "agentUsername-initiationTimestamp-index",
  partitionKey: { name: "agentUsername", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "initiationTimestamp", type: dynamodb.AttributeType.STRING },
});

const contactsTableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${CONTACTS_TABLE_NAME}`;

// EventBridge rule in the same data stack (no cross-stack refs needed - target added below)
const connectEventRule = new events.Rule(dataStack, "ConnectContactRule", {
  eventPattern: {
    source: ["aws.connect"],
    detailType: ["Amazon Connect Contact Event"],
    detail: {
      instanceArn: [CONNECT_INSTANCE_ARN],
    },
  },
});

// ---- Lambda permissions via IAM policies (no cross-stack grants) ----

// DynamoDB policy for all lambdas that need table access
const dynamoWritePolicy = new iam.PolicyStatement({
  actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:GetItem"],
  resources: [contactsTableArn, `${contactsTableArn}/index/*`],
});

const dynamoReadPolicy = new iam.PolicyStatement({
  actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
  resources: [contactsTableArn, `${contactsTableArn}/index/*`],
});

const connectMetricsPolicy = new iam.PolicyStatement({
  actions: [
    "connect:GetCurrentMetricData",
    "connect:GetCurrentUserData",
    "connect:GetMetricDataV2",
    "connect:ListQueues",
    "connect:ListUsers",
  ],
  resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
});

const connectContactPolicy = new iam.PolicyStatement({
  actions: ["connect:DescribeContact", "connect:SearchContacts"],
  resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
});

// ---- get-realtime-metrics ----
const realtimeMetricsLambda = backend.getRealtimeMetrics.resources.lambda;
realtimeMetricsLambda.addToRolePolicy(connectMetricsPolicy);
asFunction(realtimeMetricsLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- enrich-contact-lens ----
const enrichLambda = backend.enrichContactLens.resources.lambda;
enrichLambda.addToRolePolicy(connectContactPolicy);
enrichLambda.addToRolePolicy(dynamoWritePolicy);
asFunction(enrichLambda).addEnvironment("CONTACTS_TABLE_NAME", CONTACTS_TABLE_NAME);

// ---- process-contact-event ----
const processEventLambda = backend.processContactEvent.resources.lambda;
processEventLambda.addToRolePolicy(dynamoWritePolicy);
processEventLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [enrichLambda.functionArn],
  }),
);
// Estampado del agente sobre el lead (Pipeline de /reports · "quién atendió la
// llamada"): leer el GSI phone-index y actualizar connectview-leads.assignedAgent.
// La tabla es hand-managed (fuera de Amplify) → se referencia por ARN, sin grant
// cross-stack. Ver [[reference_new_lambda_iam]]: acá NO aplica el rol del tenant
// (VoxCrmConnectAccess) porque este Lambda escribe con su PROPIO rol de ejecución.
const leadsTableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${LEADS_TABLE_NAME}`;
processEventLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [`${leadsTableArn}/index/${LEADS_PHONE_INDEX}`],
  }),
);
processEventLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
    resources: [leadsTableArn],
  }),
);
asFunction(processEventLambda).addEnvironment("CONTACTS_TABLE_NAME", CONTACTS_TABLE_NAME);
asFunction(processEventLambda).addEnvironment("ENRICH_FUNCTION_NAME", enrichLambda.functionName);
asFunction(processEventLambda).addEnvironment("LEADS_TABLE", LEADS_TABLE_NAME);
asFunction(processEventLambda).addEnvironment("LEADS_PHONE_INDEX", LEADS_PHONE_INDEX);

// Add EventBridge target (this creates a cross-ref but only DataStack → function, not circular)
connectEventRule.addTarget(new targets.LambdaFunction(processEventLambda));

// ---- query-contacts ----
const queryContactsLambda = backend.queryContacts.resources.lambda;
queryContactsLambda.addToRolePolicy(dynamoReadPolicy);
asFunction(queryContactsLambda).addEnvironment("CONTACTS_TABLE_NAME", CONTACTS_TABLE_NAME);

// ---- get-recording ----
const recordingLambda = backend.getRecording.resources.lambda;
recordingLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:DescribeContact"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
recordingLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: ["arn:aws:s3:::connect-*/*", "arn:aws:s3:::amazon-connect-*/*"],
  }),
);
asFunction(recordingLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- list-users (now uses Connect instead of Cognito) ----
const listUsersLambda = backend.listUsers.resources.lambda;
listUsersLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:ListUsers", "connect:DescribeUser", "connect:DescribeSecurityProfile"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
asFunction(listUsersLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- lookup-customer-profile (uses Amazon Connect Customer Profiles) ----
const profileLambda = backend.lookupCustomerProfile.resources.lambda;
profileLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "profile:SearchProfiles",
      "profile:ListProfileObjects",
      "profile:GetProfileObjectType",
    ],
    resources: [
      `arn:aws:profile:${REGION}:${ACCOUNT_ID}:domains/${CUSTOMER_PROFILES_DOMAIN}`,
      `arn:aws:profile:${REGION}:${ACCOUNT_ID}:domains/${CUSTOMER_PROFILES_DOMAIN}/*`,
    ],
  }),
);
// Tenant resolution: leer la config del tenant + asumir su rol, para que
// getTenantConnect/resolveCustomerProfiles resuelva (founder t_* Y tenants BYO).
// SIN esto, resolveCustomerProfiles cae a "blocked" → NO SALEN LOS PERFILES.
profileLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["dynamodb:GetItem"],
    resources: [`arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/connectview-connections`],
  }),
);
profileLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["sts:AssumeRole"],
    resources: ["arn:aws:iam::*:role/VoxCrmConnectAccess"],
  }),
);
asFunction(profileLambda).addEnvironment("CUSTOMER_PROFILES_DOMAIN", CUSTOMER_PROFILES_DOMAIN);

// ---- get-live-transcript (Contact Lens real-time) ----
const liveTranscriptLambda = backend.getLiveTranscript.resources.lambda;
liveTranscriptLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:ListRealtimeContactAnalysisSegments"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
// Tenant resolution (mismo motivo que lookup-customer-profile): leer config +
// asumir el rol del tenant para que resolveConnect resuelva SU instancia/Contact
// Lens. Sin esto, founder/tenant → bloqueado → transcripción en vivo vacía.
liveTranscriptLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["dynamodb:GetItem"],
    resources: [`arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/connectview-connections`],
  }),
);
liveTranscriptLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["sts:AssumeRole"],
    resources: ["arn:aws:iam::*:role/VoxCrmConnectAccess"],
  }),
);
asFunction(liveTranscriptLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- get-contact-history (SearchContacts + DescribeContact) ----
const historyLambda = backend.getContactHistory.resources.lambda;
historyLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:SearchContacts", "connect:DescribeContact"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
asFunction(historyLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- list-missed-contacts (SearchContacts + DescribeContact + DescribeQueue) ----
// Powers the "Perdidas hoy" drawer in the agent desktop. Filters
// SearchContacts results to the ones the agent failed to accept.
const missedLambda = backend.listMissedContacts.resources.lambda;
missedLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:SearchContacts", "connect:DescribeContact", "connect:DescribeQueue"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
asFunction(missedLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- save-agent-notes (DynamoDB) ----
const notesLambda = backend.saveAgentNotes.resources.lambda;
notesLambda.addToRolePolicy(dynamoWritePolicy);
notesLambda.addToRolePolicy(dynamoReadPolicy);
asFunction(notesLambda).addEnvironment("CONTACTS_TABLE_NAME", CONTACTS_TABLE_NAME);
// Config que estaba seteada por CLI (drift en ampx). Ahora persiste vía backend.ts.
asFunction(notesLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);
asFunction(notesLambda).addEnvironment("FOLLOWUP_FLOW_ID", FOLLOWUP_FLOW_ID);
asFunction(notesLambda).addEnvironment("FOLLOWUP_QUEUE_ID", FOLLOWUP_QUEUE_ID);
asFunction(notesLambda).addEnvironment("AUTOMATION_ENGINE_URL", AUTOMATION_ENGINE_URL);
// NOTA: VOX_INTERNAL_SECRET (lo usa fireAutomation para disparar #15 desde el
// wrap-up) NO se setea acá a propósito — es un SECRETO. Setealo como secret de
// Amplify (`npx ampx sandbox secret set VOX_INTERNAL_SECRET`) o por CLI tras el
// deploy. Sin él, el wrap-up guarda igual pero las automatizaciones no se
// disparan desde save-agent-notes (degrada sin romper).

// ---- generate-call-summary (Bedrock + Contact Lens) ----
const summaryLambda = backend.generateCallSummary.resources.lambda;
summaryLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["bedrock:InvokeModel"],
    // Wildcard required for cross-region inference profiles (us.* prefix routes to multiple regions).
    // Claude 3.5+ no longer supports on-demand foundation model invocation directly.
    resources: ["*"],
  }),
);
summaryLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["connect:ListRealtimeContactAnalysisSegments"],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
asFunction(summaryLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);
asFunction(summaryLambda).addEnvironment(
  "BEDROCK_MODEL_ID",
  // US cross-region inference profile for Claude Haiku 4.5 — fast and active.
  // The older 3.5-haiku model is now legacy and blocked unless used in last 30 days.
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
);

// ---- get-q-suggestions (Amazon Q in Connect / Wisdom) ----
const qLambda = backend.getQSuggestions.resources.lambda;
qLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["wisdom:QueryAssistant", "wisdom:GetRecommendations", "wisdom:SearchContent"],
    resources: ["*"],
  }),
);
// Q Assistant ID comes from the Wisdom integration we saw in the instance
asFunction(qLambda).addEnvironment("Q_ASSISTANT_ID", "f5a5f6cf-9bd5-429a-88bb-70ba7c132f4d");

// ---- get-agent-active-contact (GetCurrentUserData - bypasses Streams stale IPC) ----
const activeContactLambda = backend.getAgentActiveContact.resources.lambda;
activeContactLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "connect:GetCurrentUserData",
      "connect:ListUsers",
      // DescribeContact is used as a fallback when GetCurrentUserData returns null CustomerEndpoint
      "connect:DescribeContact",
    ],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  }),
);
asFunction(activeContactLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- Function URLs for frontend API access (NONE auth for simplicity, app behind Cognito) ----
const metricsUrl = asFunction(realtimeMetricsLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const queryUrl = asFunction(queryContactsLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const recordingUrl = asFunction(recordingLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const usersUrl = asFunction(listUsersLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
    allowedHeaders: ["*"],
  },
});

const profileUrl = asFunction(profileLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const liveTranscriptUrl = asFunction(liveTranscriptLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const historyUrl = asFunction(historyLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const missedContactsUrl = asFunction(missedLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const notesUrl = asFunction(notesLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
    allowedHeaders: ["*"],
  },
});

const summaryUrl = asFunction(summaryLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ["*"],
  },
});

const qUrl = asFunction(qLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

const activeContactUrl = asFunction(activeContactLambda).addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ["*"],
  },
});

// ---- Export Function URLs to amplify_outputs.json ----
backend.addOutput({
  custom: {
    apiEndpoints: JSON.stringify({
      realtimeMetrics: metricsUrl.url,
      queryContacts: queryUrl.url,
      getRecording: recordingUrl.url,
      listUsers: usersUrl.url,
      lookupCustomerProfile: profileUrl.url,
      getLiveTranscript: liveTranscriptUrl.url,
      getContactHistory: historyUrl.url,
      listMissedContacts: missedContactsUrl.url,
      saveAgentNotes: notesUrl.url,
      generateCallSummary: summaryUrl.url,
      getQSuggestions: qUrl.url,
      getAgentActiveContact: activeContactUrl.url,
    }),
  },
});
