/* ============================================================
   ARIA · Citas — sidebar re-skin (KPIs · explainer · leyenda)
   ------------------------------------------------------------
   Presentational-only ARIA layer for the Citas (Appointments)
   workspace. Consumes REAL numbers computed in AppointmentsPage
   (no mock data). Lives inside the calendar sidebar column so the
   fixed Google-Calendar grid keeps its full width + drag logic.
   Mirrors the visual language of _designtmp/aria/aria-citas.jsx.
   ============================================================ */
import { Icon, Stat } from "@/components/aria";

/** At-a-glance KPIs for the Citas agenda — all values are derived
 *  from the agent's real callbacks in AppointmentsPage. */
export interface CitasStats {
  /** Citas agendadas para HOY. */
  today: number;
  /** Total agendado en la semana visible. */
  week: number;
  /** % confirmadas (completadas / no canceladas). */
  confirmedPct: number;
  /** % de no-show sobre el total gestionado. */
  noShowPct: number;
}

/** ARIA explainer band — same intent as the reference `CiE`. Uses the
 *  global `.explain` class (no new CSS). */
export function CitasExplain() {
  return (
    <div className="explain" style={{ marginBottom: 0 }}>
      <div className="explain__ico">
        <Icon name="calendar" size={16} />
      </div>
      <div>
        <div className="explain__title">Tu agenda de captación</div>
        <div className="explain__txt">
          Cada cita queda ligada a un cliente o lead. Arrastra un bloque para
          reagendar; ARIA envía recordatorios para bajar el no-show.
        </div>
      </div>
    </div>
  );
}

/** ARIA channel legend — Llamada / WhatsApp — matching the reference. */
export function CitasLegend() {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="gcal__section-title">Canales</div>
      <div
        className="row"
        style={{ gap: 14, fontSize: 11.5, color: "var(--text-3)", padding: "0 2px" }}
      >
        <span className="row" style={{ gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent-green)",
            }}
          />
          Llamada
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent-cyan)",
            }}
          />
          WhatsApp
        </span>
      </div>
    </div>
  );
}

/** ARIA KPI grid for the sidebar — Stat cards fed by real numbers.
 *  2×2 so it stays compact inside the 256px column. */
export function CitasStatGrid({ stats }: { stats: CitasStats }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="gcal__section-title">Resumen</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Stat icon="calendar" color="var(--accent)" label="Hoy" value={stats.today} />
        <Stat icon="layers" color="var(--cyan)" label="Semana" value={stats.week} />
        <Stat
          icon="check"
          color="var(--green)"
          label="Confirm."
          value={`${stats.confirmedPct}%`}
        />
        <Stat
          icon="missed"
          color="var(--coral)"
          label="No-show"
          value={`${stats.noShowPct}%`}
        />
      </div>
    </div>
  );
}
