import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, MessageCircle, Mail, Paperclip, History, MessagesSquare, Search, RefreshCw, Inbox, Sparkles } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useLeadOverview } from "@/hooks/useLeadOverview";
import { useContactSummary } from "@/hooks/useContactSummary";
import type { RecentLead } from "@/types/recordings";
import { ConversationCanvas } from "@/components/recordings/ConversationCanvas";
import { CallPlayerView, type ActiveCall } from "@/components/recordings/CallPlayerView";
import { WhatsAppThreadView } from "@/components/recordings/WhatsAppThreadView";
import { EmailThreadsView } from "@/components/recordings/EmailThreadsView";
import { AttachmentsGrid } from "@/components/recordings/AttachmentsGrid";
import { HistoryTimelineView } from "@/components/recordings/HistoryTimelineView";

/**
 * RecordingsWorkspace — el nuevo "Historial y Grabaciones" como workspace de
 * inteligencia conversacional (rediseño #fase1): lista de contactos (izq),
 * detalle del contacto con pestañas por canal embebidas SIN modales (centro),
 * y panel de contexto/insights del lead (der). Reemplaza la estructura
 * tabla → grid de tarjetas → modales por una sola vista persistente.
 */

type Lens = "conversation" | "calls" | "whatsapp" | "emails" | "files" | "history";
const TABS: { id: Lens; label: string; icon: React.ElementType; tone: string }[] = [
  { id: "conversation", label: "Conversación", icon: MessagesSquare, tone: "var(--accent-violet)" },
  { id: "calls", label: "Llamadas", icon: Phone, tone: "var(--accent-cyan)" },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, tone: "var(--accent-green)" },
  { id: "emails", label: "Emails", icon: Mail, tone: "var(--accent-amber)" },
  { id: "files", label: "Archivos", icon: Paperclip, tone: "var(--text-2)" },
  { id: "history", label: "Historial", icon: History, tone: "var(--accent-violet)" },
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
  if (k.includes("vox")) return { label: "AIRA", bg: "#7c5cff" };
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
function activityLabel(a?: RecentLead["lastActivity"]): string {
  if (!a) return "Sin actividad";
  if (a.type === "interaccion") return `${a.channel || "Interacción"}${a.untyped ? " · sin tipificar" : ""}`;
  if (a.type === "gestion") return `${a.channel || "Gestión"}${a.stageLabel ? ` · ${a.stageLabel}` : ""}`;
  if (a.type === "stage_change") return a.channel === "Salesforce" ? "Sync Salesforce" : `Etapa → ${a.stageLabel || "?"}`;
  if (a.type === "update") return "Datos actualizados";
  return a.channel || a.type || "Actividad";
}
const initials = (s: string) => (s || "?").slice(0, 2).toUpperCase();

const CHAN_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "llam", label: "Llamadas" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "correo", label: "Correo" },
];
function matchChannel(ch: string | undefined, key: string): boolean {
  if (key === "all") return true;
  const c = (ch || "").toLowerCase();
  if (key === "llam") return c.includes("llam") || c.includes("call") || c.includes("voz") || c.includes("voice") || c.includes("telef");
  if (key === "whatsapp") return c.includes("whatsapp") || c.includes("wa");
  if (key === "correo") return c.includes("correo") || c.includes("email") || c.includes("mail");
  return true;
}

