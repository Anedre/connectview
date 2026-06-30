import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useWhatsAppHealth — salud del número de WhatsApp (Pilar 4 · #13): quality
 * rating + modo (anclado a Connect vs Meta standalone) vía get-whatsapp-health.
 */
export interface WaNumberHealth {
  phoneNumber: string;
  displayName: string;
  qualityRating: string; // GREEN | YELLOW | RED | UNKNOWN
  metaPhoneNumberId: string;
  registrationStatus?: string;
}
export interface WaWabaHealth {
  wabaId: string;
  wabaName: string;
  anchoredToConnect: boolean;
  numbers: WaNumberHealth[];
}
export interface WaHealth {
  mode: string; // aws | meta | unknown
  configured: boolean;
  wabas: WaWabaHealth[];
  alert?: { level: "warning" | "critical"; message: string };
  error?: string;
}

export function useWhatsAppHealth() {
  const [health, setHealth] = useState<WaHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const url = getApiEndpoints()?.getWhatsAppHealth;
    if (!url) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await authedFetch(url);
      setHealth(await r.json());
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { health, loading, reload: load };
}
