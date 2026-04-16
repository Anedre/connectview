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

const CONNECT_INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197";
const CONNECT_INSTANCE_ARN = `arn:aws:connect:us-east-1:731736972577:instance/${CONNECT_INSTANCE_ID}`;
const ACCOUNT_ID = "731736972577";
const REGION = "us-east-1";

// Fixed table name to avoid circular cross-stack references
const CONTACTS_TABLE_NAME = "connectview-contacts";

const backend = defineBackend({
  auth,
  getRealtimeMetrics,
  processContactEvent,
  enrichContactLens,
  queryContacts,
  getRecording,
  listUsers,
});

// Helper to cast IFunction to Function for addEnvironment
function asFunction(fn: lambda.IFunction): lambda.Function {
  return fn as lambda.Function;
}

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
  actions: [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:GetItem",
  ],
  resources: [contactsTableArn, `${contactsTableArn}/index/*`],
});

const dynamoReadPolicy = new iam.PolicyStatement({
  actions: [
    "dynamodb:GetItem",
    "dynamodb:Query",
    "dynamodb:Scan",
  ],
  resources: [contactsTableArn, `${contactsTableArn}/index/*`],
});

const connectMetricsPolicy = new iam.PolicyStatement({
  actions: [
    "connect:GetCurrentMetricData",
    "connect:GetCurrentUserData",
    "connect:ListQueues",
  ],
  resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
});

const connectContactPolicy = new iam.PolicyStatement({
  actions: [
    "connect:DescribeContact",
    "connect:SearchContacts",
  ],
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
  })
);
asFunction(processEventLambda).addEnvironment("CONTACTS_TABLE_NAME", CONTACTS_TABLE_NAME);
asFunction(processEventLambda).addEnvironment("ENRICH_FUNCTION_NAME", enrichLambda.functionName);

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
  })
);
recordingLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: ["arn:aws:s3:::connect-*/*", "arn:aws:s3:::amazon-connect-*/*"],
  })
);
asFunction(recordingLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- list-users (now uses Connect instead of Cognito) ----
const listUsersLambda = backend.listUsers.resources.lambda;
listUsersLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "connect:ListUsers",
      "connect:DescribeUser",
      "connect:DescribeSecurityProfile",
    ],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  })
);
asFunction(listUsersLambda).addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

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


// ---- Export Function URLs to amplify_outputs.json ----
backend.addOutput({
  custom: {
    apiEndpoints: JSON.stringify({
      realtimeMetrics: metricsUrl.url,
      queryContacts: queryUrl.url,
      getRecording: recordingUrl.url,
      listUsers: usersUrl.url,
    }),
  },
});
