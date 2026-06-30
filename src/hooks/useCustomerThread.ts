import { useQuery } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";

export interface ThreadMessage {
  id: string;
  type: "message" | "attachment" | "event";
  participant: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
  content: string;
  contentType?: string;
  eventKind?: string;
  timestamp: string;
  contactId: string;
  agentUsername?: string;
  attachment?: {
    id: string;
    name?: string;
    contentType?: string;
    sizeBytes?: number;
    url: string | null;
  };
}

export interface ThreadSession {
  contactId: string;
  startTime: string;
  endTime: string;
  agentUsername: string;
  subChannel?: string;
  messageCount: number;
}

export interface CustomerThread {
  phone: string;
  totalSessions: number;
  totalMessages: number;
  sessions: ThreadSession[];
  messages: ThreadMessage[];
  /** YYYY-MM-DD → message count (excludes events). */
  daysWithActivity: Record<string, number>;
  /** Backend diagnostics (counts only, no PII) — para entender por qué un hilo
   *  vino vacío sin tener que mirar logs del tenant. (#grabaciones) */
  diagnostics?: {
    strategy: string;
    profileFound: boolean;
    ctrTotal: number;
    chatMatched: number;
    channelsSeen: string[];
    describedOk: number;
    withTranscript: number;
  };
}

interface State {
  data: CustomerThread | null;
  loading: boolean;
  error: string | null;
}

export function useCustomerThread(phone: string | null): State {
  const url = (getApiEndpoints() as unknown as Record<string, string | undefined>)
    ?.getCustomerThread;

  // El hilo completo del cliente (todas las sesiones + mensajes + transcripts)
  // es el fetch más pesado de Grabaciones. Cachearlo por teléfono hace que
  // volver a un cliente ya abierto sea instantáneo (antes recargaba todo el
  // hilo con spinner) y deduplica las vistas que lo piden a la vez.
  const query = useQuery({
    queryKey: ["customerThread", phone],
    enabled: !!phone && !!url,
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const r = await fetch(`${url}?phone=${encodeURIComponent(phone!)}`, { signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      return j as CustomerThread;
    },
  });

  return {
    data: query.data ?? null,
    loading: !!phone && query.isLoading,
    error: !phone
      ? null
      : !url
      ? "Endpoint no configurado"
      : query.error instanceof Error
      ? query.error.message
      : query.error
      ? "Error"
      : null,
  };
}
