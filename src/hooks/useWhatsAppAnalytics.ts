import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * useWhatsAppAnalytics — entrega agregada de WhatsApp desde Meta Graph (Pilar 4 ·
 * Fase C). sent/delivered/read por plantilla + actividad del número, para números
 * en modo Meta Cloud API (no anclados a Connect). Ver get-whatsapp-analytics.
 */
export interface WaTemplateAnalytics {
  templateId: string;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  read: number;
  deliveredRate: number;
  readRate: number;
}
export interface WaAnalytics {
  configured: boolean;
  source?: string;
  wabaId?: string;
  windowDays?: number;
  templateCount?: number;
  templates: WaTemplateAnalytics[];
  totals: { sent: number; delivered: number; read: number };
  rates: { deliveredRate: number; readRate: number };
  wabaActivity?: { sent: number; delivered: number };
  error?: string;
}

export function useWhatsAppAnalytics(days = 30) {
  const [data, setData] = useState<WaAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = getApiEndpoints()?.getWhatsAppAnalytics;
    if (!url) { setLoading(false); return; }
    setLoading(true);
    fetch(`${url}?days=${days}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  return { data, loading };
}
