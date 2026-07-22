import { useCallback, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { authedFetch } from "@/lib/authedFetch";

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
  // Pilar 7 · orquestación (update-campaign ya los persiste).
  priority?: number;
  weight?: number;
  goalType?: "none" | "contacts" | "conversions";
  goalTarget?: number;
  // Control total (2026-07): ruteo exclusivo + conexión directa + auto-accept.
  // El dialer re-lee la campaña cada tick → aplican en caliente.
  agentRouting?: "shared" | "exclusive";
  directConnect?: boolean;
  autoAccept?: boolean;
  /** Arranque programado en ISO UTC. "" borra la fecha y devuelve la campaña a
   *  borrador; undefined = no tocar. El backend rechaza reprogramar una RUNNING. */
  scheduledStartAt?: string;
  /** Fin de vigencia en ISO UTC. Mismas reglas que scheduledStartAt. */
  scheduledEndAt?: string;
  /** Hours of Operation de Connect. "" desvincula y vuelve a la ventana propia. */
  hoursOfOperationId?: string;
  hoursOfOperationName?: string;
  /** El horario resuelto; el backend lo valida antes de guardarlo como respaldo. */
  hoursOfOperationSnapshot?: unknown;
}

export type RelaunchScope = "all" | "failed" | "specific";

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json && (json.error || json.message)) || `HTTP ${r.status}`);
  return json;
}

/** Igual que postJson pero con el Bearer del tenant (Pilar 7 set-pool lo necesita). */
async function postJsonAuthed(url: string, body: unknown) {
  const r = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json && (json.error || json.message)) || `HTTP ${r.status}`);
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
    [endpoints?.updateCampaign],
  );

  const relaunch = useCallback(
    async (
      campaignId: string,
      scope: RelaunchScope = "all",
      specificRowIds?: string[],
      resetAttempts = true,
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
    [endpoints?.relaunchCampaign],
  );

  const setConcurrency = useCallback(
    async (campaignId: string, concurrency: number) => {
      if (!endpoints?.controlCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.controlCampaign, {
          campaignId,
          action: "set-concurrency",
          concurrency,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.controlCampaign],
  );

  const clone = useCallback(
    async (
      campaignId: string,
      opts: { name?: string; includeContacts?: boolean; resetAttempts?: boolean } = {},
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
    [actor, endpoints?.cloneCampaign],
  );

  // Pilar 7 — blend en vivo: prioridad + peso de la campaña.
  const setBlend = useCallback(
    async (campaignId: string, blend: { priority?: number; weight?: number }) => {
      if (!endpoints?.controlCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJsonAuthed(endpoints.controlCampaign, {
          campaignId,
          action: "set-blend",
          ...blend,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.controlCampaign],
  );

  // Control total — freno de emergencia: cuelga TODAS las llamadas vivas de la
  // campaña (StopContact masivo, backend exige Supervisor/Admin → Bearer).
  const stopAllCalls = useCallback(
    async (campaignId: string) => {
      if (!endpoints?.controlCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return (await postJsonAuthed(endpoints.controlCampaign, {
          campaignId,
          action: "stop-all-calls",
        })) as { live: number; stopped: number; failed: number };
      } finally {
        setPending(false);
      }
    },
    [endpoints?.controlCampaign],
  );

  // Pilar 7 — pool global de marcación del tenant (0 = sin tope).
  const setPool = useCallback(
    async (poolMax: number) => {
      if (!endpoints?.controlCampaign) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJsonAuthed(endpoints.controlCampaign, {
          action: "set-pool",
          poolMax,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.controlCampaign],
  );

  return { pending, update, relaunch, clone, setConcurrency, setBlend, setPool, stopAllCalls };
}
