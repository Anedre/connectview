import { useQuery } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";

export interface HistoricalContact {
  contactId: string;
  channel: string;
  // e.g. "WhatsApp/SMS", "Messaging API", "Outbound" — derived from Connect's
  // initiationMethod + customerEndpoint.type for CHAT contacts.
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  hasRecording: boolean;
}

// Connect SearchContacts API limits time range to 1345 hours (~56 days)
export function useContactHistory(phone: string | null, days = 55) {
  const url = getApiEndpoints()?.getContactHistory;

  // Caché por (teléfono, ventana): reabrir el historial de un lead ya visto es
  // instantáneo (antes spinner + refetch cada vez). staleTime corto + gcTime
  // largo → render inmediato desde caché con refresh en segundo plano.
  const query = useQuery({
    queryKey: ["contactHistory", phone, days],
    enabled: !!phone && !!url,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const r = await fetch(
        `${url}?phone=${encodeURIComponent(phone!)}&days=${days}`,
        { signal }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return (data.contacts || []) as HistoricalContact[];
    },
  });

  return {
    contacts: query.data ?? [],
    loading: !!phone && query.isLoading,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
        ? "Failed"
        : null,
  };
}
