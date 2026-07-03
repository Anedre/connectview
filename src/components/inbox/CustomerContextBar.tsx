import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Btn, Icon, Pill } from "@/components/aria";
import { useConversation, useConversationActions } from "@/hooks/useConversations";
import { CH_LABEL } from "./channelMeta";
import { ConversationTypifyModal } from "./ConversationTypifyModal";

/**
 * CustomerContextPanel — "Cliente 360" del hilo (Pilar 6 · Fase C), re-skinneado
 * al panel derecho del handoff ARIA (`.inbox__ctx`). Vincula la conversación
 * social a un lead (manual o auto por teléfono) y muestra el contexto unificado:
 * etapa, programa, canal principal, golpes y origen. Reusa `manage-leads ?phone=`.
 * Toda la lógica de vincular/desvincular queda intacta.
 */
interface LeadLite {
  leadId: string;
  phone?: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  /** Etiqueta legible de la etapa, si la API la provee (degrada elegante). */
  stageLabel?: string;
  source?: string;
  golpesCount?: number;
  /** Programa comercial vinculado (Pilar 1), si la API lo provee. */
  programName?: string;
  programCode?: string;
}

/** Lead por teléfono (reusa manage-leads ?phone= → trae historial + golpes). */
function useLeadByPhone(phone?: string) {
  const url = getApiEndpoints()?.manageLeads;
  return useQuery({
    queryKey: ["leadByPhone", phone],
    enabled: !!url && !!phone,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const r = await authedFetch(`${url}?phone=${encodeURIComponent(phone!)}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d.leads) && d.leads[0] ? (d.leads[0] as LeadLite) : null;
    },
  });
}

/** Lista de leads para el buscador del picker (lazy: solo al abrir). */
function useLeadSearch(enabled: boolean) {
  const url = getApiEndpoints()?.manageLeads;
  return useQuery({
    queryKey: ["leadsAll"],
    enabled: !!url && enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const r = await authedFetch(url!, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d.leads) ? (d.leads as LeadLite[]) : [];
    },
  });
}

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Web",
  campaign: "Campaña",
  salesforce: "Salesforce",
  whatsapp: "WhatsApp",
  manual: "Manual",
  facebook: "Facebook",
  instagram: "Instagram",
  referral: "Referido",
  call: "Llamada",
};

/** Fila etiqueta → valor del bloque "Contexto del cliente". */
function ContextRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row between">
      <span className="dim">{label}</span>
      {children}
    </div>
  );
}

export function CustomerContextPanel({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const { conversation } = useConversation(conversationId);
  const { link, unlink } = useConversationActions();
  const [picking, setPicking] = useState(false);
  const [typifyOpen, setTypifyOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: allLeads, isLoading: searching } = useLeadSearch(picking);
  const { data: lead } = useLeadByPhone(conversation?.phone);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = allLeads || [];
    if (!needle) return pool.slice(0, 8);
    return pool
      .filter((l) =>
        `${l.name || ""} ${l.phone || ""} ${l.company || ""} ${l.email || ""}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8);
  }, [allLeads, q]);

  if (!conversation) return null;
  const linked = !!conversation.leadId;

  const doLink = async (l: LeadLite) => {
    try {
      await link.mutateAsync({
        conversationId: conversation.conversationId,
        leadId: l.leadId,
        phone: l.phone,
        email: l.email,
        customerName: l.name,
      });
      toast.success(`Vinculado a ${l.name || l.phone || "lead"}`);
      setPicking(false);
      setQ("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo vincular");
    }
  };

  // Campos de contexto — solo mostramos lo que realmente existe (degrada elegante).
  const stage = lead?.stageLabel;
  const program = lead?.programCode || lead?.programName;
  const channelLabel = CH_LABEL[conversation.channel] || conversation.channel;
  const golpes = typeof lead?.golpesCount === "number" ? lead.golpesCount : undefined;
  const source = lead?.source ? SOURCE_LABEL[lead.source] || lead.source : undefined;
  const hasAnyContext = stage || program || golpes != null || source;

  return (
    <>
      {/* ── Contexto del cliente ── */}
      <div style={{ padding: "18px 18px 8px" }}>
        <div className="row" style={{ marginBottom: 14, gap: 7 }}>
          <b style={{ fontSize: 14 }}>Contexto del cliente</b>
          <span
            className="dim"
            title="Todo el historial cross-canal del contacto, unificado desde tu base de leads (y Salesforce)."
            style={{ display: "inline-flex", cursor: "help" }}
          >
            <Icon name="help" size={13} />
          </span>
        </div>

        {linked ? (
          <div className="col gap10" style={{ fontSize: 13 }}>
            <ContextRow label="Contacto">
              <b className="trunc" style={{ maxWidth: 150 }}>
                {lead?.name || conversation.customerName || conversation.phone || "—"}
              </b>
            </ContextRow>
            {stage && (
              <ContextRow label="Etapa">
                <Pill tone="accent">{stage}</Pill>
              </ContextRow>
            )}
            {program && (
              <ContextRow label="Programa">
                <b>{program}</b>
              </ContextRow>
            )}
            <ContextRow label="Canal principal">
              <b>{channelLabel}</b>
            </ContextRow>
            {golpes != null && (
              <ContextRow label="Toques">
                <b className="tnum" title="Golpes: llamadas + WhatsApp + email + gestiones">
                  {golpes}
                </b>
              </ContextRow>
            )}
            {source && (
              <ContextRow label="Origen">
                <b>{source}</b>
              </ContextRow>
            )}
            {conversation.phone && (
              <ContextRow label="Teléfono">
                <b className="tnum">{conversation.phone}</b>
              </ContextRow>
            )}
            {!hasAnyContext && (
              <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                Vinculado, pero aún no hay más contexto para este contacto.
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              <Btn
                variant="quiet"
                size="sm"
                icon="x"
                onClick={() => unlink.mutate(conversation.conversationId)}
                disabled={unlink.isPending}
                title="Desvincular del lead"
              >
                Desvincular
              </Btn>
            </div>
          </div>
        ) : (
          <div className="col gap10" style={{ fontSize: 13 }}>
            <ContextRow label="Canal principal">
              <b>{channelLabel}</b>
            </ContextRow>
            {!picking ? (
              <>
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  {conversation.phone ? (
                    <>
                      Sin vincular ·{" "}
                      <b style={{ color: "var(--text-2)" }}>📞 {conversation.phone}</b> detectado en
                      el chat.
                    </>
                  ) : (
                    "Esta conversación aún no está vinculada a un cliente."
                  )}
                </div>
                <Btn
                  variant="soft"
                  size="sm"
                  icon="userplus"
                  onClick={() => setPicking(true)}
                  style={{ justifyContent: "flex-start" }}
                >
                  Vincular a cliente
                </Btn>
              </>
            ) : (
              <div className="col gap8">
                <div className="row gap8">
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar por nombre, teléfono…"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 10px",
                      fontSize: 12.5,
                      border: "1px solid var(--border-1)",
                      borderRadius: 8,
                      background: "var(--bg-1)",
                      color: "var(--text-1)",
                    }}
                  />
                  <Btn
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      setPicking(false);
                      setQ("");
                    }}
                  >
                    Cancelar
                  </Btn>
                </div>
                <div
                  className="col"
                  style={{ maxHeight: 220, overflowY: "auto", gap: 2 }}
                >
                  {searching ? (
                    <div className="dim" style={{ padding: 8, fontSize: 12 }}>
                      Cargando leads…
                    </div>
                  ) : matches.length === 0 ? (
                    <div className="dim" style={{ padding: 8, fontSize: 12 }}>
                      Sin coincidencias.
                    </div>
                  ) : (
                    matches.map((l) => (
                      <button
                        key={l.leadId}
                        type="button"
                        onClick={() => doLink(l)}
                        disabled={link.isPending}
                        className="row gap8"
                        style={{
                          padding: "7px 8px",
                          borderRadius: 8,
                          textAlign: "left",
                          background: "transparent",
                          border: "1px solid transparent",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <Icon
                          name="user"
                          size={14}
                          style={{ color: "var(--text-3)", flex: "0 0 auto" }}
                        />
                        <span className="trunc" style={{ minWidth: 0, flex: 1 }}>
                          <b style={{ fontSize: 12.5 }}>{l.name || l.phone || "(sin nombre)"}</b>
                          {l.company && (
                            <span className="dim" style={{ fontSize: 11 }}>
                              {" "}
                              · {l.company}
                            </span>
                          )}
                          {l.phone && (
                            <span className="dim" style={{ fontSize: 11 }}>
                              {" "}
                              · {l.phone}
                            </span>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sugerencia IA (placeholder honesto: aún no hay backend de sugerencias) ── */}
      <div style={{ padding: "8px 18px" }}>
        <div
          className="tl__note"
          style={{
            background: "var(--iris-soft)",
            border: "1px solid color-mix(in srgb, var(--iris) 22%, transparent)",
            color: "var(--text-1)",
          }}
        >
          <div className="row gap8" style={{ fontWeight: 700, marginBottom: 4 }}>
            <Icon name="sparkle" size={15} style={{ color: "var(--iris-2)" }} />
            Sugerencia IA
          </div>
          <span className="dim" style={{ fontSize: 12.5 }}>
            Las sugerencias contextuales de respuesta llegarán acá muy pronto.
          </span>
        </div>
      </div>

      {/* ── Acciones rápidas ── */}
      <div style={{ padding: "12px 18px" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Acciones rápidas
        </div>
        <div className="col gap8">
          <Btn
            variant="ghost"
            icon="calendar"
            style={{ justifyContent: "flex-start" }}
            onClick={() => navigate("/appointments")}
          >
            Agendar llamada
          </Btn>
          <Btn
            variant="ghost"
            icon="tag"
            style={{ justifyContent: "flex-start" }}
            onClick={() => setTypifyOpen(true)}
          >
            Tipificar contacto
          </Btn>
          <Btn
            variant="ghost"
            icon="userplus"
            style={{ justifyContent: "flex-start" }}
            onClick={() => navigate("/leads")}
          >
            Ver ficha completa
          </Btn>
        </div>
      </div>

      {typifyOpen && (
        <ConversationTypifyModal conversation={conversation} onClose={() => setTypifyOpen(false)} />
      )}
    </>
  );
}
