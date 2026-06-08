import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListPhoneNumbersV2Command,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const INSTANCE_ARN = `arn:aws:connect:us-east-1:731736972577:instance/${INSTANCE_ID}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // Connect del tenant (o legacy de Vox). Phones usa el ARN de la instancia.
    const { client: connect, instanceArn } = await resolveConnect(
      event?.headers,
      legacyConnect,
      INSTANCE_ID,
      INSTANCE_ARN
    );
    const phones: Array<{
      phoneNumber: string;
      phoneNumberId: string;
      countryCode?: string;
      type?: string;
      description?: string;
    }> = [];
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListPhoneNumbersV2Command({
          TargetArn: instanceArn,
          NextToken: nextToken,
          MaxResults: 100,
        })
      );
      for (const p of res.ListPhoneNumbersSummaryList || []) {
        phones.push({
          phoneNumber: p.PhoneNumber || "",
          phoneNumberId: p.PhoneNumberId || "",
          countryCode: p.PhoneNumberCountryCode,
          type: p.PhoneNumberType,
          description: p.PhoneNumberDescription,
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phones, total: phones.length }),
    };
  } catch (err) {
    console.error("list-source-phones error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list source phones",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
