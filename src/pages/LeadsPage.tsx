import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useCan } from "@/hooks/usePermissions";
import { useCCP } from "@/hooks/useCCP";
import { useConnections } from "@/hooks/useConnections";
import { NotIntegrated } from "@/components/vox/NotIntegrated";
import { VALORACION_META, type Valoracion } from "@/lib/dispositions";
import * as Icon from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import { WhatsAppQuickSendModal } from "@/components/workspace/WhatsAppQuickSendModal";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * LeadsPage — unified lead funnel / embudo (roadmap #4, Kommo/Pipedrive-style).
 * Board columns are the SAME canonical taxonomy stages the wrap-up uses (#2),
 * so a lead's column == its tipificación.
 *
 * Pipedrive-grade UX: drag & drop, per-column deal value + weighted value +
 * stage conversion %, inline "+ lead" per column, hover quick-actions
 * (call/WhatsApp/email), age badges, source filter, and a centered detail
 * modal (overlay) for view/edit/delete.
 */
interface Lead {
  leadId: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  montoEstimado?: number;
  createdAt?: string;
  updatedAt?: string;
  assignedAgent?: string;
  /** Id del Lead en Salesforce — presente ⇒ está sincronizado con SF. */
  sfLeadId?: string;
  attributes?: Record<string, string>;
}

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Web",
  campaign: "Campaña",
  salesforce: "Salesforce",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

const TONE_COLOR: Record<string, string> = {
  "chip--green": "var(--accent-green)",
  "chip--cyan": "var(--accent-cyan)",
  "chip--amber": "var(--accent-amber)",
  "chip--red": "var(--accent-red)",
  "chip--violet": "var(--accent-violet)",
  "chip--pink": "var(--accent-pink)",
};

const DND_LEAD = "lead";

/** Win probability per stage: closes = 100%, lost = 0%, otherwise scales
 *  with the stage's position in the funnel (deeper = more likely). */
function stageProbability(valoracion: Valoracion, index: number, total: number): number {
  if (valoracion === "cierre") return 1;
  if (valoracion === "negativa") return 0;
  if (total <= 1) return 0.5;
  return Math.round((0.15 + (index / (total - 1)) * 0.7) * 100) / 100;
}

function initialsOf(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtMoney(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) return `S/ ${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `S/ ${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `S/ ${Math.round(n)}`;
}

function ageInfo(iso?: string): { label: string; stale: boolean } {
  if (!iso) return { label: "", stale: false };
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  if (days >= 1) return { label: `hace ${days}d`, stale: days >= 7 };
  if (hours >= 1) return { label: `hace ${hours}h`, stale: false };
  return { label: "reciente", stale: false };
}

/* ── Draggable lead card with hover quick-actions ──────────────────── */
function LeadCard({
  lead,
  color,
  canManage,
  onOpen,
  onCall,
  onWhatsApp,
  selected,
  anySelected,
  onToggleSelect,
}: {
  lead: Lead;
  color: string;
  canManage: boolean;
  onOpen: () => void;
  /** Fire an outbound voice call through the agent's softphone (via
   *  Amazon Connect). Replaces the legacy `tel:` link. */
  onCall: (phone: string) => void;
  /** Open the WhatsApp template quick-send modal (via Amazon Connect
   *  SocialMessaging). Replaces the legacy `wa.me/` link. */
  onWhatsApp: (phone: string, name?: string) => void;
  /** Whether this card is in the bulk-action selection set. */
  selected: boolean;
  /** True when at least one other card on the board is selected.
   *  We pin the checkbox visible in that case so the agent can keep
   *  picking without hunting per-card hover targets. */
  anySelected: boolean;
  onToggleSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_LEAD,
      item: { leadId: lead.leadId, stageId: lead.stageId },
      canDrag: canManage,
      collect: (m) => ({ isDragging: m.isDragging() }),
    }),
    [lead.leadId, lead.stageId, canManage]
  );
  const age = ageInfo(lead.updatedAt);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Checkbox visible if: card is selected, OR at least one other card
  // on the board is selected (we keep all checkboxes pinned so picking
  // a 2nd, 3rd, … card doesn't require hunting hover-only targets), OR
  // the card is being hovered.
  const showCheck = selected || anySelected || hover;

  return (
    <div
      ref={dragRef as unknown as React.Ref<HTMLDivElement>}
      className="lead-card-anim"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: selected ? "var(--accent-cyan-soft)" : "var(--bg-1)",
        border: selected
          ? "1px solid var(--accent-cyan)"
          : "1px solid var(--border-1)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 9,
        padding: "10px 11px",
        boxShadow: selected
          ? "0 4px 16px -6px color-mix(in srgb, var(--accent-cyan) 40%, transparent)"
          : hover
          ? "0 4px 14px -6px rgba(0,0,0,0.25)"
          : "0 1px 2px rgba(0,0,0,0.05)",
        opacity: isDragging ? 0.4 : 1,
        cursor: canManage ? "grab" : "pointer",
        transition: "box-shadow .15s, transform .15s, background .15s, border-color .15s",
        transform: hover ? "translateY(-1px)" : "none",
      }}
    >
      {/* Selection checkbox — bottom-left of card so it doesn't fight
          the hover quick-actions (top-right) for visual space. */}
      {showCheck && (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onToggleSelect();
          }}
          title={selected ? "Quitar de selección" : "Añadir a selección"}
          aria-pressed={selected}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 18,
            height: 18,
            borderRadius: 5,
            border: `1.5px solid ${selected ? "var(--accent-cyan)" : "var(--border-strong)"}`,
            background: selected ? "var(--accent-cyan)" : "var(--bg-1)",
            color: "white",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
            zIndex: 2,
          }}
        >
          {selected && <Icon.Check size={11} />}
        </button>
      )}
      <div className="row" style={{ gap: 8 }}>
        <span
          style={{
            flex: "0 0 auto", width: 26, height: 26, borderRadius: "50%",
            display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700,
            background: `${color}22`, color,
          }}
        >
          {initialsOf(lead.name || lead.phone)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lead.name || lead.phone}
          </div>
          <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lead.phone}{lead.company ? ` · ${lead.company}` : ""}
          </div>
          {lead.email && (
            <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
              {lead.email}
            </div>
          )}
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 9, gap: 6 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {/* Origen: Salesforce (sincronizado) vs Vox (nativo). SIEMPRE mostramos
              uno de los dos para diferenciar de un vistazo de dónde salió el lead. */}
          {lead.sfLeadId ? (
            <span
              className="sf-badge"
              title={`Sincronizado con Salesforce${lead.attributes?.sf_lead_status ? ` · Status: ${lead.attributes.sf_lead_status}` : ""}`}
            >
              <Icon.Cloud size={11} strokeWidth={2.4} />
              Salesforce
            </span>
          ) : (
            <span
              title="Lead nativo de ARIA (no vino de Salesforce)"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, height: 18,
                padding: "0 8px", borderRadius: 999, fontSize: 9.5, fontWeight: 700,
                background: "var(--accent-violet-soft)", color: "var(--accent-violet)",
                border: "1px solid color-mix(in srgb, var(--accent-violet) 30%, transparent)",
              }}
            >
              ARIA
            </span>
          )}
          {/* Sub-origen para leads de Vox (manual / campaña / web / whatsapp). */}
          {lead.source && lead.source !== "salesforce" ? (
            <span className="chip" style={{ height: 18, fontSize: 9.5 }}>
              {SOURCE_LABEL[lead.source] || lead.source}
            </span>
          ) : null}
          {lead.montoEstimado ? (
            <span className="chip chip--green" style={{ height: 18, fontSize: 9.5, fontWeight: 700 }}>
              {fmtMoney(lead.montoEstimado)}
            </span>
          ) : null}
        </div>
        {age.label && (
          <span
            style={{ fontSize: 10, fontWeight: 600, color: age.stale ? "var(--accent-red)" : "var(--text-3)" }}
            title={age.stale ? "Lead estancado (>7 días sin cambios)" : "Última actualización"}
          >
            {age.stale ? "⚠ " : ""}{age.label}
          </span>
        )}
      </div>

      {/* Hover quick-actions: call / WhatsApp / email.
          Call + WhatsApp go through Amazon Connect (placeCall +
          sendWhatsAppTemplate); email keeps the mailto: link since the
          agent's desktop email client is fine for one-off sends. */}
      {hover && (
        <div
          className="lead-actions"
          style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}
        >
          {lead.phone && (
            <button
              type="button"
              className="lead-action"
              onClick={(e) => {
                stop(e);
                onCall(lead.phone);
              }}
              title="Llamar (Amazon Connect)"
            >
              <Icon.Phone size={12} />
            </button>
          )}
          {lead.phone && (
            <button
              type="button"
              className="lead-action"
              onClick={(e) => {
                stop(e);
                onWhatsApp(lead.phone, lead.name);
              }}
              title="WhatsApp (Amazon Connect)"
            >
              <Icon.WhatsApp size={12} />
            </button>
          )}
          {lead.email && (
            <a className="lead-action" href={`mailto:${lead.email}`} onClick={stop} title="Email">
              <Icon.Mail size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Droppable stage column (with inline create + weighted/conversion) ── */
function StageColumn({
  stageId,
  label,
  color,
  items,
  totalValue,
  weightedValue,
  conversionPct,
  canManage,
  onDropLead,
  onOpenLead,
  onQuickCreate,
  onCall,
  onWhatsApp,
  selectedIds,
  onToggleLead,
}: {
  stageId: string;
  label: string;
  color: string;
  items: Lead[];
  totalValue: number;
  weightedValue: number;
  conversionPct: number | null;
  canManage: boolean;
  onDropLead: (leadId: string, stageId: string) => void;
  onOpenLead: (lead: Lead) => void;
  onQuickCreate: (stageId: string, name: string, phone: string) => Promise<void>;
  onCall: (phone: string) => void;
  onWhatsApp: (phone: string, name?: string) => void;
  /** Set of currently-selected leadIds (for bulk actions). */
  selectedIds: Set<string>;
  /** Toggle a single lead in the selection set. */
  onToggleLead: (leadId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [qa, setQa] = useState({ name: "", phone: "" });
  const [{ isOver }, dropRef] = useDrop(
    () => ({
      accept: DND_LEAD,
      canDrop: () => canManage,
      drop: (item: { leadId: string; stageId?: string }) => {
        if (item.stageId !== stageId) onDropLead(item.leadId, stageId);
      },
      collect: (m) => ({ isOver: m.isOver() && m.canDrop() }),
    }),
    [stageId, canManage, onDropLead]
  );

  const submitQuick = async () => {
    if (!qa.phone.trim()) { toast.error("El teléfono es obligatorio"); return; }
    await onQuickCreate(stageId, qa.name.trim(), qa.phone.trim());
    setQa({ name: "", phone: "" });
    setAdding(false);
  };

  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      style={{
        minWidth: 256, maxWidth: 288, flex: "0 0 auto",
        background: isOver ? `${color}10` : "var(--bg-2)",
        border: `1px solid ${isOver ? color : "var(--border-1)"}`,
        borderRadius: 12, overflow: "hidden",
        display: "flex", flexDirection: "column",
        transition: "background .15s, border-color .15s",
      }}
    >
      <div style={{ height: 3, background: color }} />
      <div style={{ padding: "10px 12px 9px", background: `linear-gradient(180deg, ${color}14, transparent)`, borderBottom: "1px solid var(--border-1)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
          <div className="row" style={{ gap: 6 }}>
            {conversionPct != null && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)" }} title="Conversión desde la etapa anterior (acotada a 100%)">
                {Math.min(conversionPct, 100)}%↓
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}1f`, borderRadius: 999, padding: "2px 8px" }}>
              {items.length}
            </span>
            {canManage && (
              <button
                onClick={() => setAdding((a) => !a)}
                title="Agregar lead aquí"
                style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", color, background: `${color}1f` }}
              >
                <Icon.Plus size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {totalValue > 0 ? fmtMoney(totalValue) : "Sin valor"}
          {weightedValue > 0 ? ` · pond. ${fmtMoney(weightedValue)}` : ""}
        </div>
      </div>

      {adding && (
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-1)", display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            autoFocus value={qa.name} onChange={(e) => setQa((s) => ({ ...s, name: e.target.value }))}
            placeholder="Nombre"
            style={{ padding: "6px 8px", fontSize: 12, border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-1)", color: "var(--text-1)" }}
          />
          <input
            value={qa.phone} onChange={(e) => setQa((s) => ({ ...s, phone: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && submitQuick()}
            placeholder="Teléfono *"
            style={{ padding: "6px 8px", fontSize: 12, border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-1)", color: "var(--text-1)" }}
          />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn--primary btn--sm" style={{ flex: 1 }} onClick={submitQuick}>Crear</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setAdding(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 60, padding: 8 }}>
        {items.map((l) => (
          <LeadCard
            key={l.leadId}
            lead={l}
            color={color}
            canManage={canManage}
            onOpen={() => onOpenLead(l)}
            onCall={onCall}
            onWhatsApp={onWhatsApp}
            selected={selectedIds.has(l.leadId)}
            anySelected={selectedIds.size > 0}
            onToggleSelect={() => onToggleLead(l.leadId)}
          />
        ))}
        {items.length === 0 && !adding && (
          <div className="muted" style={{ fontSize: 11, textAlign: "center", padding: "18px 0", border: "1px dashed var(--border-1)", borderRadius: 8 }}>
            {isOver ? "Soltar aquí" : "Sin leads"}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Salesforce 360 panel (dentro del detalle del lead) ──────────────
 * Trae EN VIVO desde SF: origen (IG/FB/Web…), estado, campos clave, link a
 * Salesforce y el historial de actividad (llamadas/correos/tareas). */
interface SfActivity {
  Id: string;
  Subject?: string;
  Description?: string;
  Status?: string;
  ActivityDate?: string;
  CreatedDate?: string;
  TaskSubtype?: string;
}
interface VoxHistoryEvent {
  ts: string;
  type: string;
  channel?: string;
  stageId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  valoracion?: string;
  summary?: string;
  notes?: string;
  agent?: string;
  sfTaskId?: string;
}
interface SfLeadData {
  found?: boolean;
  lead?: Record<string, unknown>;
  activities?: SfActivity[];
  voxHistory?: VoxHistoryEvent[];
  lightningUrl?: string;
}
interface TimelineItem {
  key: string;
  ts: string;
  icon: React.ReactNode;
  title: string;
  detail?: string;
  meta?: string;
  src: "vox" | "sf";
}

const ORIGIN_STYLES: { match: string[]; label: string; bg: string }[] = [
  { match: ["instagram", "ig "], label: "Instagram", bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)" },
  { match: ["facebook", "fb ", "meta"], label: "Facebook", bg: "#1877f2" },
  { match: ["whatsapp", "wa "], label: "WhatsApp", bg: "#25d366" },
  { match: ["google", "adwords", "sem"], label: "Google", bg: "#4285f4" },
  { match: ["tiktok"], label: "TikTok", bg: "#111" },
  { match: ["linkedin"], label: "LinkedIn", bg: "#0a66c2" },
  { match: ["web", "website", "pagina", "página", "landing", "formulario", "form"], label: "Web", bg: "#0a6bb5" },
  { match: ["referral", "referido", "recomend"], label: "Referido", bg: "#d98324" },
  { match: ["phone", "llamada", "inbound", "telefon"], label: "Teléfono", bg: "#0aa5b5" },
  { match: ["vox"], label: "ARIA", bg: "#7c5cff" },
];
function originBadge(src?: string): { label: string; bg: string } {
  const k = (src || "").toLowerCase();
  for (const o of ORIGIN_STYLES) if (o.match.some((m) => k.includes(m.trim()))) return { label: o.label, bg: o.bg };
  return { label: src || "Sin origen", bg: "var(--text-3)" };
}
function activityIcon(subtype?: string) {
  const s = (subtype || "").toLowerCase();
  if (s.includes("call")) return <Icon.Phone size={12} />;
  if (s.includes("email")) return <Icon.Mail size={12} />;
  return <Icon.Note size={12} />;
}
function channelIcon(channel?: string) {
  const c = (channel || "").toLowerCase();
  if (c.includes("llam") || c.includes("call") || c.includes("voice")) return <Icon.Phone size={12} />;
  if (c.includes("correo") || c.includes("email") || c.includes("mail")) return <Icon.Mail size={12} />;
  if (c.includes("whatsapp")) return <Icon.WhatsApp size={12} />;
  if (c.includes("chat")) return <Icon.Chat size={12} />;
  if (c.includes("salesforce")) return <Icon.Cloud size={12} />;
  return <Icon.Note size={12} />;
}
/** Une el historial de Vox (rico) con la actividad de SF (sin duplicar por sfTaskId), ordenado desc. */
function buildTimeline(voxHistory: VoxHistoryEvent[], activities: SfActivity[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  voxHistory.forEach((ev, i) => {
    if (ev.sfTaskId) seen.add(ev.sfTaskId);
    let icon: React.ReactNode;
    let title: string;
    if (ev.type === "gestion") {
      icon = channelIcon(ev.channel);
      title = `${ev.channel || "Gestión"}${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}${ev.subStageLabel ? ` › ${ev.subStageLabel}` : ""}`;
    } else if (ev.type === "stage_change") {
      icon = ev.channel === "Salesforce" ? <Icon.Cloud size={12} /> : <Icon.Tag size={12} />;
      title = ev.channel === "Salesforce"
        ? `Actualizado desde Salesforce${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}`
        : `Etapa → ${ev.stageLabel || ev.stageId || "?"}`;
    } else {
      icon = <Icon.Note size={12} />;
      title = ev.type === "update" ? "Datos actualizados" : ev.summary || "Evento";
    }
    const meta = [ev.valoracion, ev.agent].filter(Boolean).join(" · ");
    items.push({ key: `v${i}`, ts: ev.ts || "", icon, title, detail: ev.summary || ev.notes, meta: meta || undefined, src: "vox" });
  });
  activities.forEach((a) => {
    if (a.Id && seen.has(a.Id)) return; // ya representado por un evento de Vox
    items.push({
      key: `s${a.Id}`,
      ts: a.ActivityDate || a.CreatedDate || "",
      icon: activityIcon(a.TaskSubtype),
      title: a.Subject || "(sin asunto)",
      detail: a.Description,
      meta: a.Status || undefined,
      src: "sf",
    });
  });
  items.sort((x, y) => (y.ts || "").localeCompare(x.ts || ""));
  return items;
}

function SalesforcePanel({ lead }: { lead: Lead }) {
  const [data, setData] = useState<SfLeadData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none" | "err">(
    () => (getApiEndpoints()?.salesforceSync ? "loading" : "none")
  );

  useEffect(() => {
    const ep = getApiEndpoints();
    const syncUrl = ep?.salesforceSync;
    if (!syncUrl) return; // estado inicial ya es "none"
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await authedFetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "lead", sfLeadId: lead.sfLeadId, phone: lead.phone }),
          signal: ctrl.signal,
        });
        const j: SfLeadData = await r.json();
        setData(j);
        setState(j.found || (j.voxHistory && j.voxHistory.length > 0) ? "ok" : "none");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setState("err");
      }
    })();
    return () => ctrl.abort();
  }, [lead.sfLeadId, lead.phone]);

  const card: React.CSSProperties = {
    marginTop: 16, border: "1px solid var(--border-1)", borderRadius: 12,
    overflow: "hidden", background: "var(--bg-2)",
  };
  const head = (
    <div className="row" style={{ gap: 8, padding: "9px 12px", background: "linear-gradient(135deg,#00a1e0,#0a6bb5)", color: "#fff" }}>
      <Icon.Cloud size={14} strokeWidth={2.4} />
      <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>Historial de contacto</span>
      {state === "ok" && data?.found && data?.lightningUrl && data?.lead?.Id ? (
        <a href={`${data.lightningUrl}/lightning/r/Lead/${String(data.lead.Id)}/view`} target="_blank" rel="noreferrer"
           style={{ color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "underline", opacity: 0.95 }}>
          Abrir en Salesforce ↗
        </a>
      ) : null}
    </div>
  );

  if (state === "loading") return <div style={card}>{head}<div className="muted" style={{ padding: 12, fontSize: 12 }}>Cargando historial…</div></div>;
  if (state === "none") return <div style={card}>{head}<div className="muted" style={{ padding: 12, fontSize: 12 }}>Sin actividad ni datos de Salesforce todavía.</div></div>;
  if (state === "err" || !data) return <div style={card}>{head}<div className="muted" style={{ padding: 12, fontSize: 12 }}>No se pudo cargar el historial.</div></div>;

  const L = data.lead || {};
  const origin = data.found ? originBadge(L.LeadSource ? String(L.LeadSource) : undefined) : null;
  const fields: [string, string][] = [];
  if (data.found) {
    if (L.Status) fields.push(["Estado", String(L.Status)]);
    if (L.Title) fields.push(["Cargo", String(L.Title)]);
    if (L.Industry) fields.push(["Industria", String(L.Industry)]);
    if (L.Rating) fields.push(["Rating", String(L.Rating)]);
    if (L.Website) fields.push(["Web", String(L.Website)]);
  }
  const timeline = buildTimeline(data.voxHistory || [], data.activities || []);

  return (
    <div style={card}>
      {head}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {origin && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600, alignSelf: "center" }}>Origen:</span>
            <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: origin.bg, color: "#fff" }}>
              {origin.label}
            </span>
          </div>
        )}
        {fields.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {fields.map(([k, v]) => (
              <div key={k} className="row" style={{ gap: 10, alignItems: "baseline" }}>
                <span style={{ color: "var(--text-3)", fontWeight: 600, minWidth: 64, flex: "0 0 auto" }}>{k}</span>
                <span style={{ color: "var(--text-1)", wordBreak: "break-word" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {/* Timeline unificado: gestiones por canal + cambios + actividad de SF */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>
            Línea de tiempo {timeline.length > 0 ? `(${timeline.length})` : ""}
          </div>
          {timeline.length === 0 ? (
            <div className="muted" style={{ fontSize: 11.5 }}>Sin eventos registrados.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {timeline.map((it) => (
                <div key={it.key} className="row" style={{ gap: 8, alignItems: "flex-start", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 8 }}>
                  <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: it.src === "sf" ? "rgba(0,161,224,0.14)" : "var(--accent-violet-soft)", color: it.src === "sf" ? "#00a1e0" : "var(--accent-violet)", marginTop: 1 }}>
                    {it.icon}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{it.title}</div>
                    {it.detail ? <div className="muted" style={{ fontSize: 11, whiteSpace: "pre-wrap", marginTop: 2 }}>{it.detail}</div> : null}
                    <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                      {[it.meta, (it.ts || "").slice(0, 10)].filter(Boolean).join(" · ")}{it.src === "sf" ? " · SF" : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Lead detail — centered modal (overlay) ────────────────────────── */
function LeadDetailModal({
  lead,
  canManage,
  stages,
  onClose,
  onSaved,
  onDeleted,
  onMove,
  onCall,
  onWhatsApp,
}: {
  lead: Lead;
  canManage: boolean;
  stages: { id: string; label: string }[];
  onClose: () => void;
  onSaved: (l: Lead) => void;
  onDeleted: (id: string) => void;
  onMove: (leadId: string, stageId: string) => void | Promise<void>;
  onCall: (phone: string) => void;
  onWhatsApp: (phone: string, name?: string) => void;
}) {
  const [f, setF] = useState({
    name: lead.name || "", phone: lead.phone || "", email: lead.email || "",
    company: lead.company || "", monto: lead.montoEstimado ? String(lead.montoEstimado) : "",
  });
  const [saving, setSaving] = useState(false);
  const [stageId, setStageId] = useState(lead.stageId || stages[0]?.id || "");
  const [sfPushing, setSfPushing] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const changeStage = async (next: string) => {
    if (!next || next === stageId) return;
    setStageId(next);
    await onMove(lead.leadId, next);
  };

  const save = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    setSaving(true);
    try {
      const r = await authedFetch(ep.manageLeads, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.leadId, phone: f.phone.trim(),
          name: f.name.trim() || undefined, email: f.email.trim() || undefined,
          company: f.company.trim() || undefined,
          montoEstimado: f.monto.trim() ? Number(f.monto) || undefined : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error);
      toast.success("Lead actualizado");
      onSaved({ ...lead, name: f.name, phone: f.phone, email: f.email, company: f.company, montoEstimado: f.monto ? Number(f.monto) : undefined, updatedAt: new Date().toISOString() });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    if (!(await confirm({ title: `¿Eliminar el lead "${lead.name || lead.phone}"?`, destructive: true, confirmLabel: "Eliminar" }))) return;
    try {
      await authedFetch(`${ep.manageLeads}?leadId=${encodeURIComponent(lead.leadId)}`, { method: "DELETE" });
      toast.success("Lead eliminado");
      onDeleted(lead.leadId);
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  // Enviar este lead a Salesforce a demanda — red de seguridad por si el sync
  // automático no ocurrió (ej. lead de campaña sin contactar). Muestra el
  // resultado real (creado/actualizado, o el error de SF).
  const pushToSf = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    setSfPushing(true);
    try {
      const r = await authedFetch(ep.manageLeads, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pushSf", leadId: lead.leadId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "No se pudo enviar");
      if (d.pushed) {
        toast.success(
          d.action === "created" ? "Lead creado en Salesforce" : "Lead actualizado en Salesforce"
        );
      } else {
        toast.error(d.error || "No se pudo enviar a Salesforce");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar a Salesforce");
    } finally {
      setSfPushing(false);
    }
  };

  const field = (key: keyof typeof f, label: string, type = "text") => (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{label}</span>
      <input
        type={type} value={f[key]} disabled={!canManage}
        onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
        style={{ width: "100%", marginTop: 4, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-2)", color: "var(--text-1)" }}
      />
    </label>
  );

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", padding: 20, backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto",
          background: "var(--bg-1)", border: "1px solid var(--border-2)",
          borderRadius: 16, boxShadow: "var(--shadow-pop)", padding: 22,
        }}
      >
        {/* Hero: avatar + name + quick actions */}
        <div className="row" style={{ gap: 12, marginBottom: 18 }}>
          <span style={{ flex: "0 0 auto", width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 15, fontWeight: 700, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}>
            {initialsOf(lead.name || lead.phone)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{lead.name || lead.phone}</div>
            <div className="muted" style={{ fontSize: 12 }}>{lead.company || "Sin empresa"}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}><Icon.Close size={15} /></button>
        </div>

        {/* Quick actions row — voice + WhatsApp go through Amazon
            Connect so the call lands on the agent's softphone and the
            WhatsApp send is audited via send-whatsapp-template. Email
            keeps mailto: (no Connect-managed email outbound in this
            flow yet). */}
        <div className="row" style={{ gap: 8, marginBottom: 18 }}>
          {lead.phone && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onCall(lead.phone)}
            >
              <Icon.Phone size={13} /> Llamar
            </button>
          )}
          {lead.phone && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onWhatsApp(lead.phone, lead.name)}
            >
              <Icon.WhatsApp size={13} /> WhatsApp
            </button>
          )}
          {lead.email && (
            <a className="btn btn--sm" href={`mailto:${lead.email}`}>
              <Icon.Mail size={13} /> Email
            </a>
          )}
        </div>

        {/* Etapa del embudo — editable sin arrastrar la tarjeta (clave en la
            vista Tabla, donde no hay drag & drop). */}
        {stages.length > 0 && (
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
              Etapa
            </span>
            <select
              value={stageId}
              disabled={!canManage}
              onChange={(e) => changeStage(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-2)", color: "var(--text-1)" }}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          {field("name", "Nombre")}
          {field("phone", "Teléfono")}
          {field("email", "Email", "email")}
          {field("company", "Empresa")}
          <div style={{ gridColumn: "1 / -1" }}>{field("monto", "Valor estimado (S/)", "number")}</div>
        </div>

        {/* Enviar a Salesforce a demanda — red de seguridad por si el sync
            automático no ocurrió (ej. lead de campaña sin contactar). Crea/
            actualiza el Lead en SF y registra la actividad. */}
        {canManage && (
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
            <button
              className="btn btn--sm"
              onClick={pushToSf}
              disabled={sfPushing}
              title="Crear o actualizar este lead en Salesforce y registrar la actividad"
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00A1E0", display: "inline-block", marginRight: 6 }} />
              {sfPushing ? "Enviando…" : "Enviar a Salesforce"}
            </button>
          </div>
        )}

        {/* Historial de contacto: timeline Vox + Salesforce, traído en vivo. */}
        <SalesforcePanel lead={lead} />

        {canManage && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <button className="btn btn--danger" onClick={del} title="Eliminar lead"><Icon.Trash size={14} /></button>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

export function LeadsPage() {
  const navigate = useNavigate();
  const { tree } = useTaxonomy();
  const canManage = useCan("manage_leads");
  const { placeCall, agentState } = useCCP();
  const { config } = useConnections();
  // ¿El tenant integró una FUENTE de leads? Sus leads viven en su base de datos
  // (BYO Data Plane) y/o se importan de Salesforce. Sin ninguna de las dos,
  // mostramos el estado "todavía no integraste tu base de datos" en vez del
  // empty normal "no hay leads".
  const hasLeadSource = !!config?.connect?.dataPlaneEnabled || !!config?.salesforce?.connected;
  // WhatsApp quick-send modal — opened from any lead card or detail.
  const [waTarget, setWaTarget] = useState<{ phone: string; name?: string } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  /** Place an outbound call via the agent's softphone. Surfaces the
   *  most common failure modes (offline, missing permission, invalid
   *  number) as toasts so the lead board doesn't fail silently. */
  const dialLead = async (phone: string) => {
    const trimmed = (phone || "").trim();
    if (!trimmed) {
      toast.error("Lead sin teléfono");
      return;
    }
    if (agentState === "Offline" || agentState === "Init") {
      toast.error("Conecta tu softphone para llamar (cambia a Available)");
      return;
    }
    try {
      await placeCall(trimmed);
      toast.success(`Llamando a ${trimmed}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo iniciar la llamada");
    }
  };

  const openWhatsApp = (phone: string, name?: string) => {
    if (!phone?.trim()) {
      toast.error("Lead sin teléfono");
      return;
    }
    setWaTarget({ phone: phone.trim(), name });
  };
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [view, setView] = useState<"board" | "table">("board");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [valueFilter, setValueFilter] = useState<"all" | "with" | "without">("all");
  const [staleOnly, setStaleOnly] = useState(false);
  /** Salesforce sync state filter — useful to triage SF-imported leads
   *  vs locally-created ones. */
  const [syncedFilter, setSyncedFilter] = useState<"all" | "sf" | "local">("all");
  /** Created-at period filter. "custom" → the user types ISO dates in
   *  the popover; the rest are sliding windows from "now". */
  const [periodFilter, setPeriodFilter] = useState<
    "all" | "today" | "7d" | "30d" | "90d"
  >("all");
  const [sort, setSort] = useState<{ key: "created" | "updated" | "value" | "name"; dir: "asc" | "desc" }>({
    key: "created",
    dir: "desc",
  });
  const [selected, setSelected] = useState<Lead | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", monto: "" });

  // ── Multi-selección de la tabla (click · shift-rango · arrastrar para pintar) ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState(false);
  const dragSelectRef = useRef<{ value: boolean } | null>(null); // null ⇒ no se está arrastrando
  const lastIndexRef = useRef<number | null>(null); // ancla para shift+click
  const didDragRef = useRef(false); // hubo arrastre ⇒ no abrir el detalle en el click final

  // Soltar el mouse en cualquier lado termina el arrastre.
  useEffect(() => {
    const up = () => {
      dragSelectRef.current = null;
      setDragging(false);
      // El click que cierra el arrastre llega justo después; reseteamos el flag en
      // el siguiente tick para suprimir ese click pero no el próximo legítimo.
      if (didDragRef.current) setTimeout(() => { didDragRef.current = false; }, 0);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const load = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await authedFetch(ep.manageLeads);
      const d = await r.json();
      setLeads(Array.isArray(d.leads) ? d.leads : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const firstStage = tree[0]?.id;

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.source) set.add(l.source);
    return [...set];
  }, [leads]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.assignedAgent) set.add(l.assignedAgent);
    return [...set].sort();
  }, [leads]);

  /** Apply ALL the active filters to a lead. Single source of truth so
   *  the board and table views never disagree on what's visible. */
  const passesFilters = useCallback((l: Lead, needle: string): boolean => {
    if (needle && !`${l.name || ""} ${l.phone || ""} ${l.company || ""} ${l.email || ""}`.toLowerCase().includes(needle)) return false;
    if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
    if (agentFilter !== "all" && (l.assignedAgent || "") !== agentFilter) return false;
    const hasValue = !!(l.montoEstimado && l.montoEstimado > 0);
    if (valueFilter === "with" && !hasValue) return false;
    if (valueFilter === "without" && hasValue) return false;
    if (staleOnly && !ageInfo(l.updatedAt).stale) return false;
    if (syncedFilter === "sf" && !l.sfLeadId) return false;
    if (syncedFilter === "local" && l.sfLeadId) return false;
    if (periodFilter !== "all") {
      const created = l.createdAt ? new Date(l.createdAt).getTime() : 0;
      if (!created) return false;
      const windowMs = (
        { today: 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90 } as const
      )[periodFilter] * 60 * 60 * 1000;
      if (Date.now() - created > windowMs) return false;
    }
    return true;
  }, [sourceFilter, agentFilter, valueFilter, staleOnly, syncedFilter, periodFilter]);

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const s of tree) map.set(s.id, []);
    const needle = q.trim().toLowerCase();
    for (const l of leads) {
      if (!passesFilters(l, needle)) continue;
      const sid = l.stageId && map.has(l.stageId) ? l.stageId : firstStage;
      if (sid) map.get(sid)!.push(l);
    }
    // Sort each column: highest deal value first, then most-recently updated.
    for (const list of map.values()) {
      list.sort((a, b) => {
        const va = a.montoEstimado || 0, vb = b.montoEstimado || 0;
        if (vb !== va) return vb - va;
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      });
    }
    return map;
  }, [leads, tree, firstStage, q, passesFilters]);

  // Etapa → label + color (for the table view chips).
  const stageMeta = (stageId?: string): { label: string; color: string } => {
    const st = tree.find((s) => s.id === stageId) || tree.find((s) => s.id === firstStage);
    if (!st) return { label: "—", color: "var(--text-3)" };
    const tone = VALORACION_META[st.valoracion];
    return { label: st.label, color: TONE_COLOR[tone.chip] || "var(--accent-cyan)" };
  };

  // Flat, filtered, sorted list for the raw-data table view (newest first).
  const tableLeads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = leads.filter((l) => {
      if (!passesFilters(l, needle)) return false;
      // Stage filter only applies to the table — the board IS the stage view.
      if (stageFilter !== "all" && (l.stageId || firstStage) !== stageFilter) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "value") return ((a.montoEstimado || 0) - (b.montoEstimado || 0)) * dir;
      if (sort.key === "name") return (a.name || a.phone || "").localeCompare(b.name || b.phone || "") * dir;
      const ka = sort.key === "updated" ? a.updatedAt || "" : a.createdAt || a.updatedAt || "";
      const kb = sort.key === "updated" ? b.updatedAt || "" : b.createdAt || b.updatedAt || "";
      return ka.localeCompare(kb) * dir;
    });
    return list;
  }, [leads, q, stageFilter, sort, firstStage, passesFilters]);

  const { shownCount, totalValue, weightedTotal } = useMemo(() => {
    let count = 0, value = 0, weighted = 0;
    tree.forEach((s, i) => {
      const list = byStage.get(s.id) || [];
      const prob = stageProbability(s.valoracion, i, tree.length);
      count += list.length;
      for (const l of list) { value += l.montoEstimado || 0; weighted += (l.montoEstimado || 0) * prob; }
    });
    return { shownCount: count, totalValue: value, weightedTotal: weighted };
  }, [byStage, tree]);

  const move = async (leadId: string, stageId: string) => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    setLeads((cur) => cur.map((l) => (l.leadId === leadId ? { ...l, stageId, updatedAt: new Date().toISOString() } : l)));
    try {
      await authedFetch(ep.manageLeads, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", leadId, stageId }),
      });
    } catch {
      toast.error("No se pudo mover el lead");
      load();
    }
  };

  // Create a lead directly in a given stage (inline "+ lead" per column).
  const quickCreate = async (stageId: string, name: string, phone: string) => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    try {
      const r = await authedFetch(ep.manageLeads, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name || undefined, stageId, source: "manual" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error);
      toast.success(d.isNew ? "Lead creado" : "Lead actualizado (ya existía ese teléfono)");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear");
    }
  };

  const createLead = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    if (!form.phone.trim()) { toast.error("El teléfono es obligatorio"); return; }
    try {
      const r = await authedFetch(ep.manageLeads, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: form.phone.trim(), name: form.name.trim() || undefined,
          email: form.email.trim() || undefined, company: form.company.trim() || undefined,
          montoEstimado: form.monto.trim() ? Number(form.monto) || undefined : undefined,
          stageId: firstStage, source: "manual",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error);
      toast.success(d.isNew ? "Lead creado" : "Lead actualizado (ya existía ese teléfono)");
      setForm({ name: "", phone: "", email: "", company: "", monto: "" });
      setAdding(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear");
    }
  };

  // ── Selección múltiple (vista tabla) ────────────────────────────────
  const setRowSelected = (id: string, value: boolean) =>
    setSelectedIds((prev) => {
      if (value === prev.has(id)) return prev;
      const n = new Set(prev);
      if (value) n.add(id); else n.delete(id);
      return n;
    });
  const clearSelection = () => setSelectedIds(new Set());
  const allFilteredSelected = tableLeads.length > 0 && tableLeads.every((l) => selectedIds.has(l.leadId));
  const someFilteredSelected = tableLeads.some((l) => selectedIds.has(l.leadId));
  const toggleSelectAll = () =>
    setSelectedIds(allFilteredSelected ? new Set() : new Set(tableLeads.map((l) => l.leadId)));

  // Toda la lógica vive en mousedown (toggle · shift=rango · inicio de arrastre).
  // El click sólo frena la propagación para no abrir el detalle del lead.
  const onCheckboxMouseDown = (e: React.MouseEvent, index: number) => {
    e.preventDefault(); e.stopPropagation();
    if (e.button !== 0) return; // sólo botón izquierdo
    didDragRef.current = false;
    const id = tableLeads[index].leadId;
    if (e.shiftKey && lastIndexRef.current != null) {
      // Shift: selecciona el rango contiguo desde el ancla (siempre marca = true).
      const lo = Math.min(lastIndexRef.current, index);
      const hi = Math.max(lastIndexRef.current, index);
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (let i = lo; i <= hi; i++) n.add(tableLeads[i].leadId);
        return n;
      });
      lastIndexRef.current = index;
      return;
    }
    // Click/arrastre normal: togglea esta fila y arranca el "pintado".
    const value = !selectedIds.has(id);
    dragSelectRef.current = { value };
    setDragging(true);
    setRowSelected(id, value);
    lastIndexRef.current = index;
  };
  const onCheckboxClick = (e: React.MouseEvent) => { e.stopPropagation(); };
  const onRowMouseEnter = (index: number) => {
    const drag = dragSelectRef.current;
    if (!drag) return;
    didDragRef.current = true;
    setRowSelected(tableLeads[index].leadId, drag.value);
  };
  const onRowClick = (l: Lead) => {
    if (didDragRef.current) { didDragRef.current = false; return; } // fue arrastre, no abrir
    setSelected(l);
  };

  const launchCampaign = () => {
    const chosen = leads.filter((l) => selectedIds.has(l.leadId) && l.phone);
    if (chosen.length === 0) { toast.error("Selecciona al menos un lead con teléfono"); return; }
    navigate("/campaigns/nueva", {
      state: {
        presetLeads: chosen.map((l) => ({
          leadId: l.leadId, phone: l.phone, name: l.name, email: l.email, company: l.company,
          stageId: l.stageId, source: l.source, montoEstimado: l.montoEstimado,
          createdAt: l.createdAt, updatedAt: l.updatedAt,
        })),
      },
    });
  };

  return (
    <div className="view" style={{ maxWidth: 1600 }}>
      <PageHeader
        crumb="Crecimiento"
        title="Embudo de leads"
        filterPill={sourceFilter === "all" ? "Todos" : SOURCE_LABEL[sourceFilter] || sourceFilter}
        count={`${shownCount} leads${totalValue > 0 ? ` · ${fmtMoney(totalValue)}` : ""}`}
        sub={weightedTotal > 0 ? `Pipeline ponderado ${fmtMoney(weightedTotal)} · arrastra las tarjetas entre etapas` : "Arrastra las tarjetas entre etapas · columnas = tu taxonomía"}
        search={{ value: q, onChange: setQ, placeholder: "Buscar lead…" }}
        actions={
          <>
            <div className="row" style={{ gap: 0, border: "1px solid var(--border-2)", borderRadius: 6, overflow: "hidden" }}>
              <button
                onClick={() => setView("board")}
                title="Vista de tablero"
                style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, background: view === "board" ? "var(--bg-3)" : "transparent", color: view === "board" ? "var(--text-1)" : "var(--text-3)" }}
              >
                Tablero
              </button>
              <button
                onClick={() => setView("table")}
                title="Vista de tabla (data cruda)"
                style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, background: view === "table" ? "var(--bg-3)" : "transparent", color: view === "table" ? "var(--text-1)" : "var(--text-3)" }}
              >
                Tabla
              </button>
            </div>
            <button className="btn" onClick={load} disabled={loading}>
              <Icon.Refresh size={14} /> Actualizar
            </button>
            {canManage && (
              <button className="btn btn--primary" onClick={() => setAdding((a) => !a)}>
                <Icon.Plus size={14} /> Nuevo lead
              </button>
            )}
          </>
        }
      />

      {/* Chip-style filter bar */}
      <LeadFilterBar
        view={view}
        // current values
        sourceFilter={sourceFilter}
        stageFilter={stageFilter}
        agentFilter={agentFilter}
        valueFilter={valueFilter}
        periodFilter={periodFilter}
        syncedFilter={syncedFilter}
        staleOnly={staleOnly}
        // setters
        setSourceFilter={setSourceFilter}
        setStageFilter={setStageFilter}
        setAgentFilter={setAgentFilter}
        setValueFilter={setValueFilter}
        setPeriodFilter={setPeriodFilter}
        setSyncedFilter={setSyncedFilter}
        setStaleOnly={setStaleOnly}
        // option lists
        sources={sources}
        stages={tree}
        agents={agents}
        // counts (for popover items + visible totals)
        leads={leads}
      />

      {adding && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {(["name", "phone", "email", "company"] as const).map((fld) => (
              <input
                key={fld} value={form[fld]}
                onChange={(e) => setForm((s) => ({ ...s, [fld]: e.target.value }))}
                placeholder={{ name: "Nombre", phone: "Teléfono *", email: "Email", company: "Empresa" }[fld]}
                style={{ flex: 1, minWidth: 150, padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-1)", color: "var(--text-1)", fontSize: 13 }}
              />
            ))}
            <input
              type="number" min="0" value={form.monto}
              onChange={(e) => setForm((s) => ({ ...s, monto: e.target.value }))}
              placeholder="Valor S/"
              style={{ flex: 1, minWidth: 110, padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-1)", color: "var(--text-1)", fontSize: 13 }}
            />
            <button className="btn btn--primary" onClick={createLead}>Crear</button>
          </div>
        </div>
      )}

      {/* ── Barra de selección múltiple (acciones masivas).
           Antes solo aparecía en vista tabla — ahora también en board,
           porque el board permite marcar leads desde el menú "Lanzar
           campaña con N" cuando el agente arrastra tarjetas. La barra
           es contextual: se muestra siempre que haya leads marcados. ── */}
      {selectedIds.size > 0 && (
        <div
          style={{
            position: "sticky", top: 8, zIndex: 20, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 14px", borderRadius: 12,
            border: "1px solid var(--accent-cyan)",
            background: "linear-gradient(135deg, var(--accent-cyan-soft), var(--bg-2))",
            boxShadow: "0 6px 20px -10px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "var(--accent-cyan)", color: "#0B0F1A", fontWeight: 800, fontSize: 12 }}>
            {selectedIds.size}
          </span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"} seleccionado{selectedIds.size === 1 ? "" : "s"}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              Lanza una campaña de voz o WhatsApp con esta audiencia, o ajusta la selección.
            </div>
          </div>
          <button className="btn btn--sm" onClick={clearSelection}>
            <Icon.Close size={13} /> Limpiar
          </button>
          {!allFilteredSelected && (
            <button className="btn btn--sm" onClick={toggleSelectAll} title="Seleccionar todos los leads filtrados">
              <Icon.Check size={13} /> Todos ({tableLeads.length})
            </button>
          )}
          {canManage && (
            <button className="btn btn--primary btn--sm" onClick={launchCampaign}>
              <Icon.Megaphone size={14} /> Lanzar campaña con {selectedIds.size}
            </button>
          )}
        </div>
      )}

      {!loading && leads.length === 0 && !hasLeadSource ? (
        <NotIntegrated
          title="Todavía no integraste tu base de datos de leads"
          message="Tus leads viven en TU cuenta: se importan de Salesforce y/o se guardan en tu base de datos (BYO Data Plane). Conectá la fuente en Integraciones para traerlos y sincronizarlos."
          ctaLabel="Conectar leads"
          secondary={
            canManage ? (
              <button className="btn" onClick={() => setAdding(true)}>
                <Icon.Plus size={14} /> Crear lead manual
              </button>
            ) : undefined
          }
        />
      ) : !loading && leads.length === 0 ? (
        <div
          className="card"
          style={{ padding: "56px 24px", textAlign: "center", color: "var(--text-3)" }}
        >
          <div style={{ width: 48, height: 48, margin: "0 auto 14px", borderRadius: 14, display: "grid", placeItems: "center", background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}>
            <Icon.Users size={24} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>Aún no tienes leads</div>
          <div style={{ fontSize: 13, marginTop: 4, marginBottom: 16 }}>
            Crea tu primer lead o espera a que lleguen desde formularios web, campañas o llamadas.
          </div>
          {canManage && (
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              <Icon.Plus size={14} /> Crear primer lead
            </button>
          )}
        </div>
      ) : view === "board" ? (
      <DndProvider backend={HTML5Backend}>
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12, alignItems: "flex-start" }}>
          {loading && leads.length === 0
            ? Array.from({ length: 5 }).map((_, ci) => (
                <div key={ci} style={{ minWidth: 256, maxWidth: 288, flex: "0 0 auto", background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ height: 3, background: "var(--border-2)" }} />
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-1)" }}>
                    <div className="lead-skel" style={{ width: "60%", height: 12 }} />
                    <div className="lead-skel" style={{ width: "40%", height: 9, marginTop: 6 }} />
                  </div>
                  <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
                    {Array.from({ length: ci % 3 === 0 ? 2 : 1 }).map((__, k) => (
                      <div key={k} className="lead-skel" style={{ height: 64, borderRadius: 9 }} />
                    ))}
                  </div>
                </div>
              ))
            : tree.map((stage, i) => {
            const items = byStage.get(stage.id) || [];
            const tone = VALORACION_META[stage.valoracion];
            const color = TONE_COLOR[tone.chip] || "var(--accent-cyan)";
            const colValue = items.reduce((a, l) => a + (l.montoEstimado || 0), 0);
            const prob = stageProbability(stage.valoracion, i, tree.length);
            const weighted = colValue * prob;
            // Conversion vs previous stage (by lead count).
            const prevCount = i > 0 ? (byStage.get(tree[i - 1].id) || []).length : null;
            const conv = prevCount && prevCount > 0 ? Math.round((items.length / prevCount) * 100) : null;
            return (
              <StageColumn
                key={stage.id}
                stageId={stage.id}
                label={stage.label}
                color={color}
                items={items}
                totalValue={colValue}
                weightedValue={weighted}
                conversionPct={conv}
                canManage={canManage}
                onDropLead={move}
                onOpenLead={setSelected}
                onQuickCreate={quickCreate}
                onCall={dialLead}
                onWhatsApp={openWhatsApp}
                selectedIds={selectedIds}
                onToggleLead={(leadId) => {
                  setSelectedIds((cur) => {
                    const next = new Set(cur);
                    if (next.has(leadId)) next.delete(leadId);
                    else next.add(leadId);
                    return next;
                  });
                }}
              />
            );
          })}
        </div>
      </DndProvider>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border-1)" }}>
                  <th style={{ padding: "10px 8px 10px 12px", width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos"
                      style={{ cursor: "pointer", accentColor: "var(--accent-cyan)" }}
                      checked={allFilteredSelected}
                      ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  {([
                    ["Contacto", "name", "left"],
                    ["Empresa", null, "left"],
                    ["Etapa", null, "left"],
                    ["Fuente", null, "left"],
                    ["Valor", "value", "right"],
                    ["Actualizado", "updated", "right"],
                    ["Creado", "created", "right"],
                  ] as const).map(([label, key, align]) => (
                    <th
                      key={label}
                      onClick={key ? () => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" })) : undefined}
                      style={{
                        padding: "10px 12px", textAlign: align,
                        fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5,
                        color: "var(--text-3)", fontWeight: 700, whiteSpace: "nowrap",
                        cursor: key ? "pointer" : "default", userSelect: "none",
                      }}
                    >
                      {label}{key && sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableLeads.map((l, index) => {
                  const sm = stageMeta(l.stageId);
                  const created = ageInfo(l.createdAt || l.updatedAt);
                  const checked = selectedIds.has(l.leadId);
                  return (
                    <tr
                      key={l.leadId}
                      className="lead-trow"
                      onClick={() => onRowClick(l)}
                      onMouseEnter={() => onRowMouseEnter(index)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border-1)",
                        background: checked ? "var(--accent-cyan-soft)" : undefined,
                        userSelect: dragging ? "none" : undefined,
                      }}
                    >
                      <td
                        style={{ padding: "9px 8px 9px 12px", width: 34 }}
                        onMouseDown={(e) => onCheckboxMouseDown(e, index)}
                        onClick={onCheckboxClick}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          tabIndex={-1}
                          style={{ cursor: "pointer", accentColor: "var(--accent-cyan)", pointerEvents: "none" }}
                        />
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <div className="row" style={{ gap: 9 }}>
                          <span style={{ flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700, background: `${sm.color}22`, color: sm.color }}>
                            {initialsOf(l.name || l.phone)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{l.name || "—"}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{l.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "9px 12px", color: "var(--text-2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company || "—"}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sm.color, background: `${sm.color}1f`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{sm.label}</span>
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {l.source ? <span className="chip" style={{ height: 18, fontSize: 10 }}>{SOURCE_LABEL[l.source] || l.source}</span> : <span className="muted">—</span>}
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.montoEstimado)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "var(--text-3)", whiteSpace: "nowrap" }}>{ageInfo(l.updatedAt).label || "—"}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: created.stale ? "var(--accent-red)" : "var(--text-3)", whiteSpace: "nowrap" }}>{created.label || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {tableLeads.length === 0 ? (
            <div className="muted" style={{ padding: "44px 0", textAlign: "center", fontSize: 13 }}>
              Ningún lead coincide con los filtros.
            </div>
          ) : (
            <div className="muted" style={{ padding: "8px 12px", fontSize: 11, borderTop: "1px solid var(--border-1)", background: "var(--bg-2)" }}>
              {tableLeads.length} leads · orden: {sort.key === "created" ? "creación" : sort.key === "updated" ? "actualización" : sort.key === "value" ? "valor" : "nombre"} {sort.dir === "desc" ? "↓" : "↑"}
            </div>
          )}
        </div>
      )}

      {selected && (
        <LeadDetailModal
          lead={selected}
          canManage={canManage}
          stages={tree}
          onClose={() => setSelected(null)}
          onSaved={(l) => { setLeads((cur) => cur.map((x) => (x.leadId === l.leadId ? l : x))); setSelected(null); }}
          onDeleted={(id) => { setLeads((cur) => cur.filter((x) => x.leadId !== id)); setSelected(null); }}
          onMove={move}
          onCall={dialLead}
          onWhatsApp={openWhatsApp}
        />
      )}

      {/* WhatsApp quick-send modal — opened from any lead card or detail */}
      {waTarget && (
        <WhatsAppQuickSendModal
          open={true}
          phone={waTarget.phone}
          customerName={waTarget.name}
          onClose={() => setWaTarget(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   LEAD FILTER BAR — chip-style filter controls with popovers.
   Each chip shows its current value + a count of matching leads.
   Click to open a list of options; click "Limpiar" to reset all.
   ──────────────────────────────────────────────────────────── */

interface LeadFilterBarProps {
  view: "board" | "table";
  // current values
  sourceFilter: string;
  stageFilter: string;
  agentFilter: string;
  valueFilter: "all" | "with" | "without";
  periodFilter: "all" | "today" | "7d" | "30d" | "90d";
  syncedFilter: "all" | "sf" | "local";
  staleOnly: boolean;
  // setters
  setSourceFilter: (v: string) => void;
  setStageFilter: (v: string) => void;
  setAgentFilter: (v: string) => void;
  setValueFilter: (v: "all" | "with" | "without") => void;
  setPeriodFilter: (v: "all" | "today" | "7d" | "30d" | "90d") => void;
  setSyncedFilter: (v: "all" | "sf" | "local") => void;
  setStaleOnly: (v: boolean) => void;
  // options
  sources: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stages: any[];
  agents: string[];
  leads: Lead[];
}

const PERIOD_LABEL: Record<LeadFilterBarProps["periodFilter"], string> = {
  all: "Cualquier fecha",
  today: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
};
const VALUE_LABEL: Record<LeadFilterBarProps["valueFilter"], string> = {
  all: "Cualquier valor",
  with: "Con valor",
  without: "Sin valor",
};
const SYNCED_LABEL: Record<LeadFilterBarProps["syncedFilter"], string> = {
  all: "Sincronizado / no",
  sf: "Sincronizado SF",
  local: "Sólo local",
};

function LeadFilterBar(props: LeadFilterBarProps) {
  const {
    view, sourceFilter, stageFilter, agentFilter, valueFilter, periodFilter,
    syncedFilter, staleOnly, setSourceFilter, setStageFilter, setAgentFilter,
    setValueFilter, setPeriodFilter, setSyncedFilter, setStaleOnly,
    sources, stages, agents, leads,
  } = props;

  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Outside click closes the open popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Per-option counts so the agent can see how many leads each filter
  // would surface BEFORE clicking it. Cheap — O(n) over leads.
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.source || "—", (m.get(l.source || "—") || 0) + 1);
    return m;
  }, [leads]);
  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.stageId || "", (m.get(l.stageId || "") || 0) + 1);
    return m;
  }, [leads]);
  const agentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.assignedAgent || "", (m.get(l.assignedAgent || "") || 0) + 1);
    return m;
  }, [leads]);

  const periodCount = (k: LeadFilterBarProps["periodFilter"]) => {
    if (k === "all") return leads.length;
    const ms = ({ today: 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90 } as const)[k] * 3600 * 1000;
    return leads.filter((l) => l.createdAt && Date.now() - new Date(l.createdAt).getTime() <= ms).length;
  };

  // Track whether any filter is active so we know to show "Limpiar".
  const anyActive =
    sourceFilter !== "all" ||
    stageFilter !== "all" ||
    agentFilter !== "all" ||
    valueFilter !== "all" ||
    periodFilter !== "all" ||
    syncedFilter !== "all" ||
    staleOnly;
  const clearAll = () => {
    setSourceFilter("all");
    setStageFilter("all");
    setAgentFilter("all");
    setValueFilter("all");
    setPeriodFilter("all");
    setSyncedFilter("all");
    setStaleOnly(false);
    setOpen(null);
  };

  const chipColor = (_active: boolean, c: string) =>
    ({ ["--lc" as string]: c } as React.CSSProperties);

  return (
    <div ref={barRef} className="lead-filters">
      {/* PERIOD */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={`lead-fchip ${periodFilter !== "all" ? "lead-fchip--on" : ""}`}
          style={chipColor(periodFilter !== "all", "var(--accent-cyan)")}
          onClick={() => setOpen(open === "period" ? null : "period")}
        >
          <Icon.Calendar />
          {periodFilter === "all" ? "Periodo" : <>Periodo · <b>{PERIOD_LABEL[periodFilter]}</b></>}
          <span className="lead-fchip-caret">▾</span>
        </button>
        {open === "period" && (
          <div className="lead-fpop">
            {(["all", "today", "7d", "30d", "90d"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`lead-fpop__item ${periodFilter === k ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setPeriodFilter(k); setOpen(null); }}
              >
                {PERIOD_LABEL[k]}
                <span className="lead-fpop__item-count">{periodCount(k)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SOURCE */}
      {sources.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={`lead-fchip ${sourceFilter !== "all" ? "lead-fchip--on" : ""}`}
            style={chipColor(sourceFilter !== "all", "var(--accent-violet)")}
            onClick={() => setOpen(open === "source" ? null : "source")}
          >
            <Icon.Megaphone />
            {sourceFilter === "all"
              ? "Fuente"
              : <>Fuente · <b>{SOURCE_LABEL[sourceFilter] || sourceFilter}</b></>}
            <span className="lead-fchip-caret">▾</span>
          </button>
          {open === "source" && (
            <div className="lead-fpop">
              <button
                type="button"
                className={`lead-fpop__item ${sourceFilter === "all" ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setSourceFilter("all"); setOpen(null); }}
              >
                Todas
                <span className="lead-fpop__item-count">{leads.length}</span>
              </button>
              {sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`lead-fpop__item ${sourceFilter === s ? "lead-fpop__item--active" : ""}`}
                  onClick={() => { setSourceFilter(s); setOpen(null); }}
                >
                  {SOURCE_LABEL[s] || s}
                  <span className="lead-fpop__item-count">{sourceCounts.get(s) || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STAGE — only useful in TABLE view (the board IS grouped by stage) */}
      {view === "table" && stages.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={`lead-fchip ${stageFilter !== "all" ? "lead-fchip--on" : ""}`}
            style={chipColor(stageFilter !== "all", "var(--accent-amber)")}
            onClick={() => setOpen(open === "stage" ? null : "stage")}
          >
            <Icon.Workflow />
            {stageFilter === "all"
              ? "Etapa"
              : <>Etapa · <b>{stages.find((s) => s.id === stageFilter)?.label || stageFilter}</b></>}
            <span className="lead-fchip-caret">▾</span>
          </button>
          {open === "stage" && (
            <div className="lead-fpop">
              <button
                type="button"
                className={`lead-fpop__item ${stageFilter === "all" ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setStageFilter("all"); setOpen(null); }}
              >
                Todas
                <span className="lead-fpop__item-count">{leads.length}</span>
              </button>
              {stages.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`lead-fpop__item ${stageFilter === s.id ? "lead-fpop__item--active" : ""}`}
                  onClick={() => { setStageFilter(s.id); setOpen(null); }}
                >
                  {s.label}
                  <span className="lead-fpop__item-count">{stageCounts.get(s.id) || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AGENT */}
      {agents.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={`lead-fchip ${agentFilter !== "all" ? "lead-fchip--on" : ""}`}
            style={chipColor(agentFilter !== "all", "var(--accent-cyan)")}
            onClick={() => setOpen(open === "agent" ? null : "agent")}
          >
            <Icon.User />
            {agentFilter === "all" ? "Agente" : <>Agente · <b>{agentFilter}</b></>}
            <span className="lead-fchip-caret">▾</span>
          </button>
          {open === "agent" && (
            <div className="lead-fpop">
              <button
                type="button"
                className={`lead-fpop__item ${agentFilter === "all" ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setAgentFilter("all"); setOpen(null); }}
              >
                Todos
                <span className="lead-fpop__item-count">{leads.length}</span>
              </button>
              {agents.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`lead-fpop__item ${agentFilter === a ? "lead-fpop__item--active" : ""}`}
                  onClick={() => { setAgentFilter(a); setOpen(null); }}
                >
                  {a}
                  <span className="lead-fpop__item-count">{agentCounts.get(a) || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VALUE */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={`lead-fchip ${valueFilter !== "all" ? "lead-fchip--on" : ""}`}
          style={chipColor(valueFilter !== "all", "var(--accent-green)")}
          onClick={() => setOpen(open === "value" ? null : "value")}
        >
          <Icon.Chart />
          {valueFilter === "all" ? "Valor" : <>Valor · <b>{VALUE_LABEL[valueFilter]}</b></>}
          <span className="lead-fchip-caret">▾</span>
        </button>
        {open === "value" && (
          <div className="lead-fpop">
            {(["all", "with", "without"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`lead-fpop__item ${valueFilter === k ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setValueFilter(k); setOpen(null); }}
              >
                {VALUE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SALESFORCE SYNC */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={`lead-fchip ${syncedFilter !== "all" ? "lead-fchip--on" : ""}`}
          style={chipColor(syncedFilter !== "all", "var(--accent-cyan)")}
          onClick={() => setOpen(open === "synced" ? null : "synced")}
        >
          <Icon.Cloud />
          {syncedFilter === "all" ? "Salesforce" : <>SF · <b>{SYNCED_LABEL[syncedFilter]}</b></>}
          <span className="lead-fchip-caret">▾</span>
        </button>
        {open === "synced" && (
          <div className="lead-fpop">
            {(["all", "sf", "local"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`lead-fpop__item ${syncedFilter === k ? "lead-fpop__item--active" : ""}`}
                onClick={() => { setSyncedFilter(k); setOpen(null); }}
              >
                {SYNCED_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* STALE — toggle */}
      <button
        type="button"
        className={`lead-fchip ${staleOnly ? "lead-fchip--on" : ""}`}
        style={chipColor(staleOnly, "var(--accent-red)")}
        onClick={() => setStaleOnly(!staleOnly)}
        title="Sólo leads con más de 7 días sin cambios"
      >
        ⚠ Estancados
      </button>

      {/* Clear-all */}
      {anyActive && (
        <>
          <span className="lead-filters__divider" />
          <button type="button" className="lead-filters__clear" onClick={clearAll}>
            <Icon.Close /> Limpiar filtros
          </button>
        </>
      )}
    </div>
  );
}
