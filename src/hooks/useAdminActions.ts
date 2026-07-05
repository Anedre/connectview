import { useCallback, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

// Connect + Streams support only these two programmatic monitor modes
// (no whisper/coaching in the Streams API — that's native Agent Workspace).
type MonitorMode = "SILENT_MONITOR" | "BARGE";

// SEC-C6: estas acciones (escuchar/intervenir/colgar/transferir/atributos) son
// privilegiadas. `authedFetch` adjunta el ID token de Cognito como
// `Authorization: Bearer` → el backend verifica el JWT y el rol
// (Supervisors/Admins) y DERIVA el actor del token. Antes íbamos con `fetch`
// pelado (sin token) → el backend caía a cliente bloqueado (no-op); si alguien
// "arreglaba" solo el token sin auth en el handler, quedaba EXPUESTO. Por eso el
// fix cierra ambos lados a la vez. Ya NO mandamos `actor` desde el cliente: es
// forjable y el backend lo ignora (lo saca del sub/username del token).
async function postJson(url: string, body: unknown) {
  const r = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Backend handlers return { error: "generic label", message: "actual AWS/Connect error" }.
    // Prefer the concrete `message` so the toast explains WHY (e.g. "ResourceNotFoundException:
    // The contact has ended") instead of the generic "Failed to transfer".
    const detail = json?.message || json?.error;
    const label = json?.error && json?.message ? `${json.error}: ${json.message}` : detail;
    throw new Error(label || `HTTP ${r.status}`);
  }
  return json;
}

export function useAdminActions() {
  const [pending, setPending] = useState(false);

  const endpoints = getApiEndpoints();

  const transferContact = useCallback(
    async (
      contactId: string,
      target: { userId?: string; queueId?: string; contactFlowId?: string },
    ) => {
      if (!endpoints?.adminTransferContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminTransferContact, {
          contactId,
          targetUserId: target.userId,
          targetQueueId: target.queueId,
          targetContactFlowId: target.contactFlowId,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.adminTransferContact],
  );

  const stopContact = useCallback(
    async (contactId: string) => {
      if (!endpoints?.adminStopContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminStopContact, {
          contactId,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.adminStopContact],
  );

  const changeAgentStatus = useCallback(
    async (userId: string, agentStatusId: string) => {
      if (!endpoints?.adminChangeAgentStatus) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminChangeAgentStatus, {
          userId,
          agentStatusId,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.adminChangeAgentStatus],
  );

  const monitorContact = useCallback(
    async (contactId: string, supervisorUserId: string, mode: MonitorMode = "SILENT_MONITOR") => {
      if (!endpoints?.adminMonitorContact) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminMonitorContact, {
          contactId,
          supervisorUserId,
          mode,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.adminMonitorContact],
  );

  const updateContactAttributes = useCallback(
    async (contactId: string, attributes: Record<string, string>, initialContactId?: string) => {
      if (!endpoints?.adminUpdateContactAttrs) throw new Error("No endpoint");
      setPending(true);
      try {
        return await postJson(endpoints.adminUpdateContactAttrs, {
          contactId,
          initialContactId,
          attributes,
        });
      } finally {
        setPending(false);
      }
    },
    [endpoints?.adminUpdateContactAttrs],
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
