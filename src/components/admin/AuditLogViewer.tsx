import { useMemo, useState } from "react";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useAdminAudit, type AdminAuditEntry } from "@/hooks/useAdminAudit";

/**
 * AuditLogViewer — first-class, filterable audit log (roadmap #29). Reads
 * connectview-admin-audit via useAdminAudit and adds search + action/result
 * filters + CSV export. Every privileged action (monitor, transfer, profile
 * edit, etc.) lands here.
 */
function targetToString(t: AdminAuditEntry["target"]): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  return Object.entries(t)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "6px 9px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};

export function AuditLogViewer() {
  const { entries, loading, refresh } = useAdminAudit(300, 15000);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");

  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries
      .filter((e) => (action ? e.action === action : true))
      .filter((e) => (result ? e.result === result : true))
      .filter((e) => {
        if (!needle) return true;
        const hay = `${e.action} ${e.actor} ${targetToString(e.target)} ${e.errorMsg || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  }, [entries, q, action, result]);

  const exportCsv = () => {
    const head = ["timestamp", "action", "actor", "result", "target", "error"];
    const lines = filtered.map((e) =>
      [
        e.timestamp,
        e.action,
        e.actor,
        e.result,
        targetToString(e.target).replace(/"/g, "'"),
        (e.errorMsg || "").replace(/"/g, "'"),
      ]
        .map((c) => `"${String(c ?? "")}"`)
        .join(",")
    );
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHead
        title={`Bitácora de auditoría (${filtered.length}${
          filtered.length !== entries.length ? ` de ${entries.length}` : ""
        })`}
        right={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm" onClick={refresh} disabled={loading}>
              <Icon.Refresh size={12} /> Actualizar
            </button>
            <button className="btn btn--sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Icon.Download size={12} /> CSV
            </button>
          </div>
        }
      />
      <CardBody>
        {/* Filters */}
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar acción, admin, target…"
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <select value={action} onChange={(e) => setAction(e.target.value)} style={inputStyle}>
            <option value="">Todas las acciones</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value)} style={inputStyle}>
            <option value="">Todos</option>
            <option value="success">OK</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-1)", position: "sticky", top: 0, background: "var(--bg-1)" }}>
                {["Cuándo", "Acción", "Admin", "Target", "Resultado"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--text-2)", fontWeight: 600, fontSize: 11 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-3)" }}>
                    {loading ? "Cargando…" : "Sin entradas que coincidan."}
                  </td>
                </tr>
              )}
              {filtered.map((e) => (
                <tr key={e.auditId} style={{ borderBottom: "1px solid var(--border-1)" }}>
                  <td style={{ padding: "6px 10px", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                    {new Date(e.timestamp).toLocaleString("es-PE")}
                  </td>
                  <td style={{ padding: "6px 10px", fontWeight: 500 }}>{e.action}</td>
                  <td style={{ padding: "6px 10px" }}>{e.actor}</td>
                  <td style={{ padding: "6px 10px", color: "var(--text-3)", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {targetToString(e.target) || "—"}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span
                      className={`chip ${e.result === "success" ? "chip--green" : "chip--red"}`}
                      style={{ height: 18, fontSize: 10 }}
                    >
                      {e.result === "success" ? "OK" : "Error"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
