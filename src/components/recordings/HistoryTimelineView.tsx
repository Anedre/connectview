import { useEffect, useState } from "react";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { initials } from "@/lib/initials";

/**
 * HistoryTimelineView — el "historial del lead estilo Salesforce, pero mejor".
 * Es VOX-NATIVO: el timeline base sale de `lead.history` (vía manage-leads), así
 * NO dependemos de Salesforce para tener historial. La actividad de SF se
 * mergea best-effort (si SF responde) y se deduplica por sfTaskId. Todo se
 * presenta bajo el NOMBRE del lead, no teléfonos/correos sueltos.
 */
interface VoxHistoryEvent {
  ts?: string;
  type?: string;
  channel?: string;
  untyped?: boolean;
  contactId?: string;
  stageId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  valoracion?: string;
  summary?: string;
  notes?: string;
  agent?: string;
  sfTaskId?: string;
}
interface SfActivity {
  Id: string;
  Subject?: string;
  Description?: string;
  Status?: string;
  ActivityDate?: string;
  CreatedDate?: string;
  TaskSubtype?: string;
}
interface SfData {
  found?: boolean;
  lead?: Record<string, unknown>;
  activities?: SfActivity[];
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
  tone: string;
}

const ORIGIN_STYLES: { match: string[]; label: string; bg: string }[] = [
  {
    match: ["instagram", "ig "],
    label: "Instagram",
    bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)",
  },
  { match: ["facebook", "fb ", "meta"], label: "Facebook", bg: "#1877f2" },
  { match: ["whatsapp", "wa "], label: "WhatsApp", bg: "#25d366" },
  { match: ["google", "adwords", "sem"], label: "Google", bg: "#4285f4" },
  { match: ["tiktok"], label: "TikTok", bg: "#111" },
  { match: ["linkedin"], label: "LinkedIn", bg: "#0a66c2" },
  {
    match: ["web", "website", "pagina", "página", "landing", "formulario", "form"],
    label: "Web",
    bg: "#0a6bb5",
  },
  { match: ["referral", "referido", "recomend"], label: "Referido", bg: "#d98324" },
  { match: ["phone", "llamada", "inbound", "telefon"], label: "Teléfono", bg: "#0aa5b5" },
  { match: ["vox"], label: "ARIA", bg: "#7c5cff" },
];
function originBadge(src?: string): { label: string; bg: string } {
  const k = (src || "").toLowerCase();
  for (const o of ORIGIN_STYLES)
    if (o.match.some((m) => k.includes(m.trim()))) return { label: o.label, bg: o.bg };
  return { label: src || "Sin origen", bg: "var(--text-3)" };
}
function channelIcon(channel?: string) {
  const c = (channel || "").toLowerCase();
  if (c.includes("llam") || c.includes("call") || c.includes("voice"))
    return <Icon.Phone size={13} />;
  if (c.includes("correo") || c.includes("email") || c.includes("mail"))
    return <Icon.Mail size={13} />;
  if (c.includes("whatsapp")) return <Icon.WhatsApp size={13} />;
  if (c.includes("chat")) return <Icon.Chat size={13} />;
  if (c.includes("salesforce")) return <Icon.Cloud size={13} />;
  return <Icon.Note size={13} />;
}
function activityIcon(subtype?: string) {
  const s = (subtype || "").toLowerCase();
  if (s.includes("call")) return <Icon.Phone size={13} />;
  if (s.includes("email")) return <Icon.Mail size={13} />;
  return <Icon.Note size={13} />;
}

