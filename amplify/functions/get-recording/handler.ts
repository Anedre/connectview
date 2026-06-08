import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolveConnect } from "../_shared/tenantConnect";

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

  // Auth + tenant: resuelve el Connect/S3 del tenant del JWT (mismo patrón que
  // los otros ~40 Lambdas). Anónimo / tenant real sin config → cliente BLOQUEADO
  // → DescribeContact vacío → SIN grabación. Cierra el leak: antes caía a la
  // instancia/bucket legacy de Novasys y le devolvía la grabación de Novasys a
  // CUALQUIERA que tuviera un contactId. Novasys y tenants configurados → SU
  // instancia + SU bucket (assume-role). El `|| legacyS3` sólo aplica cuando el
  // connect resolvió de verdad (legacy/tenant), nunca para el anónimo bloqueado
  // (que ya no trae grabación). Las grabaciones viven en el bucket del Connect del
  // cliente; si su rol NO tiene s3:GetObject, el presign sale OK pero el browser
  // recibe 403 — el panel de integración avisa.
  const r = await resolveConnect(event.headers, legacyConnect, INSTANCE_ID);
  const connect: ConnectClient = r.client;
  const s3: S3Client = r.s3 || legacyS3;
  const instanceId = r.instanceId;

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
