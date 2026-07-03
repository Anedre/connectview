/* ============================================================
   ARIA · Cockpit · Mis leads pre-asignados (idle)
   Réplica en mock del MyCampaignLeadsPanel real (dialer manual):
   lista de leads pre-asignados con Llamar / Saltar / Reagendar.
   Reutiliza <Card> .pill .btn — NO rediseña nada.

   GENERALIZADO: acepta `items` reales por props (desde
   useMyCampaignLeads) + callbacks onCall/onSkip/onReschedule. Sin
   props → mock (MODO DEMO). Si `items` viene [] la card se oculta.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Pill } from "@/components/aria";
import { AG_MY_LEADS, AG_FOLLOWUP_PRESETS } from "./mockData";

/** Fila normalizada — sirve al mock y a los datos reales. */
export interface MyLeadItem {
  id: string;
  name: string;
  phone: string;
  campaign: string;
  tags: string[];
}

/** Preset de reagendado (label + ms para calcular nextRetryAt en el real). */
export interface ReschedulePreset {
  label: string;
  ms?: number;
}

function fromMock(): MyLeadItem[] {
  return AG_MY_LEADS.map((l) => ({ ...l }));
}

function LeadRow({
  lead,
  onCall,
  onSkip,
  onReschedule,
  presets,
  busy,
}: {
  lead: MyLeadItem;
  onCall: (lead: MyLeadItem) => void;
  onSkip?: (lead: MyLeadItem) => void;
  onReschedule?: (lead: MyLeadItem, preset: ReschedulePreset) => void;
  presets: ReschedulePreset[];
  busy?: boolean;
}) {
  const [resched, setResched] = useState(false);
  // Modo mock (sin onSkip real): ocultamos localmente para dar feedback.
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const doSkip = () => {
    if (onSkip) onSkip(lead);
    else setHidden(true);
  };

  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-md)",
        background: "var(--bg-2)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <b style={{ fontSize: 13.5 }}>{lead.name}</b>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 2 }}>
            {lead.phone}
          </div>
          <div className="row wrap gap6" style={{ marginTop: 6 }}>
            <span className="dim" style={{ fontSize: 10.5 }}>
              {lead.campaign}
            </span>
            {lead.tags.map((t) => (
              <span
                key={t}
                style={{ padding: "1px 6px", borderRadius: 4, background: "var(--bg-3)", fontSize: 10, color: "var(--text-2)" }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="row gap6" style={{ flex: "0 0 auto" }}>
          <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setResched((r) => !r)}>
            Reagendar
          </Btn>
          <Btn variant="ghost" size="sm" icon="x" disabled={busy} onClick={doSkip}>
            Saltar
          </Btn>
          <Btn variant="soft" size="sm" icon="phone" disabled={busy} onClick={() => onCall(lead)}>
            Llamar
          </Btn>
        </div>
      </div>
      {resched && (
        <div className="row wrap gap6" style={{ marginTop: 10 }}>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="pill pill--outline"
              style={{ cursor: "pointer", height: 28 }}
              onClick={() => {
                setResched(false);
                if (onReschedule) onReschedule(lead, p);
                else setHidden(true);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MyLeads({
  onCall,
  items,
  onSkip,
  onReschedule,
  reschedulePresets,
  busyId,
}: {
  /** En el mock recibe el teléfono; en el real recibe el lead completo. */
  onCall: (leadOrPhone: MyLeadItem | string) => void;
  /** Leads reales. undefined = mock. [] = ocultar la card. */
  items?: MyLeadItem[];
  onSkip?: (lead: MyLeadItem) => void;
  onReschedule?: (lead: MyLeadItem, preset: ReschedulePreset) => void;
  reschedulePresets?: ReschedulePreset[];
  /** id del lead que está mutando (deshabilita sus botones). */
  busyId?: string | null;
}) {
  const isReal = !!items;
  const list = items ?? fromMock();
  const presets: ReschedulePreset[] =
    reschedulePresets ?? AG_FOLLOWUP_PRESETS.map((p) => ({ label: p.label }));

  // Datos reales sin leads → no mostramos la card.
  if (isReal && list.length === 0) return null;

  return (
    <Card
      title="Mis leads · pre-asignados"
      icon="target"
      extra={
        <Pill tone="cyan" icon="dot">
          {list.length} en cola
        </Pill>
      }
    >
      <div className="dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Modo manual · revisa el contexto antes de marcar.
      </div>
      <div className="col gap8">
        {list.map((lead) => (
          <LeadRow
            key={lead.id}
            lead={lead}
            // El mock pasa el teléfono (comportamiento original); el real
            // pasa el lead completo para que el host resuelva callLead().
            onCall={(l) => onCall(isReal ? l : l.phone)}
            onSkip={onSkip}
            onReschedule={onReschedule}
            presets={presets}
            busy={busyId === lead.id}
          />
        ))}
      </div>
    </Card>
  );
}