function buildTimeline(vox: VoxHistoryEvent[], acts: SfActivity[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  // Si una llamada se tipificó (gestión), su interacción "sin tipificar" del mismo
  // contacto se oculta → un solo evento por contacto.
  const typedContacts = new Set(
    vox.filter((e) => e.type === "gestion" && e.contactId).map((e) => e.contactId as string),
  );
  vox.forEach((ev, i) => {
    if (ev.type === "interaccion" && ev.contactId && typedContacts.has(ev.contactId)) return;
    if (ev.sfTaskId) seen.add(ev.sfTaskId);
    let icon: React.ReactNode;
    let title: string;
    let tone = "var(--accent-violet)";
    if (ev.type === "interaccion") {
      icon = channelIcon(ev.channel);
      title = `${ev.channel || "Interacción"}${ev.untyped ? " (sin tipificar)" : ""}`;
      tone = ev.untyped ? "var(--accent-amber)" : "var(--accent-cyan)";
    } else if (ev.type === "gestion") {
      icon = channelIcon(ev.channel);
      title = `${ev.channel || "Gestión"}${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}${ev.subStageLabel ? ` › ${ev.subStageLabel}` : ""}`;
    } else if (ev.type === "stage_change") {
      icon = ev.channel === "Salesforce" ? <Icon.Cloud size={13} /> : <Icon.Tag size={13} />;
      title =
        ev.channel === "Salesforce"
          ? `Actualizado desde Salesforce${ev.stageLabel ? ` · ${ev.stageLabel}` : ""}`
          : `Etapa → ${ev.stageLabel || ev.stageId || "?"}`;
      tone = "var(--accent-cyan)";
    } else {
      icon = <Icon.Note size={13} />;
      title = ev.type === "update" ? "Datos actualizados" : ev.summary || "Evento";
      tone = "var(--text-3)";
    }
    const meta = [ev.valoracion, ev.agent].filter(Boolean).join(" · ");
    items.push({
      key: `v${i}`,
      ts: ev.ts || "",
      icon,
      title,
      detail: ev.summary || ev.notes,
      meta: meta || undefined,
      src: "vox",
      tone,
    });
  });
  acts.forEach((a) => {
    if (a.Id && seen.has(a.Id)) return;
    items.push({
      key: `s${a.Id}`,
      ts: a.ActivityDate || a.CreatedDate || "",
      icon: activityIcon(a.TaskSubtype),
      title: a.Subject || "(sin asunto)",
      detail: a.Description,
      meta: a.Status || undefined,
      src: "sf",
      tone: "#00a1e0",
    });
  });
  items.sort((x, y) => (y.ts || "").localeCompare(x.ts || ""));
  return items;
}

export function HistoryTimelineView({ phone, name }: { phone: string | null; name: string }) {
  const [vox, setVox] = useState<VoxHistoryEvent[]>([]);
  const [sf, setSf] = useState<SfData | null>(null);
  // Estado inicial lazy; el componente se remonta por `key={phone}` desde la página,
  // así cada lead arranca en "loading" sin setState síncrono en el effect.
  const [state, setState] = useState<"idle" | "loading" | "ok">(() => (phone ? "loading" : "idle"));

  useEffect(() => {
    if (!phone) return; // sin lead → queda "idle"
    const ep = getApiEndpoints();
    const ctrl = new AbortController();
    (async () => {
      // 1) Historial Vox-nativo (siempre, independiente de SF).
      try {
        if (ep?.manageLeads) {
          const r = await authedFetch(`${ep.manageLeads}?phone=${encodeURIComponent(phone)}`, {
            signal: ctrl.signal,
          });
          const j = await r.json();
          const lead = (j.leads || [])[0];
          setVox(Array.isArray(lead?.history) ? lead.history : []);
        }
      } catch {
        /* sin historial Vox */
      }
      // 2) Actividad + datos de SF (best-effort; si falla, igual mostramos Vox).
      try {
        if (ep?.salesforceSync) {
          const r = await authedFetch(ep.salesforceSync, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "lead", phone }),
            signal: ctrl.signal,
          });
          setSf(await r.json());
        }
      } catch {
        /* SF opcional */
      }
      setState("ok");
    })();
    return () => ctrl.abort();
  }, [phone]);

  if (state === "idle") {
    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--text-3)",
          fontSize: 13,
          padding: 24,
          textAlign: "center",
        }}
      >
        Elige un lead para ver su historial completo.
      </div>
    );
  }

  const L = sf?.found ? sf.lead || {} : {};
  const origin = sf?.found ? originBadge(L.LeadSource ? String(L.LeadSource) : undefined) : null;
  const timeline = buildTimeline(vox, sf?.activities || []);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Encabezado: nombre del lead + cara de SF */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            flex: "0 0 auto",
            width: 38,
            height: 38,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 14,
            fontWeight: 700,
            background: "var(--accent-cyan-soft)",
            color: "var(--accent-cyan)",
          }}
        >
          {initials(name)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{name || "(sin nombre)"}</div>
          <div className="row" style={{ gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            {origin && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 18,
                  padding: "0 8px",
                  borderRadius: 999,
                  fontSize: 9.5,
                  fontWeight: 700,
                  background: origin.bg,
                  color: "#fff",
                }}
              >
                {origin.label}
              </span>
            )}
            {sf?.found && L.Status ? (
              <span className="chip" style={{ height: 18, fontSize: 9.5 }}>
                {String(L.Status)}
              </span>
            ) : null}
          </div>
        </div>
        {sf?.found && sf.lightningUrl && L.Id ? (
          <a
            href={`${sf.lightningUrl}/lightning/r/Lead/${String(L.Id)}/view`}
            target="_blank"
            rel="noreferrer"
            className="btn btn--sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Icon.Cloud size={13} /> Abrir en Salesforce
          </a>
        ) : null}
      </div>

      {/* Timeline */}
      <div style={{ padding: 16 }}>
        {state === "loading" ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Cargando historial…
          </div>
        ) : timeline.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Sin actividad registrada todavía para este lead.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {timeline.map((it, idx) => (
              <div key={it.key} className="row" style={{ gap: 12, alignItems: "stretch" }}>
                {/* Rail con punto + línea */}
                <div
                  style={{
                    flex: "0 0 auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: 30,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: it.src === "sf" ? "rgba(0,161,224,0.14)" : "var(--bg-2)",
                      color: it.tone,
                      border: `1px solid ${it.tone}55`,
                    }}
                  >
                    {it.icon}
                  </span>
                  {idx < timeline.length - 1 && (
                    <span
                      style={{
                        flex: 1,
                        width: 2,
                        background: "var(--border-1)",
                        marginTop: 2,
                        minHeight: 8,
                      }}
                    />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1, paddingBottom: 12 }}>
                  <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                      {it.title}
                    </span>
                    <span className="muted" style={{ fontSize: 10.5, flex: "0 0 auto" }}>
                      {(it.ts || "").slice(0, 10)}
                      {it.src === "sf" ? " · SF" : ""}
                    </span>
                  </div>
                  {it.detail ? (
                    <div
                      className="muted"
                      style={{ fontSize: 12, whiteSpace: "pre-wrap", marginTop: 3 }}
                    >
                      {it.detail}
                    </div>
                  ) : null}
                  {it.meta ? (
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                      {it.meta}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
