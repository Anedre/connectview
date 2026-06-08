import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getTenantConnect } from "../_shared/tenantConnect";
import { resolveTenantId } from "../_shared/cognitoAuth";

const legacyConnect = new ConnectClient({});
const legacyS3 = new S3Client({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

export const handler: APIGatewayProxyHandler = async (event) => {
  const contactId = event.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId is required" }),
    };
  }

  // Connect + S3 del tenant (assume-role) o legacy si no está configurado.
  // Las grabaciones viven en el bucket del Connect del cliente, así que el
  // S3 también tiene que estar tenant-scoped (no alcanza con cambiar sólo
  // Connect). Si el rol del cliente NO tiene s3:GetObject sobre su bucket,
  // el presign sale OK pero el browser recibe 403 — el wizard avisa.
  let connect: ConnectClient = legacyConnect;
  let s3: S3Client = legacyS3;
  let instanceId = INSTANCE_ID;
  try {
    const tenantId = await resolveTenantId(event?.headers);
    const tc = await getTenantConnect(tenantId);
    if (tc) {
      connect = tc.client;
      s3 = tc.s3;
      instanceId = tc.instanceId;
    }
  } catch (e) {
    console.error("resolveConnect en get-recording falló, uso legacy:", e);
  }

  try {
    // Get contact details including recording location
    const contactDesc = await connect.send(
      new DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      })
    );

    const contact = contactDesc.Contact;
    let recordingUrl = "";

    // Generate presigned URL for the recording if available
    const recordings = contact?.Recordings;
    if (recordings && recordings.length > 0) {
      const location = recordings[0].Location;
      if (location) {
        const bucketMatch = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (bucketMatch) {
          const command = new GetObjectCommand({
            Bucket: bucketMatch[1],
            Key: bucketMatch[2],
          });
          recordingUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        recordingUrl,
        duration:
          contact?.DisconnectTimestamp && contact?.InitiationTimestamp
            ? Math.round(
                (contact.DisconnectTimestamp.getTime() -
                  contact.InitiationTimestamp.getTime()) /
                  1000
              )
            : 0,
        hasRecording: !!recordingUrl,
      }),
    };
  } catch (error) {
    console.error("Error getting recording:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get recording",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
