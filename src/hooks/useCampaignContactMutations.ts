import { useCallback, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface NewContact {
  phone: string; // E.164
  customerName?: string;
  attributes?: Record<string, string>;
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (json && (json.error || json.message)) || `HTTP ${r.status}`
    );
  return json;
}

export function useCampaignContactMutations() {
  const [pending, setPending] = useState(false);
  const endpoints = getApiEndpoints();

  const addContacts = useCallback(
    async (campaignId: string, contacts: NewContact[]) => {
      if (!endpoints?.editCampaignContacts) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.editCampaignContacts, {
          action: "add",
          campaignId,
          contacts,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.editCampaignContacts]
  );

  const deleteContacts = useCallback(
    async (campaignId: string, rowIds: string[]) => {
      if (!endpoints?.editCampaignContacts) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.editCampaignContacts, {
          action: "delete",
          campaignId,
          rowIds,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.editCampaignContacts]
  );

  const updateContact = useCallback(
    async (
      campaignId: string,
      rowId: string,
      fields: { phone?: string; customerName?: string; attributes?: Record<string, string> }
    ) => {
      if (!endpoints?.editCampaignContacts) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.editCampaignContacts, {
          action: "update",
          campaignId,
          rowId,
          ...fields,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.editCampaignContacts]
  );

  return { pending, addContacts, deleteContacts, updateContact };
}
