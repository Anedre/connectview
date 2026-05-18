import { useCallback, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface UpdateCampaignInput {
  campaignId: string;
  name?: string;
  description?: string;
  sourcePhoneNumber?: string;
  contactFlowId?: string;
  contactFlowName?: string;
  campaignQueueId?: string;
  campaignQueueName?: string;
  dialMode?: "progressive" | "power" | "agentless";
  concurrency?: number;
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  windowDaysOfWeek?: number[];
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  maxContactsPerAgent?: number;
}

export type RelaunchScope = "all" | "failed" | "specific";

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

export function useCampaignMutations() {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const endpoints = getApiEndpoints();
  const actor = user?.username || "unknown";

  const update = useCallback(
    async (input: UpdateCampaignInput) => {
      if (!endpoints?.updateCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.updateCampaign, input);
      } finally {
        setPending(false);
      }
    },
    [endpoints?.updateCampaign]
  );

  const relaunch = useCallback(
    async (
      campaignId: string,
      scope: RelaunchScope = "all",
      specificRowIds?: string[],
      resetAttempts = true
    ) => {
      if (!endpoints?.relaunchCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.relaunchCampaign, {
          campaignId,
          scope,
          specificRowIds,
          resetAttempts,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.relaunchCampaign]
  );

  const clone = useCallback(
    async (
      campaignId: string,
      opts: { name?: string; includeContacts?: boolean; resetAttempts?: boolean } = {}
    ) => {
      if (!endpoints?.cloneCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.cloneCampaign, {
          campaignId,
          ...opts,
          createdBy: actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.cloneCampaign]
  );

  return { pending, update, relaunch, clone };
}
