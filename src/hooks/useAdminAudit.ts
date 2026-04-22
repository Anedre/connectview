import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface AdminAuditEntry {
  auditId: string;
  timestamp: string;
  action: string;
  actor: string;
  target: Record<string, unknown> | string;
  result: "success" | "error";
  errorMsg?: string;
}

export function useAdminAudit(limit = 100, refreshMs = 8000) {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.adminListAudit) return;
    try {
      const r = await fetch(`${endpoints.adminListAudit}?limit=${limit}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setEntries(j.entries || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [limit]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshMs > 0) {
      const id = setInterval(refresh, refreshMs);
      return () => clearInterval(id);
    }
  }, [refresh, refreshMs]);

  return { entries, loading, error, refresh };
}
