import { useState } from "react";
import * as Icon from "@/components/vox/primitives";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useLeadOverview, type OvHistEvent } from "@/hooks/useLeadOverview";
import type { RecentLead } from "@/components/recordings/RecentContactsTable";
import { HistoryTimelineView } from "@/components/recordings/HistoryTimelineView";
import { WhatsAppThreadView } from "@/components/recordings/WhatsAppThreadView";
import { CallLogView } from "@/components/recordings/CallLogView";
import { EmailThreadsView } from "@/components/recordings/EmailThreadsView";
import { AttachmentsGrid } from "@/components/recordings/AttachmentsGrid";

/**
 * Lead360View — vista única del lead estilo "cuenta" de Salesforce, en GRID:
 * un panel grande de Historial + tarjetas por canal (Llamadas, WhatsApp,
 * Emails, Archivos) con un preview (conteo + última actividad). Cada panel
 * tiene un botón "Ver más detalles" que abre el detalle completo en un modal.
 * Sin barra de tabs — todo a la vista, conectado por el nombre del lead.
 */
type Lens = "history" | "calls" | "whatsapp" | "emails" | "files";

const CHANNELS: { id: Exclude<Lens, "history">; label: string; icon: string; tone: string }[] = [
  { id: "calls", label: "Llamadas", icon: "📞", tone: "var(--accent-cyan)" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", tone: "var(--accent-green)" },
  { id: "emails", label: "Emails", icon: "📧", tone: "var(--accent-amber)" },
  { id: "files", label: "Archivos", icon: "📎", tone: "var(--text-2)" },
];

function originTone(src?: string): { label: string; bg: string } {
  const k = (src || "").toLowerCase();
  if (k.includes("instagram")) return { label: "Instagram", bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)" };
  if (k.includes("facebook") || k.includes("meta")) return { label: "Facebook", bg: "#1877f2" };
  if (k.includes("whatsapp")) return { label: "WhatsApp", bg: "#25d366" };
  if (k.includes("google")) return { label: "Google", bg: "#4285f4" };
  if (k.includes("web") || k.includes("form") || k.includes("landing")) return { label: "Web", bg: "#0a6bb5" };
  if (k.includes("referido") || k.includes("referral")) return { label: "Referido", bg: "#d98324" };
  if (k.includes("phone") || k.includes("telefon") || k.includes("llamada")) return { label: "Teléfono", bg: "#0aa5b5" };
  if (k.includes("vox")) return { label: "Vox", bg: "#7c5cff" };
  return { label: src || "—", bg: "var(--text-3)" };
}
function relTime(iso?: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString();
}
function evIcon(ev: OvHistEvent) {
  const c = (ev.channel || "").toLowerCase();
  if (ev.type === "stage_change") return c.includes("salesforce") ? <Icon.Cloud size={12} /> : <Icon.Tag size={12} />;
  if (c.includes("llam") || c.includes("call")) return <Icon.Phone size={12} />;
  if (c.includes("correo") || c.includes("email")) return <Icon.Mail size={12} />;
  if (c.includes("whatsapp")) return <Icon.WhatsApp size={12} />;
  return <Icon.Note size={12} />;
}
function evTitle(ev: OvHistEvent): string {
  if (ev.type === "interaccion") return `${ev.channel || "Interacción"}${ev.untyped ? " (sin tipificar)" : ""}`;
  if (ev.type === "gestion") return `${ev.channel || "Gestión"}${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}`;
  if (ev.type === "stage_change") return ev.channel === "Salesforce" ? `Sync Salesforce${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}` : `Etapa → ${ev.stageLabel || "?"}`;
  if (ev.type === "update") return "Datos actualizados";
  return ev.summary || "Evento";
}

export function Lead360View({ lead, onBack }: { lead: RecentLead; onBack: () => void }) {
  const { tree } = useTaxonomy();
  const ov = useLeadOverview(lead.phone);
  const [detail, setDetail] = useState<Lens | null>(null);

  const name = lead.name || lead.phone;
  const origin = originTone(lead.source);
  const stageLabel = tree.find((s) => s.id === lead.stageId)?.label;

  const moreBtn = (lens: Lens) => (
    <button onClick={() => setDetail(lens)} className="btn btn--sm" style={{ alignSelf: "flex-start" }}>
      Ver más detalles →
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Encabezado del lead */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-1)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} className="btn btn--ghost btn--sm" title="Volver a recientes">←</button>
        <span style={{ flex: "0 0 auto", width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}>
          {(name || "?").slice(0, 2).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{name}</div>
          <div className="row" style={{ gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: origin.bg, color: "#fff" }}>{origin.label}</span>
            {stageLabel ? <span className="chip" style={{ height: 18, fontSize: 9.5 }}>{stageLabel}</span> : null}
            {lead.company ? <span className="muted" style={{ fontSize: 11 }}>{lead.company}</span> : null}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {lead.phone ? <a className="btn btn--sm" href={`tel:${lead.phone}`} title={lead.phone}><Icon.Phone size={13} /></a> : null}
          {lead.phone ? <a className="btn btn--sm" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp"><Icon.WhatsApp size={13} /></a> : null}
          {lead.email ? <a className="btn btn--sm" href={`mailto:${lead.email}`} title={lead.email}><Icon.Mail size={13} /></a> : null}
        </div>
      </div>

      {/* Grid de paneles */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Panel grande: Historial */}
        <section style={{ flex: "1.7 1 360px", minWidth: 300, border: "1px solid var(--border-1)", borderRadius: 12, background: "var(--bg-2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="row" style={{ gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-1)" }}>
            <span style={{ fontSize: 15 }}>📜</span>
            <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Historial {ov.history ? `(${ov.history.count})` : ""}</span>
          </div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {!ov.history ? (
              <div className="muted" style={{ fontSize: 12 }}>Cargando…</div>
            ) : ov.history.recent.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>Sin actividad registrada todavía.</div>
            ) : (
              ov.history.recent.map((ev, i) => (
                <div key={i} className="row" style={{ gap: 9, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--bg-1)", color: "var(--accent-violet)", border: "1px solid var(--border-1)", marginTop: 1 }}>
                    {evIcon(ev)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{evTitle(ev)}</span>
                      <span className="muted" style={{ fontSize: 10, flex: "0 0 auto" }}>{(ev.ts || "").slice(0, 10)}</span>
                    </div>
                    {ev.summary ? <div className="muted" style={{ fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.summary}</div> : null}
                  </div>
                </div>
              ))
            )}
            <div style={{ flex: 1 }} />
            {moreBtn("history")}
          </div>
        </section>

        {/* Columna de tarjetas por canal */}
        <div style={{ flex: "1 1 280px", minWidth: 260, display: "flex", flexDirection: "column", gap: 14 }}>
          {CHANNELS.map((c) => {
            const sum = ov[c.id];
            return (
              <section key={c.id} style={{ border: "1px solid var(--border-1)", borderRadius: 12, background: "var(--bg-2)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <span style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 17, background: "var(--bg-1)", border: `1px solid ${c.tone}44` }}>{c.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {!sum ? "Cargando…" : sum.count === 0 ? "Sin registros" : `${sum.count} · última ${relTime(sum.lastTs)}`}
                    </div>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 800, color: sum && sum.count > 0 ? c.tone : "var(--text-3)" }}>{sum ? sum.count : "·"}</span>
                </div>
                {moreBtn(c.id)}
              </section>
            );
          })}
        </div>
      </div>

      {/* Modal de detalle completo del canal */}
      {detail && (
        <DetailModal lens={detail} lead={lead} name={name} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function DetailModal({ lens, lead, name, onClose }: { lens: Lens; lead: RecentLead; name: string; onClose: () => void }) {
  const TITLES: Record<Lens, string> = {
    history: "Historial completo",
    calls: "Llamadas",
    whatsapp: "WhatsApp",
    emails: "Emails",
    files: "Archivos",
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", padding: 20, backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(880px, 100%)", height: "min(86vh, 100%)", background: "var(--bg-1)", border: "1px solid var(--border-2)", borderRadius: 14, boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="row" style={{ gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border-1)" }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{TITLES[lens]} · {name}</span>
          <button onClick={onClose} className="btn btn--ghost btn--sm" title="Cerrar"><Icon.Close size={15} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {lens === "history" && <HistoryTimelineView phone={lead.phone} name={name} />}
          {lens === "calls" && <CallLogView phone={lead.phone} />}
          {lens === "whatsapp" && <WhatsAppThreadView phone={lead.phone} />}
          {lens === "emails" && <EmailThreadsView customerKey={lead.phone || lead.email || null} />}
          {lens === "files" && <AttachmentsGrid phone={lead.phone} />}
        </div>
      </div>
    </div>
  );
}
