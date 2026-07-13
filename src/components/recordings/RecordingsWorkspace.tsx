import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  MessageCircle,
  Mail,
  Search,
  Sparkles,
  X,
  Share2,
  Download,
  RefreshCw,
} from "lucide-react";
import { Icon, Btn, Card, Pill, Av } from "@/components/aria";
import type { IconName } from "@/components/aria";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useLeadTaxonomyId } from "@/hooks/useLeadTaxonomyId";
import { useLeadOverview, type LeadOverview } from "@/hooks/useLeadOverview";
import { useContactSummary } from "@/hooks/useContactSummary";
import {
  useCallHistory,
  fetchContactHistory,
  invalidateContactHistory,
} from "@/hooks/useCallHistory";
import type { RecentLead } from "@/types/recordings";
import { ConversationCanvas } from "@/components/recordings/ConversationCanvas";
import { CallPlayerView, type ActiveCall } from "@/components/recordings/CallPlayerView";
import { WhatsAppThreadView } from "@/components/recordings/WhatsAppThreadView";
import { EmailThreadsView } from "@/components/recordings/EmailThreadsView";
import { AttachmentsGrid } from "@/components/recordings/AttachmentsGrid";
import { HistoryTimelineView } from "@/components/recordings/HistoryTimelineView";
import { ListeningCenter } from "@/components/recordings/ListeningCenter";
import { useTopBarActions } from "@/components/layout/TopBarSlot";
import { initials } from "@/lib/initials";

/**
 * RecordingsWorkspace — "Una sola historia" (rediseño a partir del mockup de
 * Claude Design). Reemplaza el layout de 3 paneles por un workspace de una sola
 * columna: barra de acciones + hero del contacto + navegador de canales + vista
 * activa, con un command palette (⌘K) para cambiar de contacto y un slide-over
 * de Resumen IA. Las vistas por canal (Llamadas/WhatsApp/Emails/Archivos/
 * Actividad) se reutilizan tal cual; lo que cambia es la "envoltura" narrativa.
 */

type Lens = "resumen" | "calls" | "whatsapp" | "emails" | "files" | "history";

interface ChannelDef {
  id: Exclude<Lens, "resumen">;
  label: string;
  icon: IconName;
  tone: string;
}
const CHANNELS: ChannelDef[] = [
  { id: "calls", label: "Llamadas", icon: "phone", tone: "var(--cyan)" },
  { id: "whatsapp", label: "WhatsApp", icon: "wa", tone: "var(--green)" },
  { id: "emails", label: "Emails", icon: "mail", tone: "var(--gold)" },
  { id: "files", label: "Archivos", icon: "paperclip", tone: "var(--iris)" },
  { id: "history", label: "Actividad", icon: "history", tone: "var(--text-2)" },
];

