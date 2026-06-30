import { useMemo } from "react";

/**
 * SourceHealthBar — "Ingesta en vivo" (Pilar 5). Muestra los leads por fuente
 * (Meta/web/campaña/WhatsApp/manual…) computados de los leads cargados, con el
 * conteo de HOY. Si una fuente conocida cae a 0 hoy se resalta — hace visible el
 * "algunos leads no llegan" de Zapier al instante. Ver design/pilar-5-ingesta.md.
 */

const SOURCE_META: Record<string, { label: string; color: string }> = {
  facebook: { label: "Facebook", color: "#1877F2" },
  instagram: { label: "Instagram", color: "#E1306C" },
  meta_lead_ads: { label: "Meta", color: "#1877F2" },
  web_form: { label: "Web", color: "var(--accent-cyan)" },
  campaign: { label: "Campaña", color: "var(--accent-violet)" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  salesforce: { label: "Salesforce", color: "#00A1E0" },
  referral: { label: "Referido", color: "var(--accent-amber)" },
  call: { label: "Llamada", color: "var(--accent-green)" },
  manual: { label: "Manual", color: "var(--text-3)" },
  otro: { label: "Otro", color: "var(--text-3)" },
};

/** Normaliza la fuente cruda a una clave canónica. */
function normSource(raw?: string): string {
  const s = (raw || "").toLowerCase();
  if (!s) return "manual";
  if (s.includes("face") || s === "fb") return "facebook";
  if (s.includes("insta") || s === "ig") return "instagram";
  if (s.includes("meta")) return "meta_lead_ads";
  if (s.includes("web") || s.includes("form")) return "web_form";
  if (s.includes("salesforce") || s === "sf") return "salesforce";
  if (s.includes("whatsapp") || s.includes("wa flow") || s === "wa") return "whatsapp";
  if (s.includes("campañ") || s.includes("campan") || s.includes("campaign")) return "campaign";
  if (s.includes("referid") || s.includes("referral")) return "referral";
  if (s.includes("llamad") || s === "call") return "call";
  if (s.includes("manual")) return "manual";
  return SOURCE_META[s] ? s : "otro";
}

export function SourceHealthBar({ leads }: { leads: { source?: string; createdAt?: string }[] }) {
  const { rows, total, todayTotal } = useMemo(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const t0 = startToday.getTime();
    const by: Record<string, { count: number; today: number }> = {};
    let today = 0;
    for (const l of leads) {
      const k = normSource(l.source);
      if (!by[k]) by[k] = { count: 0, today: 0 };
      by[k].count++;
      const c = l.createdAt ? new Date(l.createdAt).getTime() : 0;
      if (c >= t0) { by[k].today++; today++; }
    }
    const rows = Object.entries(by)
      .map(([k, v]) => ({ key: k, ...v, ...(SOURCE_META[k] || SOURCE_META.otro) }))
      .sort((a, b) => b.count - a.count);
    return { rows, total: leads.length, todayTotal: today };
  }, [leads]);

  if (leads.length === 0) return null;

  return (
    <div
      className="row"
      style={{
        gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12,
        padding: "9px 13px", borderRadius: 11, border: "1px solid var(--border-1)", background: "var(--bg-1)",
      }}
    >
      <span className="row" style={{ gap: 7, alignItems: "center", flex: "0 0 auto" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent-green)", boxShadow: "0 0 0 3px var(--accent-green-soft)" }} />
        <span style={{ fontWeight: 800, fontSize: 12.5 }}>Ingesta en vivo</span>
        <span className="muted" style={{ fontSize: 11.5 }}>· {total} leads · <b style={{ color: "var(--accent-green)" }}>{todayTotal} hoy</b></span>
      </span>
      <span style={{ width: 1, height: 18, background: "var(--border-1)", flex: "0 0 auto" }} />
      <div className="row" style={{ gap: 7, flexWrap: "wrap", flex: 1 }}>
        {rows.map((r) => (
          <span
            key={r.key}
            title={`${r.count} de ${r.label}${r.today ? ` · ${r.today} hoy` : ""}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 99,
              border: `1px solid color-mix(in srgb, ${r.color} 35%, var(--border-1))`,
              background: `color-mix(in srgb, ${r.color} 9%, transparent)`, fontSize: 11.5, fontWeight: 600,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: r.color, flex: "0 0 auto" }} />
            {r.label}
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{r.count}</b>
            {r.today > 0 && <span style={{ color: "var(--accent-green)", fontSize: 10.5 }}>+{r.today}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
