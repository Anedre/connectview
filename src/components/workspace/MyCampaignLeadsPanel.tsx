import { useState } from "react";
import { toast } from "sonner";
import { useMyCampaignLeads, type MyLead } from "@/hooks/useMyCampaignLeads";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";
import { useConfirm } from "@/components/ui/confirm-dialog";

const RESCHEDULE_PRESETS: { label: string; ms: number }[] = [
  { label: "+30 min", ms: 30 * 60 * 1000 },
  { label: "+1 h", ms: 60 * 60 * 1000 },
  { label: "+3 h", ms: 3 * 60 * 60 * 1000 },
  { label: "+1 día", ms: 24 * 60 * 60 * 1000 },
];

/**
 * Preview-dial / manual-mode lead list shown in the agent desktop when
 * the agent has pending manual-mode campaign leads pre-assigned to them.
 * Each row gets two buttons:
 *
 *   • Llamar — backend marks the row as `dialing` (so it leaves the
 *     panel) and returns the phone; we then call placeCall() from the
 *     Streams CCP context to actually fire the outbound contact.
 *   • Saltar — backend marks the row as `skipped` (terminal status,
 *     no retry). The lead leaves the panel.
 *
 * Renders nothing when there are no leads — the AgentDesktopPage's
 * "Transcripción en vivo" idle pane stays in its default state.
 */
export function MyCampaignLeadsPanel() {
  const { leads, callLead, skipLead, rescheduleLead, refresh, loading } = useMyCampaignLeads(
    5000
  );
  const { placeCall, agentState } = useCCP();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null); // rowId currently mutating
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  if (leads.length === 0) {
    if (loading) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--text-3)",
            fontSize: 12.5,
          }}
        >
          Buscando leads pendientes…
        </div>
      );
    }
    return null;
  }

  const canDial =
    agentState === "Available" ||
    agentState === "Busy" ||
    agentState === "AfterCallWork";

  const handleCall = async (lead: MyLead) => {
    if (busy) return;
    if (!canDial) {
      toast.error("Cambia a Available antes de marcar.");
      return;
    }
    setBusy(lead.rowId);
    try {
      const phone = await callLead(lead);
      if (!phone) throw new Error("No phone");
      try {
        await placeCall(phone);
        toast.success(`Marcando a ${lead.customerName || phone}…`);
      } catch (callErr) {
        // The DDB row is already `dialing` but Streams couldn't dial —
        // surface the error; the dialer/process-contact-event will
        // eventually mark it failed if the call never connects.
        toast.error(
          callErr instanceof Error ? callErr.message : "No se pudo iniciar la llamada"
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error marcando lead");
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const handleSkip = async (lead: MyLead) => {
    if (busy) return;
    if (
      !(await confirm({
        title: "¿Saltar este lead?",
        description: `${lead.customerName || lead.phone}. No va a reintentarse.`,
        destructive: true,
        confirmLabel: "Saltar lead",
      }))
    )
      return;
    setBusy(lead.rowId);
    try {
      await skipLead(lead, "agent-skipped");
      toast.success("Lead saltado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error saltando");
    } finally {
      setBusy(null);
    }
  };

  const handleReschedule = async (lead: MyLead, addMs: number) => {
    if (busy) return;
    setBusy(lead.rowId);
    setReschedulingId(null);
    try {
      const nextRetryAt = new Date(Date.now() + addMs).toISOString();
      await rescheduleLead(lead, nextRetryAt);
      toast.success("Lead reagendado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error reagendando");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        padding: 16,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon.Phone size={15} style={{ color: "var(--accent-cyan)" }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          Mis leads pendientes
        </div>
        <span
          className="chip chip--cyan"
          style={{ fontSize: 10.5, fontWeight: 600 }}
        >
          {leads.length}
        </span>
        <span
          className="muted"
          style={{ fontSize: 11, marginLeft: "auto" }}
        >
          Modo manual · revisa contexto antes de marcar
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingRight: 4,
        }}
      >
        {leads.map((lead) => {
          const isBusy = busy === lead.rowId;
          const attrs = Object.entries(lead.attributes).filter(
            ([k]) => !k.startsWith("_") && k !== "campaignRowId"
          );
          return (
            <div
              key={`${lead.campaignId}-${lead.rowId}`}
              style={{
                padding: "10px 12px",
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {lead.customerName || "(Sin nombre)"}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}
                >
                  {lead.phone}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--text-3)",
                    marginTop: 4,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{lead.campaignName}</span>
                  {attrs.slice(0, 4).map(([k, v]) => (
                    <span
                      key={k}
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--bg-3)",
                        fontSize: 10,
                      }}
                    >
                      {k}: {String(v).slice(0, 30)}
                    </span>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexShrink: 0,
                  alignSelf: "center",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                {reschedulingId === lead.rowId ? (
                  <>
                    {RESCHEDULE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        className="btn btn--ghost btn--sm"
                        onClick={() => handleReschedule(lead, p.ms)}
                        disabled={isBusy}
                        style={{ minHeight: 30 }}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setReschedulingId(null)}
                      title="Cancelar"
                      style={{ minHeight: 30 }}
                    >
                      <Icon.Close size={11} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setReschedulingId(lead.rowId)}
                      disabled={isBusy}
                      title="Posponer este lead para más tarde"
                      style={{ minHeight: 30 }}
                    >
                      Reagendar
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleSkip(lead)}
                      disabled={isBusy}
                      title="No marcar este lead — pasar al siguiente"
                      style={{ minHeight: 30 }}
                    >
                      <Icon.Close size={11} /> Saltar
                    </button>
                    <button
                      className="btn btn--success btn--sm"
                      onClick={() => handleCall(lead)}
                      disabled={isBusy || !canDial}
                      title={
                        !canDial
                          ? "Cambia a Available para poder marcar"
                          : "Marcar este lead"
                      }
                      style={{ minHeight: 30 }}
                    >
                      <Icon.PhoneIn size={12} /> {isBusy ? "…" : "Llamar"}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {confirmDialog}
    </div>
  );
}
