import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

/**
 * CustomWidgets — a configurable strip of real-data widgets on the dashboard
 * (roadmap #8). Each widget pulls from an existing endpoint; the user toggles
 * which ones show via "Personalizar", and the choice persists in
 * localStorage. Additive to the existing exec dashboard (low risk).
 */
type WidgetId = "leads" | "appts" | "hsm" | "catalogs";

interface WidgetDef {
  id: WidgetId;
  label: string;
  icon: keyof typeof Icon;
  load: () => Promise<{ value: string; hint?: string }>;
}

const LS_KEY = "vox_dash_widgets";

function loadEnabled(): Set<WidgetId> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Set(JSON.parse(raw) as WidgetId[]);
  } catch {
    /* default below */
  }
  return new Set<WidgetId>(["leads", "appts", "hsm"]);
}

async function getJson(url?: string): Promise<any> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    return await r.json();
  } catch {
    return null;
  }
}

const WIDGETS: WidgetDef[] = [
  {
    id: "leads",
    label: "Leads en embudo",
    icon: "Users",
    load: async () => {
      const ep = getApiEndpoints();
      const d = await getJson(ep?.manageLeads);
      const leads = Array.isArray(d?.leads) ? d.leads : [];
      // Hint = leads not in a terminal stage (rough "activos").
      return { value: String(leads.length), hint: `${leads.length} totales` };
    },
  },
  {
    id: "appts",
    label: "Citas próximas",
    icon: "Calendar",
    load: async () => {
      const ep = getApiEndpoints();
      const d = await getJson(
        ep?.manageAppointment ? `${ep.manageAppointment}?upcoming=true` : undefined
      );
      const appts = Array.isArray(d?.appointments) ? d.appointments : [];
      const next = appts[0]?.whenISO
        ? new Date(appts[0].whenISO).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })
        : undefined;
      return { value: String(appts.length), hint: next ? `próxima ${next}` : "sin próximas" };
    },
  },
  {
    id: "hsm",
    label: "Plantillas WA enviadas",
    icon: "WhatsApp",
    load: async () => {
      const ep = getApiEndpoints();
      const d = await getJson(ep?.getHsmReport);
      const total = d?.totals?.total ?? 0;
      return { value: String(total), hint: `${d?.templates?.length ?? 0} plantillas` };
    },
  },
  {
    id: "catalogs",
    label: "Catálogos",
    icon: "Pad",
    load: async () => {
      const ep = getApiEndpoints();
      const d = await getJson(ep?.manageCatalog);
      const n = Array.isArray(d?.catalogs) ? d.catalogs.length : 0;
      return { value: String(n), hint: "listas de referencia" };
    },
  },
];

export function CustomWidgets() {
  const [enabled, setEnabled] = useState<Set<WidgetId>>(loadEnabled);
  const [customizing, setCustomizing] = useState(false);
  const [data, setData] = useState<Record<string, { value: string; hint?: string }>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      WIDGETS.filter((w) => enabled.has(w.id)).map(async (w) => {
        const res = await w.load().catch(() => ({ value: "—" }));
        return [w.id, res] as const;
      })
    ).then((pairs) => {
      if (!cancelled) setData(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const toggle = (id: WidgetId) => {
    setEnabled((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const shown = WIDGETS.filter((w) => enabled.has(w.id));

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Mis widgets
        </span>
        <button className="btn btn--ghost btn--sm" onClick={() => setCustomizing((c) => !c)}>
          <Icon.Settings size={12} /> Personalizar
        </button>
      </div>

      {customizing && (
        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {WIDGETS.map((w) => (
              <label key={w.id} className="row" style={{ gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={enabled.has(w.id)} onChange={() => toggle(w.id)} />
                {w.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, shown.length)}, 1fr)`, gap: 12 }}>
        {shown.map((w) => {
          const Ico = Icon[w.icon] as React.ComponentType<{ size?: number }>;
          const d = data[w.id];
          return (
            <div
              key={w.id}
              style={{
                padding: 14,
                border: "1px solid var(--border-1)",
                borderRadius: 10,
                background: "var(--bg-1)",
              }}
            >
              <div className="row" style={{ gap: 6, color: "var(--text-2)", fontSize: 11.5, fontWeight: 600 }}>
                {Ico && <Ico size={13} />} {w.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--text-1)" }}>
                {d?.value ?? "…"}
              </div>
              {d?.hint && (
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{d.hint}</div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: 12 }}>
            No hay widgets activos. Usa "Personalizar" para agregar.
          </div>
        )}
      </div>
    </div>
  );
}
