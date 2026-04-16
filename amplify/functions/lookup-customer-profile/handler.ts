import type { Handler } from "aws-lambda";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";

const client = new CustomerProfilesClient({});
const DOMAIN_NAME = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const params = event.queryStringParameters || {};
  const phone = params.phone;
  const email = params.email;
  const profileId = params.profileId;

  try {
    if (!phone && !email && !profileId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "phone, email, or profileId parameter required",
        }),
      };
    }

    const searchKey = profileId
      ? "_profileId"
      : phone
      ? "_phone"
      : "_email";
    const searchValue = profileId || phone || email;

    const result = await client.send(
      new SearchProfilesCommand({
        DomainName: DOMAIN_NAME,
        KeyName: searchKey,
        Values: [searchValue!],
      })
    );

    const profile = result.Items?.[0];
    if (!profile) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: null }),
      };
    }

    // Also get recent contact history for this profile
    let history: unknown[] = [];
    try {
      const historyResult = await client.send(
        new ListProfileObjectsCommand({
          DomainName: DOMAIN_NAME,
          ProfileId: profile.ProfileId!,
          ObjectTypeName: "CTR",
        })
      );
      history = historyResult.Items?.slice(0, 5) || [];
    } catch {
      // History not available
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: {
          profileId: profile.ProfileId,
          firstName: profile.FirstName,
          lastName: profile.LastName,
          middleName: profile.MiddleName,
          email: profile.EmailAddress || profile.PersonalEmailAddress,
          phoneNumber:
            profile.PhoneNumber ||
            profile.MobilePhoneNumber ||
            profile.HomePhoneNumber,
          accountNumber: profile.AccountNumber,
          birthDate: profile.BirthDate,
          gender: profile.Gender,
          partyType: profile.PartyType,
          businessName: profile.BusinessName,
          address: profile.Address,
          attributes: profile.Attributes,
        },
        history,
      }),
    };
  } catch (error) {
    console.error("Error looking up customer profile:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to lookup customer profile",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
