import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";
import { useConversationActions, type Conversation } from "@/hooks/useConversations";

/**
 * CustomerContextBar — "Cliente 360" del hilo (Pilar 6 · Fase C). Vincula la
 * conversación social a un lead (manual o auto por teléfono) y muestra el
 * contexto unificado: nombre, origen, # de golpes. Reusa `manage-leads ?phone=`.
 */
interface LeadLite {
  leadId: string;
  phone?: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  golpesCount?: number;
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

export function CustomerContextBar({ conversation }: { conversation: Conversation }) {
  const navigate = useNavigate();
  const { link, unlink } = useConversationActions();
  const linked = !!conversation.leadId;
  const { data: lead } = useLeadByPhone(conversation.phone);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const { data: allLeads, isLoading: searching } = useLeadSearch(picking);

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

  const wrap: React.CSSProperties = {
    padding: "8px 16px",
    borderBottom: "1px solid var(--border-1)",
    background: "var(--bg-2)",
    fontSize: 12.5,
  };

  // ── Vinculado: mostramos el contexto del lead ──
  if (linked) {
    return (
      <div style={wrap}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.User size={15} style={{ color: "var(--accent-cyan)", flex: "0 0 auto" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 700 }}>
              {lead?.name || conversation.customerName || conversation.phone}
            </span>
            {lead?.source && (
              <span className="chip" style={{ marginLeft: 8, height: 18, fontSize: 10 }}>
                {SOURCE_LABEL[lead.source] || lead.source}
              </span>
            )}
            {typeof lead?.golpesCount === "number" && lead.golpesCount > 0 && (
              <span
                className="chip"
                title="Golpes: llamadas + WhatsApp + email + gestiones (incluye este canal)"
                style={{
                  marginLeft: 6,
                  height: 18,
                  fontSize: 10,
                  background: "var(--accent-cyan-soft)",
                  color: "var(--accent-cyan)",
                }}
              >
                🎯 {lead.golpesCount}
              </span>
            )}
            {conversation.phone && (
              <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                {conversation.phone}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/leads")}
            title="Abrir en el embudo de Leads"
          >
            Ver
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => unlink.mutate(conversation.conversationId)}
            disabled={unlink.isPending}
            title="Desvincular del lead"
          >
            <Icon.Close size={13} />
          </button>
        </div>
      </div>
    );
  }

  // ── Sin vincular: hint de teléfono detectado + botón / picker ──
  return (
    <div style={wrap}>
      {!picking ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.User size={15} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
          <span className="muted" style={{ flex: 1 }}>
            {conversation.phone ? (
              <>
                Sin vincular · <b style={{ color: "var(--text-2)" }}>📞 {conversation.phone}</b>{" "}
                detectado en el chat
              </>
            ) : (
              "Sin vincular a un cliente"
            )}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => setPicking(true)}>
            <Icon.Plus size={13} /> Vincular a cliente
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar lead por nombre, teléfono o empresa…"
              style={{
                flex: 1,
                padding: "6px 10px",
                fontSize: 12.5,
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                background: "var(--bg-1)",
                color: "var(--text-1)",
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setPicking(false);
                setQ("");
              }}
            >
              Cancelar
            </button>
          </div>
          <div
            style={{
              marginTop: 6,
              maxHeight: 180,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {searching ? (
              <div className="muted" style={{ padding: 8, fontSize: 12 }}>
                Cargando leads…
              </div>
            ) : matches.length === 0 ? (
              <div className="muted" style={{ padding: 8, fontSize: 12 }}>
                Sin coincidencias.
              </div>
            ) : (
              matches.map((l) => (
                <button
                  key={l.leadId}
                  type="button"
                  onClick={() => doLink(l)}
                  disabled={link.isPending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    textAlign: "left",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon.User size={13} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
                  <span
                    style={{
                      minWidth: 0,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <b style={{ fontSize: 12.5 }}>{l.name || l.phone || "(sin nombre)"}</b>
                    {l.company && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {" "}
                        · {l.company}
                      </span>
                    )}
                    {l.phone && (
                      <span className="muted" style={{ fontSize: 11 }}>
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
  );
}
