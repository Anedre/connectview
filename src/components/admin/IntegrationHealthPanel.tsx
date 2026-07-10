import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

/**
 * IntegrationHealthPanel — "Estado de la integración". Corre un health-check
 * read-only contra el Amazon Connect del cliente (vía el Lambda
 * diagnose-connection) y muestra, por cada feature, su estado + qué se rompe
 * sin ella + cómo activarla (con link a la consola del cliente).
 *
 * Se auto-ejecuta al montar (cuando el admin entra a Configuración) y tiene
 * un botón "Re-diagnosticar". Solo se muestra si hay un endpoint configurado.
 */

type CheckStatus = "ok" | "warn" | "error";
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  remediation?: string | null;
  link?: string | null;
}

const STATUS_META: Record<
  CheckStatus,
  { color: string; bg: string; icon: "Check" | "Close"; label: string }
> = {
  ok: { color: "var(--accent-green)", bg: "var(--accent-green-soft)", icon: "Check", label: "OK" },
  warn: {
    color: "var(--accent-amber)",
    bg: "var(--accent-amber-soft)",
    icon: "Close",
    label: "Atención",
  },
  error: {
    color: "var(--accent-red)",
    bg: "var(--accent-red-soft)",
    icon: "Close",
    label: "Error",
  },
};

/** Props: hasConnect indica si ya hay config de Connect (sino no diagnostica). */
export function IntegrationHealthPanel({ hasConnect }: { hasConnect: boolean }) {
  const ep = getApiEndpoints();
  const endpoint = ep?.diagnoseConnection;
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo diagnosticar");
      setChecks(Array.isArray(j.checks) ? j.checks : []);
      setRanAt(new Date().toLocaleTimeString("es-PE"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al diagnosticar");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  // Auto-correr al entrar, si hay config de Connect.
  useEffect(() => {
    if (hasConnect && endpoint) run();
  }, [hasConnect, endpoint, run]);

  if (!endpoint) return null;

  // Resumen: cuántos OK / warn / error.
  const counts = (checks || []).reduce(
    (acc, c) => ((acc[c.status] = (acc[c.status] || 0) + 1), acc),
    {} as Record<CheckStatus, number>,
  );

  return (
    <div
      style={{
        marginTop: 20,
        padding: 18,
        borderRadius: 12,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Estado de la integración</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {ranAt ? `Diagnóstico de las ${ranAt}` : "Chequeo de tu Amazon Connect y sus features"}
            {checks && (
              <>
                {" · "}
                <span style={{ color: "var(--accent-green)" }}>{counts.ok || 0} OK</span>
                {counts.warn ? (
                  <span style={{ color: "var(--accent-amber)" }}>
                    {" · "}
                    {counts.warn} atención
                  </span>
                ) : null}
                {counts.error ? (
                  <span style={{ color: "var(--accent-red)" }}>
                    {" · "}
                    {counts.error} error
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
        <button className="btn btn--sm" onClick={run} disabled={loading || !hasConnect}>
          {loading ? (
            "Diagnosticando…"
          ) : (
            <>
              <Icon.Settings size={12} /> Re-diagnosticar
            </>
          )}
        </button>
      </div>

      {!hasConnect && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          Configura tu Amazon Connect arriba para poder diagnosticar la integración.
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 12.5,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            border: "1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      {loading && !checks && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          Corriendo chequeos…
        </div>
      )}

      {checks && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {checks.map((c) => {
            const m = STATUS_META[c.status];
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--bg-2)",
                  border: `1px solid color-mix(in srgb, ${m.color} 25%, transparent)`,
                  alignItems: "flex-start",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    display: "grid",
                    placeItems: "center",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: m.bg,
                    color: m.color,
                    marginTop: 1,
                  }}
                >
                  {c.status === "ok" ? <Icon.Check size={13} /> : <Icon.Close size={13} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.label}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: m.bg,
                        color: m.color,
                      }}
                    >
                      {m.label}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.detail}
                  </div>
                  {c.remediation && (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 6,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: "var(--bg-1)",
                        color: "var(--text-2)",
                        lineHeight: 1.5,
                      }}
                    >
                      {c.remediation}
                      {c.link && (
                        <div style={{ marginTop: 6 }}>
                          <a
                            href={c.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent-cyan)", fontSize: 12, fontWeight: 600 }}
                          >
                            Abrir en mi consola de Connect →
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
