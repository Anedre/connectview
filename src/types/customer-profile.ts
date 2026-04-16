export interface CustomerProfile {
  profileId: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  email?: string;
  phoneNumber?: string;
  accountNumber?: string;
  birthDate?: string;
  gender?: string;
  partyType?: string;
  businessName?: string;
  address?: {
    Address1?: string;
    Address2?: string;
    City?: string;
    State?: string;
    Country?: string;
    PostalCode?: string;
  };
  attributes?: Record<string, string>;
}

export interface ContactHistoryItem {
  ObjectTypeName?: string;
  Object?: string;
}
