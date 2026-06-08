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

export function AgentPerformanceReport({
  contacts,
}: {
  contacts: ContactRecord[];
}) {
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
      const ahtSeconds = durs.length
        ? durs.reduce((a, b) => a + b, 0) / durs.length
        : 0;
      const pos = list.filter((c) => c.sentiment === "POSITIVE").length;
      const neg = list.filter((c) => c.sentiment === "NEGATIVE").length;
      const chCount = new Map<string, number>();
      for (const c of list) {
        const ch = (c.channel || "—").toLowerCase();
        chCount.set(ch, (chCount.get(ch) || 0) + 1);
      }
      const topChannel =
        [...chCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      const abandoned = list.filter(
        (c) => c.disconnectReason === "CUSTOMER_DISCONNECT"
      ).length;
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
      style={{
        textAlign: align,
        padding: "6px 10px",
        cursor: k ? "pointer" : "default",
        color: k && sortKey === k ? "var(--accent-violet)" : "var(--text-2)",
        userSelect: "none",
        fontWeight: 600,
        fontSize: 11,
      }}
      onClick={k ? () => setSortKey(k) : undefined}
      title={k ? "Ordenar" : undefined}
    >
      {label}
      {k && sortKey === k ? " ↓" : ""}
    </th>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
            <Th label="Agente" align="left" />
            <Th label="Contactos" k="total" />
            <Th label="AHT" k="ahtSeconds" />
            <Th label="Canal" align="left" />
            <Th label="% Positivo" />
            <Th label="% Negativo" k="negPct" />
            <Th label="Abandono" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent} style={{ borderBottom: "1px solid var(--border-1)" }}>
              <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.agent}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.total}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtAht(r.ahtSeconds)}
              </td>
              <td style={{ padding: "7px 10px", textTransform: "capitalize" }}>
                {r.topChannel}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--accent-green)" }}>
                {r.posPct}%
              </td>
              <td
                style={{
                  padding: "7px 10px",
                  textAlign: "right",
                  color: r.negPct >= 30 ? "var(--accent-red)" : "var(--text-1)",
                  fontWeight: r.negPct >= 30 ? 700 : 400,
                }}
              >
                {r.negPct}%
              </td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.abandoned || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
