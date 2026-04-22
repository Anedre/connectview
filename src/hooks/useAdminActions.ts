import { useCallback, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type MonitorMode = "SILENT_MONITOR" | "BARGE" | "WHISPER";

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error((json && (json.error || json.message)) || `HTTP ${r.status}`);
  return json;
}

export function useAdminActions() {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);

  const actor = user?.username || "unknown";
  const endpoints = getApiEndpoints();

  const transferContact = useCallback(
    async (
      contactId: string,
      target: { userId?: string; queueId?: string; contactFlowId?: string }
    ) => {
      if (!endpoints?.adminTransferContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminTransferContact, {
          contactId,
          targetUserId: target.userId,
          targetQueueId: target.queueId,
          targetContactFlowId: target.contactFlowId,
          actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.adminTransferContact]
  );

  const stopContact = useCallback(
    async (contactId: string) => {
      if (!endpoints?.adminStopContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminStopContact, {
          contactId,
          actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.adminStopContact]
  );

  const changeAgentStatus = useCallback(
    async (userId: string, agentStatusId: string) => {
      if (!endpoints?.adminChangeAgentStatus) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminChangeAgentStatus, {
          userId,
          agentStatusId,
          actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.adminChangeAgentStatus]
  );

  const monitorContact = useCallback(
    async (
      contactId: string,
      supervisorUserId: string,
      mode: MonitorMode = "SILENT_MONITOR"
    ) => {
      if (!endpoints?.adminMonitorContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminMonitorContact, {
          contactId,
          supervisorUserId,
          mode,
          actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.adminMonitorContact]
  );

  const updateContactAttributes = useCallback(
    async (
      contactId: string,
      attributes: Record<string, string>,
      initialContactId?: string
    ) => {
      if (!endpoints?.adminUpdateContactAttrs) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminUpdateContactAttrs, {
          contactId,
          initialContactId,
          attributes,
          actor,
        });
      } finally {
        setPending(false);
      }
    },
    [actor, endpoints?.adminUpdateContactAttrs]
  );

  return {
    pending,
    transferContact,
    stopContact,
    changeAgentStatus,
    monitorContact,
    updateContactAttributes,
  };
}