function originTone(src?: string): { label: string; bg: string } {
  const k = (src || "").toLowerCase();
  if (k.includes("instagram"))
    return { label: "Instagram", bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)" };
  if (k.includes("facebook") || k.includes("meta")) return { label: "Facebook", bg: "#1877f2" };
  if (k.includes("whatsapp")) return { label: "WhatsApp", bg: "#25d366" };
  if (k.includes("google")) return { label: "Google", bg: "#4285f4" };
  if (k.includes("web") || k.includes("form") || k.includes("landing"))
    return { label: "Web", bg: "#0a6bb5" };
  if (k.includes("referido") || k.includes("referral")) return { label: "Referido", bg: "#d98324" };
  if (k.includes("phone") || k.includes("telefon") || k.includes("llamada"))
    return { label: "Teléfono", bg: "#0aa5b5" };
  if (k.includes("vox")) return { label: "ARIA", bg: "#7c5cff" };
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
  if (a.type === "interaccion")
    return `${a.channel || "Interacción"}${a.untyped ? " · sin tipificar" : ""}`;
  if (a.type === "gestion")
    return `${a.channel || "Gestión"}${a.stageLabel ? ` · ${a.stageLabel}` : ""}`;
  if (a.type === "stage_change")
    return a.channel === "Salesforce" ? "Sync Salesforce" : `Etapa → ${a.stageLabel || "?"}`;
  if (a.type === "update") return "Datos actualizados";
  return a.channel || a.type || "Actividad";
}
const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const CHAN_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "llam", label: "Llamadas" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "correo", label: "Correo" },
];
function matchChannel(ch: string | undefined, key: string): boolean {
  if (key === "all") return true;
  const c = (ch || "").toLowerCase();
  if (key === "llam")
    return (
      c.includes("llam") ||
      c.includes("call") ||
      c.includes("voz") ||
      c.includes("voice") ||
      c.includes("telef")
    );
  if (key === "whatsapp") return c.includes("whatsapp") || c.includes("wa");
  if (key === "correo") return c.includes("correo") || c.includes("email") || c.includes("mail");
  return true;
}
function mapLead(l: Record<string, unknown>): RecentLead {
  return {
    leadId: String(l.leadId || ""),
    name: l.name as string | undefined,
    phone: String(l.phone || ""),
    email: l.email as string | undefined,
    company: l.company as string | undefined,
    stageId: l.stageId as string | undefined,
    source: l.source as string | undefined,
    sfLeadId: l.sfLeadId as string | undefined,
    updatedAt: l.updatedAt as string | undefined,
    lastActivity: null,
  };
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Sentimiento → color / etiqueta del heatmap (severidad-first en empate). */
const SENT_COLOR: Record<string, string> = {
  POSITIVE: "var(--green)",
  NEGATIVE: "var(--red)",
  MIXED: "var(--gold)",
  NEUTRAL: "var(--text-3)",
};
const SENT_LABEL: Record<string, string> = {
  POSITIVE: "positivo",
  NEGATIVE: "negativo",
  MIXED: "mixto",
  NEUTRAL: "neutral",
};
function dominantSentiment(s: Record<string, number>): string {
  let best = "";
  let bestN = 0;
  for (const k of ["NEGATIVE", "MIXED", "POSITIVE", "NEUTRAL"]) {
    const n = s[k] || 0;
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** Mapa de actividad anual (estilo contribuciones): una celda por día de los
 *  últimos ~6 meses, coloreada por el TONO dominante del día (verde/ámbar/rojo/
 *  gris) con intensidad por volumen. Click → pestaña Llamadas. */
function ActivityHeatmap({ phone, onGoto }: { phone: string; onGoto: (l: Lens) => void }) {
  const { rows, loading } = useCallHistory(phone);
  const byDay = useMemo(() => {
    const m: Record<string, { n: number; s: Record<string, number> }> = {};
    for (const r of rows) {
      const ch = (r.channel || "").toUpperCase();
      if (ch !== "VOICE" && ch !== "TELEPHONY") continue;
      const d = new Date(r.initiationTimestamp);
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKey(d);
      if (!m[k]) m[k] = { n: 0, s: {} };
      m[k].n += 1;
      const sent = String(r.sentiment || "").toUpperCase();
      if (sent) m[k].s[sent] = (m[k].s[sent] || 0) + 1;
    }
    return m;
  }, [rows]);

  const WEEKS = 26;
  const { cols, monthLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // alinear a lunes
    const grid: { date: Date; n: number; sent: string; future: boolean }[][] = [];
    const labels: { col: number; label: string }[] = [];
    const cur = new Date(start);
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: Date; n: number; sent: string; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const cd = byDay[dayKey(cur)];
        col.push({
          date: new Date(cur),
          n: cd?.n || 0,
          sent: cd ? dominantSentiment(cd.s) : "",
          future: cur > today,
        });
        if (d === 0 && cur.getMonth() !== lastMonth) {
          labels.push({ col: w, label: MES[cur.getMonth()] });
          lastMonth = cur.getMonth();
        }
        cur.setDate(cur.getDate() + 1);
      }
      grid.push(col);
    }
    return { cols: grid, monthLabels: labels };
  }, [byDay]);

  const intensity = (n: number) =>
    n <= 0 ? 0 : n === 1 ? 0.34 : n <= 3 ? 0.55 : n <= 5 ? 0.78 : 1;

  return (
    <Card
      title="Mapa de actividad"
      icon="calendar"
      extra={
        <Btn variant="ghost" size="sm" iconR="arrowRight" onClick={() => onGoto("calls")}>
          Ver llamadas
        </Btn>
      }
    >
      {loading ? (
        <div className="hg-heat" aria-label="Cargando actividad">
          {Array.from({ length: 26 }).map((_, w) => (
            <div className="hg-heat-col" key={w}>
              {Array.from({ length: 7 }).map((_, d) => (
                <span
                  key={d}
                  className="hg-heat-cell hg-sk"
                  style={{ animationDelay: `${(((w * 7 + d) % 14) * 0.06).toFixed(2)}s` }}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="hg-heat-months">
            {cols.map((_, w) => (
              <span key={w} className="hg-heat-mlabel">
                {monthLabels.find((m) => m.col === w)?.label || ""}
              </span>
            ))}
          </div>
          <div className="hg-heat">
            {cols.map((col, w) => (
              <div className="hg-heat-col" key={w}>
                {col.map((cell, d) => (
                  <span
                    key={d}
                    className="hg-heat-cell"
                    title={
                      cell.future
                        ? ""
                        : `${cell.date.getDate()} ${MES[cell.date.getMonth()]} · ${cell.n} llamada${cell.n === 1 ? "" : "s"}${cell.sent ? ` · ${SENT_LABEL[cell.sent] || ""}` : ""}`
                    }
                    onClick={() => cell.n > 0 && onGoto("calls")}
                    style={{
                      background:
                        cell.n > 0 ? SENT_COLOR[cell.sent] || "var(--cyan)" : "var(--bg-3)",
                      opacity: cell.future ? 0 : cell.n > 0 ? intensity(cell.n) : 1,
                      cursor: cell.n > 0 ? "pointer" : "default",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="hg-heat-legend">
            <span
              className="hg-heat-cell"
              style={{ background: "var(--green)" }}
              title="Día positivo"
            />
            <span style={{ marginRight: 10 }}>positivo</span>
            <span
              className="hg-heat-cell"
              style={{ background: "var(--gold)" }}
              title="Día mixto"
            />
            <span style={{ marginRight: 10 }}>mixto</span>
            <span
              className="hg-heat-cell"
              style={{ background: "var(--red)" }}
              title="Día negativo"
            />
            <span style={{ marginRight: 10 }}>negativo</span>
            <span
              className="hg-heat-cell"
              style={{ background: "var(--text-3)" }}
              title="Neutral o sin dato"
            />
            <span>neutral · intensidad = volumen</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Foto de la relación a partir de los conteos por canal de useLeadOverview. */
function relationSummary(ov: LeadOverview) {
  const ch = [
    {
      key: "calls",
      label: "Llamadas",
      count: ov.calls?.count ?? 0,
      lastTs: ov.calls?.lastTs,
      tone: "--cyan",
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      count: ov.whatsapp?.count ?? 0,
      lastTs: ov.whatsapp?.lastTs,
      tone: "--green",
    },
    {
      key: "emails",
      label: "Emails",
      count: ov.emails?.count ?? 0,
      lastTs: ov.emails?.lastTs,
      tone: "--gold",
    },
    {
      key: "files",
      label: "Archivos",
      count: ov.files?.count ?? 0,
      lastTs: undefined as string | undefined,
      tone: "--iris",
    },
  ];
  const total = ch.reduce((a, c) => a + c.count, 0);
  const last = ch.filter((c) => c.lastTs).sort((a, b) => (a.lastTs! < b.lastTs! ? 1 : -1))[0];
  const primary = [...ch].sort((a, b) => b.count - a.count)[0];
  const daysSince = last?.lastTs
    ? Math.floor((Date.now() - new Date(last.lastTs).getTime()) / 86400000)
    : null;
  const nba =
    daysSince == null
      ? null
      : daysSince <= 1
        ? "Conversación reciente — sin acción pendiente."
        : daysSince <= 7
          ? `Última actividad hace ${daysSince} días — buen momento para un seguimiento.`
          : `Sin contacto hace ${daysSince} días — considera reactivar al cliente.`;
  return { ch, total, last, primary, daysSince, nba };
}

/* ───────────────────────── Command palette (cambiar de contacto) ───────────────────────── */
function CommandPalette({
  open,
  onClose,
  onPick,
  currentId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (l: RecentLead) => void;
  currentId: string | null;
}) {
  const [rows, setRows] = useState<RecentLead[]>([]);
  const [allRows, setAllRows] = useState<RecentLead[] | null>(null);
  const [q, setQ] = useState("");
  const [chan, setChan] = useState("all");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setChan("all");
    setCursor(0);
    const ep = getApiEndpoints();
    if (ep?.manageLeads) {
      authedFetch(`${ep.manageLeads}?recent=50`)
        .then((r) => r.json())
        .then((j) => setRows(Array.isArray(j.recent) ? j.recent : []))
        .catch(() => {});
    }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2 || allRows) return;
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    const url = ep.manageLeads;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await authedFetch(url, { signal: ctrl.signal });
        const j = await r.json();
        setAllRows((j.leads || []).map(mapLead));
      } catch {
        /* búsqueda opcional */
      }
    })();
    return () => ctrl.abort();
  }, [open, q, allRows]);

  const query = q.trim().toLowerCase();
  const sourceRows = query.length >= 2 && allRows ? allRows : rows;
  const base = query
    ? sourceRows.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(query) ||
          (r.company || "").toLowerCase().includes(query) ||
          (r.phone || "").includes(query),
      )
    : rows;
  const filtered =
    query || chan === "all"
      ? base
      : base.filter((r) => matchChannel(r.lastActivity?.channel, chan));

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(filtered.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        const r = filtered[cursor];
        if (r) {
          onPick(r);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, filtered, cursor, onClose, onPick]);

  if (!open) return null;
  return (
    <>
      <div className="hg-cmd-scrim" onClick={onClose} />
      <div className="hg-cmd" role="dialog" aria-label="Buscar contacto">
        <div className="hg-cmd__search">
          <Search size={18} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Buscar contacto por nombre, teléfono o empresa…"
          />
          <span className="hg-chip">esc</span>
        </div>
        <div className="hg-cmd__filters">
          {CHAN_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`hg-fchip ${chan === f.id ? "hg-fchip--on" : ""}`}
              onClick={() => {
                setChan(f.id);
                setCursor(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="hg-cmd__list">
          {filtered.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              {query ? "Sin resultados." : "Sin contactos recientes."}
            </div>
          ) : (
            filtered.map((r, i) => {
              const o = originTone(r.source);
              return (
                <button
                  key={r.leadId}
                  className={`hg-cmd__row ${i === cursor ? "hg-cmd__row--cursor" : ""} ${r.leadId === currentId ? "hg-cmd__row--sel" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    onPick(r);
                    onClose();
                  }}
                >
                  <span className="rec-row__av">{initials(r.name || r.phone)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 700,
                        fontSize: 14,
                        color: "var(--text-1)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name || r.phone}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-3)" }}>
                      {activityLabel(r.lastActivity)} · {relTime(r.lastActivity?.ts || r.updatedAt)}
                    </span>
                  </span>
                  <span className="rec-row__dot" title={o.label} style={{ background: o.bg }} />
                </button>
              );
            })
          )}
        </div>
        <div className="hg-cmd__foot">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc cerrar</span>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── Hero del contacto ───────────────────────── */
function Hero({
  lead,
  ov,
  stageLabel,
  onSwitch,
  onOpenAI,
}: {
  lead: RecentLead;
  ov: LeadOverview;
  stageLabel?: string;
  onSwitch: () => void;
  onOpenAI: () => void;
}) {
  const name = lead.name || lead.phone;
  const origin = originTone(lead.source);
  const { last } = relationSummary(ov);
  const digits = (lead.phone || "").replace(/\D/g, "");
  return (
    <div className="card card__pad" style={{ marginBottom: 14 }}>
      <div className="row between wrap gap12">
        <div className="row gap14" style={{ minWidth: 0 }}>
          <Av name={name} size={52} radius={15} color="var(--cyan)" style={{ flex: "0 0 auto" }} />
          <div style={{ minWidth: 0 }}>
            <button
              className="row gap6"
              onClick={onSwitch}
              title="Cambiar de contacto (⌘K)"
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                maxWidth: "100%",
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "var(--text-1)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {name}
              </span>
              <Icon name="chevD" size={18} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
            </button>
            <div className="row gap8 wrap" style={{ marginTop: 5 }}>
              <span className="pill" style={{ background: origin.bg, color: "#fff" }}>
                {origin.label}
              </span>
              {stageLabel && <Pill tone="accent">{stageLabel}</Pill>}
              {lead.company && <Pill icon="building">{lead.company}</Pill>}
              {lead.phone && (
                <Pill icon="phone" className="mono">
                  {lead.phone}
                </Pill>
              )}
              {last && <Pill tone="cyan">Activo · {relTime(last.lastTs)}</Pill>}
            </div>
          </div>
        </div>
        <div className="row gap6">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              title="Llamar"
              className="btn btn--ghost btn--sm btn--icon"
              style={{ color: "var(--cyan)" }}
            >
              <Phone size={16} />
            </a>
          )}
          {digits && (
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noreferrer"
              title="WhatsApp"
              className="btn btn--ghost btn--sm btn--icon"
              style={{ color: "var(--green)" }}
            >
              <MessageCircle size={16} />
            </a>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              title="Email"
              className="btn btn--ghost btn--sm btn--icon"
              style={{ color: "var(--gold)" }}
            >
              <Mail size={16} />
            </a>
          )}
          <Btn variant="primary" size="sm" icon="sparkle" onClick={onOpenAI}>
            Resumen IA
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Navegador de canales ───────────────────────── */
function ChannelNav({
  active,
  onChange,
  counts,
}: {
  active: Lens;
  onChange: (l: Lens) => void;
  counts: Record<string, number | undefined>;
}) {
  const tabs: { id: Lens; label: string; icon: IconName }[] = [
    { id: "resumen", label: "Resumen", icon: "eye" },
    ...CHANNELS.map((c) => ({ id: c.id as Lens, label: c.label, icon: c.icon })),
  ];
  return (
    <nav className="row gap8 wrap" aria-label="Canales" style={{ marginBottom: 16 }}>
      {tabs.map((t) => {
        const on = active === t.id;
        const n = t.id === "resumen" ? undefined : counts[t.id];
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="card"
            style={{
              padding: "10px 15px",
              display: "flex",
              alignItems: "center",
              gap: 9,
              cursor: "pointer",
              border: on ? "1.5px solid var(--accent)" : "1px solid var(--border-1)",
              background: on ? "var(--accent-soft)" : "var(--bg-1)",
            }}
          >
            <Icon
              name={t.icon}
              size={16}
              style={{ color: on ? "var(--accent)" : "var(--text-3)" }}
            />
            <span
              style={{
                fontWeight: 700,
                fontSize: 13,
                color: on ? "var(--accent)" : "var(--text-1)",
              }}
            >
              {t.label}
            </span>
            {typeof n === "number" && <span className="sb__count tnum">{n}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/* ───────────────────────── Vista Resumen ───────────────────────── */
function OverviewView({
  lead,
  ov,
  onGoto,
  onOpenAI,
}: {
  lead: RecentLead;
  ov: LeadOverview;
  onGoto: (l: Lens) => void;
  onOpenAI: () => void;
}) {
  const name = lead.name || lead.phone;
  const { ch, total, last, primary, nba } = relationSummary(ov);
  const mix = ch.filter((c) => c.count > 0);
  return (
    <div className="hg-ov">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {lead.phone && <ActivityHeatmap phone={lead.phone} onGoto={onGoto} />}
        <Card
          title="Línea de tiempo · todos los canales"
          icon="history"
          extra={
            <span className="dim tnum" style={{ fontSize: 12, fontWeight: 700 }}>
              {total} interaccion{total === 1 ? "" : "es"}
            </span>
          }
        >
          <ConversationCanvas phone={lead.phone} name={name} />
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <Card title="Resumen del cliente" icon="user">
          <div className="row between" style={{ padding: "7px 0" }}>
            <span className="muted" style={{ fontWeight: 600 }}>
              Última interacción
            </span>
            <b>{last ? `${last.label} · ${relTime(last.lastTs)}` : "—"}</b>
          </div>
          <div className="row between" style={{ padding: "7px 0" }}>
            <span className="muted" style={{ fontWeight: 600 }}>
              Canal principal
            </span>
            <b>{primary.count ? primary.label : "—"}</b>
          </div>
          <div className="row between" style={{ padding: "7px 0" }}>
            <span className="muted" style={{ fontWeight: 600 }}>
              Total interacciones
            </span>
            <b className="tnum">{total}</b>
          </div>
          {total > 0 && (
            <>
              <div
                style={{
                  margin: "12px 0 8px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--text-3)",
                }}
              >
                Mezcla de canales
              </div>
              <div style={{ display: "flex", gap: 2, height: 10 }}>
                {mix.map((c) => (
                  <div
                    key={c.key}
                    title={`${c.label}: ${c.count}`}
                    style={{ flex: c.count, background: `var(${c.tone})`, borderRadius: 99 }}
                  />
                ))}
              </div>
              <div
                className="row wrap gap14"
                style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-3)", fontWeight: 700 }}
              >
                {mix.map((c) => (
                  <span key={c.key} className="row gap4" style={{ alignItems: "center" }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: `var(${c.tone})`,
                      }}
                    />{" "}
                    {c.label} {c.count}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        {nba && (
          <button
            onClick={onOpenAI}
            className="card card__accent-bar hg-lift"
            style={
              {
                "--_c": "var(--iris)",
                padding: "18px 20px",
                textAlign: "left",
                cursor: "pointer",
                background: "linear-gradient(135deg,var(--iris-soft),var(--bg-1))",
              } as React.CSSProperties
            }
          >
            <div className="row gap8" style={{ alignItems: "center", marginBottom: 8 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9,
                  background: "var(--iris)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Icon name="sparkle" size={16} />
              </span>
              <span style={{ fontWeight: 800, fontSize: 14, color: "var(--iris)" }}>
                Sugerencia IA
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>{nba}</div>
            <div
              className="row gap4"
              style={{
                marginTop: 10,
                fontSize: 12.5,
                fontWeight: 800,
                color: "var(--iris)",
                alignItems: "center",
              }}
            >
              Ver resumen IA <Icon name="arrowRight" size={14} />
            </div>
          </button>
        )}

        <Btn
          variant="ghost"
          size="sm"
          iconR="arrowRight"
          style={{ alignSelf: "flex-start" }}
          onClick={() => onGoto("calls")}
        >
          Ver todas las llamadas
        </Btn>
      </div>
    </div>
  );
}

/* ───────────────────────── Resumen IA (slide-over) ───────────────────────── */
function AISlideOver({
  lead,
  ov,
  activeCall,
  onClose,
}: {
  lead: RecentLead | null;
  ov: LeadOverview;
  activeCall: ActiveCall | null;
  onClose: () => void;
}) {
  const { summary, loading } = useContactSummary(
    activeCall?.contactId ?? null,
    activeCall?.segments ?? null,
  );
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const { total, last, primary, nba } = relationSummary(ov);
  const s = activeCall?.sentiment;
  const sentTotal = s ? s.positive + s.negative + s.neutral + s.mixed : 0;
  const seg = (n: number, color: string) =>
    n > 0 ? <span key={color} style={{ flex: n, background: color }} /> : null;
  const lbl = (t: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        color: "var(--text-3)",
        marginBottom: 10,
      }}
    >
      {t}
    </div>
  );

  return (
    <>
      <div className="hg-ai-scrim" onClick={onClose} />
      <div className="hg-ai" role="dialog" aria-label="Resumen IA">
        <div
          style={{
            padding: "20px 22px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 11,
            position: "sticky",
            top: 0,
            background: "var(--bg-1)",
            zIndex: 2,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--iris)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              flex: "0 0 34px",
            }}
          >
            <Sparkles size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Resumen IA</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {lead?.name || lead?.phone || ""} · Amazon Bedrock
            </div>
          </div>
          <button
            className="hg-act"
            onClick={onClose}
            title="Cerrar"
            style={{ width: 34, height: 34 }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            overflowY: "auto",
          }}
        >
          {activeCall ? (
            <>
              <div>
                {lbl("Resumen de la llamada")}
                {loading ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Generando resumen…
                  </div>
                ) : summary ? (
                  <div style={{ fontSize: 14, color: "var(--text-1)", lineHeight: 1.65 }}>
                    {summary}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Sin transcripción para resumir esta llamada.
                  </div>
                )}
              </div>
              {sentTotal > 0 && s && (
                <div>
                  {lbl("Sentimiento (Contact Lens)")}
                  <div className="rec-sent__bar">
                    {seg(s.positive, "var(--green)")}
                    {seg(s.neutral, "var(--bg-3)")}
                    {seg(s.mixed, "var(--gold)")}
                    {seg(s.negative, "var(--red)")}
                  </div>
                  <div className="rec-sent__legend" style={{ marginTop: 10 }}>
                    <span>
                      <span className="rec-sent__dot" style={{ background: "var(--green)" }} />{" "}
                      {s.positive} positivo{s.positive === 1 ? "" : "s"}
                    </span>
                    <span>
                      <span className="rec-sent__dot" style={{ background: "var(--red)" }} />{" "}
                      {s.negative} negativo{s.negative === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              )}
              {activeCall.moments.length > 0 && (
                <div>
                  {lbl("Momentos clave")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activeCall.moments.map((m, i) => (
                      <div
                        key={i}
                        className="hg-card2"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 11,
                          padding: "10px 13px",
                        }}
                      >
                        <span
                          className="mono"
                          style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)" }}
                        >
                          {mmss(m.sec)}
                        </span>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 99,
                            flex: "0 0 8px",
                            background: m.tone === "pos" ? "var(--green)" : "var(--red)",
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                {lbl("Resumen de la relación")}
                <div className="hg-row">
                  <span style={{ color: "var(--text-3)", fontWeight: 600 }}>
                    Última interacción
                  </span>
                  <b>{last ? `${last.label} · ${relTime(last.lastTs)}` : "—"}</b>
                </div>
                <div className="hg-row">
                  <span style={{ color: "var(--text-3)", fontWeight: 600 }}>Canal principal</span>
                  <b>{primary.count ? primary.label : "—"}</b>
                </div>
                <div className="hg-row">
                  <span style={{ color: "var(--text-3)", fontWeight: 600 }}>
                    Total interacciones
                  </span>
                  <b className="mono">{total}</b>
                </div>
              </div>
              {nba && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--iris-soft)",
                    color: "var(--iris-2)",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    gap: 9,
                    lineHeight: 1.55,
                  }}
                >
                  <Sparkles size={16} style={{ flex: "0 0 16px", marginTop: 1 }} /> {nba}
                </div>
              )}
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Abre una llamada en la pestaña <b>Llamadas</b> para ver su resumen IA y el
                sentimiento de esa conversación.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── Workspace ───────────────────────── */
export function RecordingsWorkspace({ initialLead }: { initialLead?: RecentLead } = {}) {
  const [lead, setLead] = useState<RecentLead | null>(initialLead ?? null);
  const [tab, setTab] = useState<Lens>("resumen");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = async () => {
    if (!lead?.phone || refreshing) return;
    setRefreshing(true);
    try {
      invalidateContactHistory(lead.phone);
      await fetchContactHistory(lead.phone, { fresh: true });
    } catch {
      /* best-effort */
    }
    setRefreshKey((k) => k + 1); // re-monta las vistas → re-leen datos frescos
    setRefreshing(false);
  };
  const { tree } = useTaxonomy(useLeadTaxonomyId(lead?.phone ?? null));
  const ov = useLeadOverview(lead?.phone ?? null);

  useEffect(() => {
    setTab("resumen");
    setActiveCall(null);
  }, [lead?.leadId]);
  useEffect(() => {
    if (tab !== "calls") setActiveCall(null);
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts: Record<string, number | undefined> = useMemo(
    () => ({
      calls: ov.calls?.count,
      whatsapp: ov.whatsapp?.count,
      emails: ov.emails?.count,
      files: ov.files?.count,
      history: ov.history?.count,
    }),
    [ov],
  );

  const name = lead ? lead.name || lead.phone : "";
  const stageLabel = lead ? tree.find((s) => s.id === lead.stageId)?.label : undefined;
  const customerKey = lead ? lead.phone || lead.email || null : null;

  // Acciones de la página → top bar (chrome conectado al sidebar). Antes vivían
  // en una .hg-toolbar dentro del contenido.
  useTopBarActions(
    <>
      <button
        className="btn"
        disabled={!lead || refreshing}
        onClick={onRefresh}
        title="Actualizar datos del contacto"
      >
        <RefreshCw size={14} className={refreshing ? "hg-spin" : ""} />{" "}
        {refreshing ? "Actualizando…" : "Actualizar"}
      </button>
      <button className="btn" disabled={!lead} title="Compartir — próximamente">
        <Share2 size={14} /> Compartir
      </button>
      <button className="btn" disabled={!lead} title="Exportar — próximamente">
        <Download size={14} /> Exportar
      </button>
    </>,
    [lead, refreshing],
  );

  return (
    <div className="hg hg--flow">
      {/* En la página ARIA, el contenedor `.page` ya aporta ancho/padding; anulamos
          el padding/max-width propio de `.hg-inner` para no duplicarlos. En el
          modo embebido (demo) hereda el ancho del contenedor igual. */}
      <div className="hg-inner" style={{ maxWidth: "none", padding: 0 }}>
        {lead ? (
          <>
            <Hero
              lead={lead}
              ov={ov}
              stageLabel={stageLabel}
              onSwitch={() => setCmdOpen(true)}
              onOpenAI={() => setAiOpen(true)}
            />
            <ChannelNav active={tab} onChange={setTab} counts={counts} />
            <div key={`${lead.leadId}-${tab}-${refreshKey}`} className="hg-fade">
              {tab === "resumen" && (
                <OverviewView
                  lead={lead}
                  ov={ov}
                  onGoto={setTab}
                  onOpenAI={() => setAiOpen(true)}
                />
              )}
              {tab === "calls" && (
                <CallPlayerView phone={lead.phone} onActiveCall={setActiveCall} />
              )}
              {tab === "whatsapp" && <WhatsAppThreadView phone={lead.phone} />}
              {tab === "emails" && <EmailThreadsView customerKey={customerKey} />}
              {tab === "files" && <AttachmentsGrid phone={lead.phone} />}
              {tab === "history" && <HistoryTimelineView phone={lead.phone} name={name} />}
            </div>
          </>
        ) : (
          <div style={{ minHeight: "60vh" }}>
            <ListeningCenter onPick={setLead} onSearch={() => setCmdOpen(true)} />
          </div>
        )}
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onPick={setLead}
        currentId={lead?.leadId || null}
      />
      {aiOpen && (
        <AISlideOver lead={lead} ov={ov} activeCall={activeCall} onClose={() => setAiOpen(false)} />
      )}
    </div>
  );
}
