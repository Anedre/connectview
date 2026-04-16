import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";

const connect = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const phone = event.queryStringParameters?.phone;
  const maxDays = parseInt(event.queryStringParameters?.days || "90");

  if (!phone) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "phone parameter required" }),
    };
  }

  try {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - maxDays);

    // Search all contacts by customer phone number (endpoint address)
    const result = await connect.send(
      new SearchContactsCommand({
        InstanceId: INSTANCE_ID,
        TimeRange: {
          Type: "INITIATION_TIMESTAMP",
          StartTime: startTime,
          EndTime: endTime,
        },
        MaxResults: 100,
      })
    );

    // Filter results by customer endpoint phone (client-side)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const endpointResults = ((result.Contacts as any[]) || []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) =>
        c.CustomerEndpoint?.Address === phone ||
        c.CustomerEndpoint?.Value === phone
    );

    // For each contact, fetch details in parallel (limit to 20 to avoid throttling)
    const contacts = await Promise.all(
      endpointResults.slice(0, 20).map(async (c) => {
        try {
          const detail = await connect.send(
            new DescribeContactCommand({
              InstanceId: INSTANCE_ID,
              ContactId: c.Id!,
            })
          );
          const contact = detail.Contact;
          const duration =
            contact?.DisconnectTimestamp && contact?.InitiationTimestamp
              ? Math.round(
                  (contact.DisconnectTimestamp.getTime() -
                    contact.InitiationTimestamp.getTime()) /
                    1000
                )
              : 0;

          return {
            contactId: c.Id,
            channel: contact?.Channel || "UNKNOWN",
            initiationTimestamp:
              contact?.InitiationTimestamp?.toISOString() || "",
            disconnectTimestamp:
              contact?.DisconnectTimestamp?.toISOString() || "",
            duration,
            agentUsername: contact?.AgentInfo?.Id || "",
            queueName: contact?.QueueInfo?.Id || "",
            initiationMethod: contact?.InitiationMethod,
            disconnectReason: contact?.DisconnectReason,
            customerEndpoint: contact?.CustomerEndpoint?.Address,
            hasRecording: (contact?.Recordings?.length || 0) > 0,
          };
        } catch {
          return {
            contactId: c.Id,
            channel: "UNKNOWN",
            initiationTimestamp: c.InitiationTimestamp?.toISOString() || "",
            disconnectTimestamp: "",
            duration: 0,
            agentUsername: "",
            queueName: "",
            hasRecording: false,
          };
        }
      })
    );

    // Sort newest first
    contacts.sort(
      (a, b) =>
        new Date(b.initiationTimestamp).getTime() -
        new Date(a.initiationTimestamp).getTime()
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        totalContacts: contacts.length,
        contacts,
      }),
    };
  } catch (error) {
    console.error("Error getting contact history:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get contact history",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
