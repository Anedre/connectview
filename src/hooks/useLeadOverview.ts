import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { fetchContactHistory } from "@/hooks/useCallHistory";

/**
 * useLeadOverview — resumen del lead para el grid del Lead 360: por cada canal,
 * el conteo + la última actividad (fecha), y los últimos eventos del historial
 * para previsualizar. Reusa los endpoints de las lentes:
 *   - manageLeads ?phone     → historial (eventos)
 *   - getContactHistory      → llamadas (VOICE) + WhatsApp (CHAT) + emails (EMAIL)
 *   - getCustomerAttachments → archivos
 */
export interface OvHistEvent {
  ts?: string;
  type?: string;
  channel?: string;
  untyped?: boolean;
  contactId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  summary?: string;
}
export interface ChannelSummary {
  count: number;
  lastTs?: string;
}
export interface LeadOverview {
  history: { count: number; recent: OvHistEvent[] } | null;
  calls: ChannelSummary | null;
  whatsapp: ChannelSummary | null;
  emails: ChannelSummary | null;
  files: (ChannelSummary & { lastName?: string }) | null;
}

const EMPTY: LeadOverview = {
  history: null,
  calls: null,
  whatsapp: null,
  emails: null,
  files: null,
};

export function useLeadOverview(phone: string | null): LeadOverview {
  const [ov, setOv] = useState<LeadOverview>(EMPTY);

  useEffect(() => {
    if (!phone) return;
    const ep = getApiEndpoints();
    const ctrl = new AbortController();
    const enc = encodeURIComponent(phone);

    if (ep?.manageLeads) {
      authedFetch(`${ep.manageLeads}?phone=${enc}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => {
          const lead = (j.leads || [])[0];
          const h: OvHistEvent[] = Array.isArray(lead?.history) ? lead.history : [];
          // Oculta la interacción "sin tipificar" si esa llamada terminó tipificándose.
          const typed = new Set(
            h.filter((e) => e.type === "gestion" && e.contactId).map((e) => e.contactId),
          );
          const dedup = h.filter(
            (e) => !(e.type === "interaccion" && e.contactId && typed.has(e.contactId)),
          );
          setOv((p) => ({
            ...p,
            history: { count: dedup.length, recent: [...dedup].reverse().slice(0, 6) },
          }));
        })
        .catch(() => {});
    }

    // Historial de contactos — fetch COMPARTIDO (dedup + caché): el Resumen lo
    // pide también para el heatmap y la línea de tiempo → una sola request real.
    fetchContactHistory(phone)
      .then((cs) => {
        if (ctrl.signal.aborted) return;
        const acc: Record<string, ChannelSummary> = {
          calls: { count: 0 },
          whatsapp: { count: 0 },
          emails: { count: 0 },
        };
        for (const c of cs) {
          const ch = String(c.channel || "").toUpperCase();
          const ts = c.initiationTimestamp || c.disconnectTimestamp;
          const key =
            ch === "VOICE" || ch === "TELEPHONY"
              ? "calls"
              : ch === "CHAT"
                ? "whatsapp"
                : ch === "EMAIL"
                  ? "emails"
                  : null;
          if (!key) continue;
          acc[key].count++;
          if (ts && (!acc[key].lastTs || ts > acc[key].lastTs!)) acc[key].lastTs = ts;
        }
        setOv((p) => ({ ...p, calls: acc.calls, whatsapp: acc.whatsapp, emails: acc.emails }));
      })
      .catch(() => {});

    if (ep?.getCustomerAttachments) {
      authedFetch(`${ep.getCustomerAttachments}?phone=${enc}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => {
          const a = Array.isArray(j.attachments) ? j.attachments : [];
          let lastTs: string | undefined;
          let lastName: string | undefined;
          for (const f of a) {
            const ts = f.timestamp || f.createdAt;
            if (ts && (!lastTs || ts > lastTs)) {
              lastTs = ts;
              lastName = f.name || f.fileName;
            }
          }
          setOv((p) => ({ ...p, files: { count: a.length, lastTs, lastName } }));
        })
        .catch(() => {});
    }

    return () => ctrl.abort();
  }, [phone]);

  return ov;
}
