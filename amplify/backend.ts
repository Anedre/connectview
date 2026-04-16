import { defineBackend } from "@aws-amplify/backend";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { getRealtimeMetrics } from "./functions/get-realtime-metrics/resource";
import { processContactEvent } from "./functions/process-contact-event/resource";
import { enrichContactLens } from "./functions/enrich-contact-lens/resource";
import { queryContacts } from "./functions/query-contacts/resource";
import { getRecording } from "./functions/get-recording/resource";
import { listUsers } from "./functions/list-users/resource";

const CONNECT_INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197";
const CONNECT_INSTANCE_ARN = `arn:aws:connect:us-east-1:731736972577:instance/${CONNECT_INSTANCE_ID}`;

const backend = defineBackend({
  auth,
  getRealtimeMetrics,
  processContactEvent,
  enrichContactLens,
  queryContacts,
  getRecording,
  listUsers,
});

// ---- DynamoDB Table ----
const contactsTable = new dynamodb.Table(
  backend.createStack("ContactsTable"),
  "ContactsTable",
  {
    partitionKey: { name: "contactId", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    pointInTimeRecoveryEnabled: true,
  }
);

contactsTable.addGlobalSecondaryIndex({
  indexName: "agentUsername-initiationTimestamp-index",
  partitionKey: {
    name: "agentUsername",
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: "initiationTimestamp",
    type: dynamodb.AttributeType.STRING,
  },
});

contactsTable.addGlobalSecondaryIndex({
  indexName: "queueName-initiationTimestamp-index",
  partitionKey: { name: "queueName", type: dynamodb.AttributeType.STRING },
  sortKey: {
    name: "initiationTimestamp",
    type: dynamodb.AttributeType.STRING,
  },
});

// ---- Connect permissions for realtime metrics Lambda ----
const realtimeMetricsLambda = backend.getRealtimeMetrics.resources.lambda;
realtimeMetricsLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "connect:GetCurrentMetricData",
      "connect:GetCurrentUserData",
      "connect:ListQueues",
    ],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  })
);
realtimeMetricsLambda.addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- Connect + DynamoDB permissions for enrichment Lambda ----
const enrichLambda = backend.enrichContactLens.resources.lambda;
enrichLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "connect:DescribeContact",
      "connect:ListContactAnalyticsSummaries",
    ],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  })
);
contactsTable.grantWriteData(enrichLambda);
enrichLambda.addEnvironment("CONTACTS_TABLE_NAME", contactsTable.tableName);

// ---- DynamoDB + Lambda invoke permissions for process-contact-event ----
const processEventLambda = backend.processContactEvent.resources.lambda;
contactsTable.grantWriteData(processEventLambda);
processEventLambda.addEnvironment(
  "CONTACTS_TABLE_NAME",
  contactsTable.tableName
);
processEventLambda.addEnvironment(
  "ENRICH_FUNCTION_NAME",
  enrichLambda.functionName
);
enrichLambda.grantInvoke(processEventLambda);

// ---- DynamoDB read permissions for query-contacts Lambda ----
const queryContactsLambda = backend.queryContacts.resources.lambda;
contactsTable.grantReadData(queryContactsLambda);
queryContactsLambda.addEnvironment(
  "CONTACTS_TABLE_NAME",
  contactsTable.tableName
);

// ---- EventBridge Rule for Connect Contact Events ----
const eventStack = backend.createStack("ConnectEvents");

const connectEventRule = new events.Rule(eventStack, "ConnectContactRule", {
  eventPattern: {
    source: ["aws.connect"],
    detailType: ["Amazon Connect Contact Event"],
    detail: {
      instanceArn: [CONNECT_INSTANCE_ARN],
    },
  },
});

connectEventRule.addTarget(
  new targets.LambdaFunction(processEventLambda)
);

// ---- Recording Lambda permissions (Connect + S3) ----
const recordingLambda = backend.getRecording.resources.lambda;
recordingLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "connect:DescribeContact",
      "connect:ListRealtimeContactAnalysisSegmentsV2",
    ],
    resources: [CONNECT_INSTANCE_ARN, `${CONNECT_INSTANCE_ARN}/*`],
  })
);
recordingLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: ["arn:aws:s3:::connect-*/*", "arn:aws:s3:::amazon-connect-*/*"],
  })
);
recordingLambda.addEnvironment("CONNECT_INSTANCE_ID", CONNECT_INSTANCE_ID);

// ---- User management Lambda permissions (Cognito) ----
const listUsersLambda = backend.listUsers.resources.lambda;
listUsersLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      "cognito-idp:ListUsers",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
    ],
    resources: ["*"],
  })
);
// USER_POOL_ID is passed at deploy time from the auth construct
listUsersLambda.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);
