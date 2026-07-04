import { useCallback, useEffect, useState } from "react";
import { useCallbacks } from "@/hooks/useCallbacks";

/**
 * useNotifications — avisos in-app (channel "notification", creados por las
 * automatizaciones / notify_agent) + estado "visto" persistente.
 *
 * El bug que resuelve: antes el badge contaba TODOS los PENDING, así que
 * "siempre se marcaba" aunque ya hubieras visto el aviso. Ahora guardamos los
 * IDs vistos en localStorage; el badge sólo cuenta los NO vistos. Al abrir la
 * campana se marcan todos como vistos (se sincroniza entre las dos campanas —
 * top bar y dock — y entre pestañas).
 */
const SEEN_KEY = "aria_notifs_seen";
const SEEN_EVT = "aria:notifs-seen";
const MAX_SEEN = 300;

function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function useNotifications() {
  const { callbacks: notifs } = useCallbacks({
    channel: "notification",
    agentUserId: null,
    status: "PENDING",
    pollIntervalSec: 60,
  });
  const [seen, setSeen] = useState<Set<string>>(() => new Set(loadSeen()));

  // Sync entre instancias (las dos campanas en la misma pestaña) y entre pestañas.
  useEffect(() => {
    const resync = () => setSeen(new Set(loadSeen()));
    const onStorage = (e: StorageEvent) => {
      if (e.key === SEEN_KEY) resync();
    };
    window.addEventListener(SEEN_EVT, resync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SEEN_EVT, resync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const unseenCount = notifs.reduce((n, c) => (seen.has(c.callbackId) ? n : n + 1), 0);

  const markAllSeen = useCallback(() => {
    const next = new Set(loadSeen());
    let changed = false;
    for (const c of notifs) {
      if (!next.has(c.callbackId)) {
        next.add(c.callbackId);
        changed = true;
      }
    }
    if (!changed) return;
    const arr = [...next].slice(-MAX_SEEN);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch {
      /* ignore quota */
    }
    setSeen(new Set(arr));
    window.dispatchEvent(new Event(SEEN_EVT));
  }, [notifs]);

  const isUnseen = useCallback((id: string) => !seen.has(id), [seen]);

  return { notifs, unseenCount, markAllSeen, isUnseen };
}
