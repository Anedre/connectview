import { useCallback, useEffect, useState } from "react";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";

/**
 * RecentContactsTable — landing de "Historial y Grabaciones": lista los leads
 * por su NOMBRE con su última actividad guardada (Vox-nativo). Click en una
 * fila abre el historial completo de ese lead. Nada de teléfonos sueltos: la
 * columna principal es el nombre del lead.
 */
export interface RecentLead {
  leadId: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  sfLeadId?: string;
  updatedAt?: string;
  lastActivity?: {
    type?: string;
    channel?: string;
    untyped?: boolean;
    stageLabel?: string;
    subStageLabel?: string;
    ts?: string;
  } | null;
}

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
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `hace ${days} d`;
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

export function RecentContactsTable({
  onSelect,
  selectedPhone,
}: {
  onSelect: (lead: RecentLead) => void;
  selectedPhone: string | null;
}) {
  const { tree } = useTaxonomy();
  const [rows, setRows] = useState<RecentLead[]>([]);
  const [allRows, setAllRows] = useState<RecentLead[] | null>(null); // todos los leads (para buscar)
  const [state, setState] = useState<"loading" | "ok" | "err">(
    () => (getApiEndpoints()?.manageLeads ? "loading" : "err")
  );
  const [q, setQ] = useState("");

  // Carga/recarga de recientes — refleja la última interacción al instante.
  const reload = useCallback(() => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    fetch(`${ep.manageLeads}?recent=50`)
      .then((r) => r.json())
      .then((j) => {
        setRows(Array.isArray(j.recent) ? j.recent : []);
        setState("ok");
        setAllRows(null); // invalida el cache de búsqueda → próxima búsqueda re-trae fresco
      })
      .catch(() => setState((s) => (s === "loading" ? "err" : s)));
  }, []);

  // Carga inicial + recarga al volver a la pestaña (foco/visibilidad).
  useEffect(() => {
    reload();
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // Al empezar a buscar: traer TODOS los leads (una sola vez) para buscar por nombre.
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
        const mapped: RecentLead[] = (j.leads || []).map((l: Record<string, unknown>) => ({
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
        }));
        setAllRows(mapped);
      } catch { /* búsqueda opcional */ }
    })();
    return () => ctrl.abort();
  }, [q, allRows]);

  const stageLabel = (id?: string) => tree.find((s) => s.id === id)?.label || id || "—";
  const query = q.trim().toLowerCase();
  // Al buscar (≥2): sobre TODOS los leads; si no: los recientes.
  const source = query.length >= 2 && allRows ? allRows : rows;
  const filtered = query
    ? source.filter((r) => (r.name || "").toLowerCase().includes(query) || (r.company || "").toLowerCase().includes(query) || (r.phone || "").includes(query))
    : rows;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-1)", display: "flex", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{query ? `Resultados (${filtered.length})` : "Contacto reciente"}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {query ? "Buscando en todos los leads por nombre, empresa o teléfono" : "Últimos leads con actividad guardada — clic para ver su historial"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="row" style={{ gap: 6, background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 8, padding: "5px 9px" }}>
          <Icon.Search size={13} style={{ color: "var(--text-3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…" style={{ border: "none", background: "transparent", color: "var(--text-1)", fontSize: 12.5, outline: "none", width: 160 }} />
        </div>
        <button onClick={reload} className="btn btn--ghost btn--sm" title="Actualizar" aria-label="Actualizar">
          <Icon.Refresh size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {state === "loading" ? (
          <div className="muted" style={{ padding: 16, fontSize: 13 }}>Cargando…</div>
        ) : state === "err" ? (
          <div className="muted" style={{ padding: 16, fontSize: 13 }}>No se pudo cargar.</div>
        ) : filtered.length === 0 ? (
          <div className="muted" style={{ padding: 16, fontSize: 13 }}>Sin contactos recientes.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-3)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                <th style={{ padding: "8px 16px", fontWeight: 700 }}>Lead</th>
                <th style={{ padding: "8px 10px", fontWeight: 700 }}>Origen</th>
                <th style={{ padding: "8px 10px", fontWeight: 700 }}>Etapa</th>
                <th style={{ padding: "8px 10px", fontWeight: 700 }}>Última actividad</th>
                <th style={{ padding: "8px 16px", fontWeight: 700 }}>Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const o = originTone(r.source);
                const sel = selectedPhone && r.phone === selectedPhone;
                return (
                  <tr
                    key={r.leadId}
                    onClick={() => onSelect(r)}
                    style={{ cursor: "pointer", borderTop: "1px solid var(--border-1)", background: sel ? "var(--accent-cyan-soft)" : undefined }}
                  >
                    <td style={{ padding: "9px 16px" }}>
                      <div className="row" style={{ gap: 9 }}>
                        <span style={{ flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}>
                          {(r.name || r.phone || "?").slice(0, 2).toUpperCase()}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{r.name || r.phone}</div>
                          {r.company ? <div className="muted" style={{ fontSize: 11 }}>{r.company}</div> : null}
                        </div>
                        {r.sfLeadId ? <Icon.Cloud size={12} style={{ color: "#00a1e0", flex: "0 0 auto" }} /> : null}
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: o.bg, color: "#fff" }}>{o.label}</span>
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--text-2)" }}>{stageLabel(r.stageId)}</td>
                    <td style={{ padding: "9px 10px", color: "var(--text-2)" }}>{activityLabel(r.lastActivity)}</td>
                    <td style={{ padding: "9px 16px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{relTime(r.lastActivity?.ts || r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