/* ───────────────────────── Lista de contactos (izq) ───────────────────────── */
function ContactsList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (l: RecentLead) => void }) {
  const [rows, setRows] = useState<RecentLead[]>([]);
  const [allRows, setAllRows] = useState<RecentLead[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "err">(() => (getApiEndpoints()?.manageLeads ? "loading" : "err"));
  const [q, setQ] = useState("");
  const [chan, setChan] = useState("all");

  const reload = useCallback(() => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    fetch(`${ep.manageLeads}?recent=50`)
      .then((r) => r.json())
      .then((j) => { setRows(Array.isArray(j.recent) ? j.recent : []); setState("ok"); setAllRows(null); })
      .catch(() => setState((s) => (s === "loading" ? "err" : s)));
  }, []);

  useEffect(() => {
    reload();
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);

  useEffect(() => {
    if (q.trim().length < 2 || allRows) return;
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    const url = ep.manageLeads;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        const j = await r.json();
        setAllRows((j.leads || []).map((l: Record<string, unknown>) => ({
          leadId: String(l.leadId || ""), name: l.name as string | undefined, phone: String(l.phone || ""),
          email: l.email as string | undefined, company: l.company as string | undefined, stageId: l.stageId as string | undefined,
          source: l.source as string | undefined, sfLeadId: l.sfLeadId as string | undefined, updatedAt: l.updatedAt as string | undefined, lastActivity: null,
        })));
      } catch { /* búsqueda opcional */ }
    })();
    return () => ctrl.abort();
  }, [q, allRows]);

  const query = q.trim().toLowerCase();
  const sourceRows = query.length >= 2 && allRows ? allRows : rows;
  const base = query
    ? sourceRows.filter((r) => (r.name || "").toLowerCase().includes(query) || (r.company || "").toLowerCase().includes(query) || (r.phone || "").includes(query))
    : rows;
  const filtered = query || chan === "all" ? base : base.filter((r) => matchChannel(r.lastActivity?.channel, chan));

  return (
    <aside className="rec-list">
      <div className="rec-list__bar">
        <Search size={13} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto…" />
        <button onClick={reload} title="Actualizar" aria-label="Actualizar"><RefreshCw size={13} /></button>
      </div>
      <div className="rec-list__chips">
        {CHAN_FILTERS.map((f) => (
          <button key={f.id} className={`rec-list__chip ${chan === f.id ? "rec-list__chip--on" : ""}`} onClick={() => setChan(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="rec-list__rows">
        {state === "loading" ? (
          <div className="rec-list__msg">Cargando…</div>
        ) : state === "err" ? (
          <div className="rec-list__msg">No se pudo cargar.</div>
        ) : filtered.length === 0 ? (
          <div className="rec-list__msg">{query ? "Sin resultados." : "Sin contactos recientes."}</div>
        ) : (
          filtered.map((r) => {
            const o = originTone(r.source);
            const sel = selectedId === r.leadId;
            return (
              <button key={r.leadId} className={`rec-row ${sel ? "rec-row--sel" : ""}`} onClick={() => onSelect(r)}>
                <span className="rec-row__av">{initials(r.name || r.phone)}</span>
                <span className="rec-row__body">
                  <span className="rec-row__name">{r.name || r.phone}</span>
                  <span className="rec-row__sub">{activityLabel(r.lastActivity)} · {relTime(r.lastActivity?.ts || r.updatedAt)}</span>
                </span>
                <span className="rec-row__dot" title={o.label} style={{ background: o.bg }} />
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

/* ───────────────────────── Detalle del contacto (centro + der) ───────────────────────── */
function LeadDetail({ lead }: { lead: RecentLead }) {
  const { tree } = useTaxonomy();
  const ov = useLeadOverview(lead.phone);
  const [tab, setTab] = useState<Lens>("conversation");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  useEffect(() => { if (tab !== "calls") setActiveCall(null); }, [tab]);
  const name = lead.name || lead.phone;
  const origin = originTone(lead.source);
  const stageLabel = tree.find((s) => s.id === lead.stageId)?.label;
  const counts: Record<string, number | undefined> = useMemo(() => ({
    calls: ov.calls?.count, whatsapp: ov.whatsapp?.count, emails: ov.emails?.count, files: ov.files?.count, history: ov.history?.count,
  }), [ov]);
  const customerKey = lead.phone || lead.email || null;

  return (
    <>
      <main className="rec-main">
        <div className="rec-main__head">
          <span className="rec-main__av">{initials(name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rec-main__name">{name}</div>
            <div className="rec-main__meta">
              <span className="rec-origin" style={{ background: origin.bg }}>{origin.label}</span>
              {stageLabel && <span className="chip" style={{ height: 18, fontSize: 9.5 }}>{stageLabel}</span>}
              {lead.company && <span className="muted" style={{ fontSize: 11 }}>{lead.company}</span>}
            </div>
          </div>
          <div className="rec-actions">
            {lead.phone && <a className="btn btn--sm" href={`tel:${lead.phone}`} title={lead.phone}><Phone size={13} /></a>}
            {lead.phone && <a className="btn btn--sm" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={13} /></a>}
            {lead.email && <a className="btn btn--sm" href={`mailto:${lead.email}`} title={lead.email}><Mail size={13} /></a>}
          </div>
        </div>

        <div className="rec-tabs">
          {TABS.map((t) => {
            const c = counts[t.id];
            return (
              <button key={t.id} className={`rec-tab ${tab === t.id ? "rec-tab--on" : ""}`} onClick={() => setTab(t.id)} style={tab === t.id ? ({ "--rec-tone": t.tone } as React.CSSProperties) : undefined}>
                <t.icon size={14} /> {t.label}
                {typeof c === "number" && c > 0 && <span className="rec-tab__n">{c}</span>}
              </button>
            );
          })}
        </div>

        <div className="rec-view">
          {tab === "conversation" && <div className="rec-view__scroll"><ConversationCanvas phone={lead.phone} name={name} /></div>}
          {tab === "calls" && <CallPlayerView phone={lead.phone} onActiveCall={setActiveCall} />}
          {tab === "whatsapp" && <WhatsAppThreadView phone={lead.phone} />}
          {tab === "emails" && <EmailThreadsView customerKey={customerKey} />}
          {tab === "files" && <AttachmentsGrid phone={lead.phone} />}
          {tab === "history" && <HistoryTimelineView phone={lead.phone} name={name} />}
        </div>
      </main>

      <aside className="rec-ctx">
        <div className="rec-ctx__title">Contexto del lead</div>
        <div className="rec-ctx__counts">
          {TABS.filter((t) => t.id !== "conversation").map((t) => {
            const c = counts[t.id];
            return (
              <button key={t.id} className="rec-ctx__count" onClick={() => setTab(t.id)}>
                <span className="rec-ctx__count-ic" style={{ color: t.tone }}><t.icon size={15} /></span>
                <span className="rec-ctx__count-l">{t.label}</span>
                <span className="rec-ctx__count-n" style={{ color: c ? t.tone : "var(--text-3)" }}>{typeof c === "number" ? c : "·"}</span>
              </button>
            );
          })}
        </div>
        {activeCall ? (
          <LeadInsights call={activeCall} />
        ) : (
          <div className="rec-ctx__ai">
            <div className="rec-ctx__ai-h"><Sparkles size={13} /> Resumen IA</div>
            <div className="rec-ctx__ai-b">Abrí la pestaña <b>Llamadas</b> y elegí una llamada para ver su resumen y sentimiento acá.</div>
          </div>
        )}
      </aside>
    </>
  );
}

/** Insights IA de la llamada abierta (panel derecho): resumen + sentimiento. */
function LeadInsights({ call }: { call: ActiveCall }) {
  const { summary, loading } = useContactSummary(call.contactId, call.segments);
  const s = call.sentiment;
  const total = s.positive + s.negative + s.neutral + s.mixed;
  const seg = (n: number, color: string) => (n > 0 ? <span key={color} style={{ flex: n, background: color }} /> : null);
  return (
    <div className="rec-ctx__ai">
      <div className="rec-ctx__ai-h"><Sparkles size={13} /> Resumen IA</div>
      {loading ? (
        <div className="muted" style={{ fontSize: 12 }}>Generando resumen…</div>
      ) : summary ? (
        <div className="rec-ctx__ai-b">{summary}</div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>Sin transcripción para resumir esta llamada.</div>
      )}
      {total > 0 && (
        <div className="rec-sent">
          <div className="rec-sent__lbl">Sentimiento de la conversación</div>
          <div className="rec-sent__bar">
            {seg(s.positive, "var(--accent-green)")}
            {seg(s.neutral, "var(--bg-3)")}
            {seg(s.mixed, "var(--accent-amber)")}
            {seg(s.negative, "var(--accent-red)")}
          </div>
          <div className="rec-sent__legend">
            <span><span className="rec-sent__dot" style={{ background: "var(--accent-green)" }} /> {s.positive} positivo{s.positive === 1 ? "" : "s"}</span>
            <span><span className="rec-sent__dot" style={{ background: "var(--accent-red)" }} /> {s.negative} negativo{s.negative === 1 ? "" : "s"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyCenter() {
  return (
    <div className="rec-empty">
      <Inbox size={34} style={{ opacity: 0.4 }} />
      <div className="rec-empty__h">Elegí un contacto</div>
      <div className="rec-empty__p">Su historial, llamadas con audio, WhatsApp, emails y archivos aparecen acá — todo en un solo lugar.</div>
    </div>
  );
}

export function RecordingsWorkspace({ initialLead }: { initialLead?: RecentLead } = {}) {
  const [lead, setLead] = useState<RecentLead | null>(initialLead ?? null);
  return (
    <div className="rec-ws">
      <ContactsList selectedId={lead?.leadId || null} onSelect={setLead} />
      {lead ? <LeadDetail key={lead.leadId} lead={lead} /> : <EmptyCenter />}
    </div>
  );
}
