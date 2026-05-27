import { useEffect, useState } from "react";
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
}

interface State {
  data: CustomerThread | null;
  loading: boolean;
  error: string | null;
}

export function useCustomerThread(phone: string | null): State {
  const [state, setState] = useState<State>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!phone) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const endpoints = getApiEndpoints();
    const url = (endpoints as unknown as Record<string, string | undefined>)
      ?.getCustomerThread;
    if (!url) {
      setState({ data: null, loading: false, error: "Endpoint no configurado" });
      return;
    }
    const ctrl = new AbortController();
    setState({ data: null, loading: true, error: null });
    fetch(`${url}?phone=${encodeURIComponent(phone)}`, { signal: ctrl.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!ok) throw new Error(j.message || `HTTP ${status}`);
        setState({ data: j as CustomerThread, loading: false, error: null });
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : "Error",
        });
      });
    return () => ctrl.abort();
  }, [phone]);

  return state;
}
