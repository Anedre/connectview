import { useMemo, useState } from "react";
import type { ContactRecord } from "@/types/monitoring";
import { useUsers, UUID_RE } from "@/hooks/useUsers";

/**
 * AgentPerformanceReport — "Rendimiento de agente" (a Chattigo core report).
 * Pure frontend aggregation over the already-loaded contacts: volume, AHT,
 * sentiment mix, and channel mix per agent. Sortable. Roadmap #5 (first of
 * the 7 reports). Uses the real connectview-contacts data already in memory.
 */
interface AgentRow {
  agent: string;
  total: number;
  ahtSeconds: number;
  posPct: number;
  negPct: number;
  topChannel: string;
  abandoned: number;
}

function fmtAht(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

type SortKey = "total" | "ahtSeconds" | "negPct";

export function AgentPerformanceReport({ contacts }: { contacts: ContactRecord[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const { userIdToName } = useUsers();

  // Map the raw agentUsername (often a userId UUID) to a friendly name —
  // same resolution the contacts table uses, so the report reads cleanly.
  const resolveAgent = (raw: string): string => {
    if (UUID_RE.test(raw)) {
      return userIdToName.get(raw) || `agente-${raw.slice(0, 4)}`;
    }
    return raw;
  };

  const rows = useMemo<AgentRow[]>(() => {
    const byAgent = new Map<string, ContactRecord[]>();
    for (const c of contacts) {
      const a = (c.agentUsername || "").trim();
      if (!a) continue; // skip unattended / system contacts
      // Group by resolved display name so one agent isn't split across
      // a raw id and a friendly name.
      const key = resolveAgent(a);
      if (!byAgent.has(key)) byAgent.set(key, []);
      byAgent.get(key)!.push(c);
    }
    const out: AgentRow[] = [];
    for (const [agent, list] of byAgent) {
      const total = list.length;
      const durs = list.map((c) => c.duration || 0).filter((d) => d > 0);
      const ahtSeconds = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
      const pos = list.filter((c) => c.sentiment === "POSITIVE").length;
      const neg = list.filter((c) => c.sentiment === "NEGATIVE").length;
      const chCount = new Map<string, number>();
      for (const c of list) {
        const ch = (c.channel || "—").toLowerCase();
        chCount.set(ch, (chCount.get(ch) || 0) + 1);
      }
      const topChannel = [...chCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      const abandoned = list.filter((c) => c.disconnectReason === "CUSTOMER_DISCONNECT").length;
      out.push({
        agent,
        total,
        ahtSeconds,
        posPct: total ? Math.round((pos / total) * 100) : 0,
        negPct: total ? Math.round((neg / total) * 100) : 0,
        topChannel,
        abandoned,
      });
    }
    out.sort((a, b) => {
      if (sortKey === "ahtSeconds") return b.ahtSeconds - a.ahtSeconds;
      if (sortKey === "negPct") return b.negPct - a.negPct;
      return b.total - a.total;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, sortKey, userIdToName]);

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
        }}
      >
        Sin contactos con agente asignado en el período.
      </div>
    );
  }

  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  const Th = ({
    label,
    k,
    align = "right",
  }: {
    label: string;
    k?: SortKey;
    align?: "left" | "right";
  }) => (
    <th
      aria-sort={k ? (sortKey === k ? "descending" : "none") : undefined}
      style={{
        textAlign: align,
        padding: "8px 10px",
        cursor: k ? "pointer" : "default",
        color: k && sortKey === k ? "var(--iris)" : "var(--text-3)",
        userSelect: "none",
        fontWeight: 700,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: ".03em",
        whiteSpace: "nowrap",
      }}
      onClick={k ? () => setSortKey(k) : undefined}
      title={k ? "Ordenar" : undefined}
    >
      {label}
      {k && sortKey === k ? " ↓" : ""}
    </th>
  );

  const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "middle" };
  const tdNum: React.CSSProperties = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
            <Th label="Agente" align="left" />
            <Th label="Contactos" k="total" />
            <Th label="AHT" k="ahtSeconds" />
            <Th label="Canal" align="left" />
            <Th label="Sentimiento" align="left" />
            <Th label="% Neg" k="negPct" />
            <Th label="Abandono" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.agent}
              style={{
                borderBottom: "1px solid var(--border-1)",
                background: i % 2 ? "var(--bg-2)" : "transparent",
              }}
            >
              <td style={{ ...td, fontWeight: 600 }}>{r.agent}</td>
              <td style={tdNum}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <span
                    style={{
                      flex: "0 1 60px",
                      height: 6,
                      borderRadius: 99,
                      background: "var(--bg-2)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${Math.round((r.total / maxTotal) * 100)}%`,
                        height: "100%",
                        background: "var(--cyan)",
                        borderRadius: 99,
                      }}
                    />
                  </span>
                  <b style={{ minWidth: 22 }}>{r.total}</b>
                </div>
              </td>
              <td style={tdNum}>{fmtAht(r.ahtSeconds)}</td>
              <td style={{ ...td, textTransform: "capitalize", color: "var(--text-2)" }}>
                {r.topChannel}
              </td>
              <td style={td}>
                {/* Barra de sentimiento: verde (positivo) desde la izquierda, rojo
                    (negativo) desde la derecha, hueco = neutro. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      flex: "0 1 100px",
                      height: 7,
                      borderRadius: 99,
                      background: "var(--bg-2)",
                      overflow: "hidden",
                      display: "flex",
                    }}
                    title={`${r.posPct}% positivo · ${r.negPct}% negativo`}
                  >
                    <span style={{ width: `${r.posPct}%`, background: "var(--green)" }} />
                    <span
                      style={{
                        marginLeft: "auto",
                        width: `${r.negPct}%`,
                        background: "var(--red)",
                      }}
                    />
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--green)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.posPct}%
                  </span>
                </div>
              </td>
              <td
                style={{
                  ...tdNum,
                  color: r.negPct >= 30 ? "var(--red)" : "var(--text-1)",
                  fontWeight: r.negPct >= 30 ? 700 : 400,
                }}
              >
                {r.negPct}%
              </td>
              <td style={{ ...tdNum, color: "var(--text-3)" }}>{r.abandoned || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
