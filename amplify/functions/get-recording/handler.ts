import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const connect = new ConnectClient({});
const s3 = new S3Client({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

export const handler: APIGatewayProxyHandler = async (event) => {
  const contactId = event.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "contactId is required" }),
    };
  }

  try {
    // Get contact details including recording location
    const contactDesc = await connect.send(
      new DescribeContactCommand({
        InstanceId: INSTANCE_ID,
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
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to get recording",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
