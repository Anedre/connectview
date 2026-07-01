import { useMemo, useState } from "react";
import { PageHeader } from "@/components/vox/PageHeader";
import * as Icon from "@/components/vox/primitives";
import { useConversations, type ConvChannel } from "@/hooks/useConversations";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";

/**
 * InboxPage — bandeja omnicanal (Pilar 6 · R13). Una sola pantalla para todas
 * las conversaciones de Instagram DM / Messenger (y luego WhatsApp / comentarios)
 * que NO entran por un contacto de Amazon Connect. Lista a la izquierda, hilo a
 * la derecha; el agente responde inline y sale por la Graph API de Meta.
 */
type ChannelFilter = "all" | ConvChannel;

// Canales "core" siempre visibles. Mercado Libre (F4.1) es OPCIONAL: su tab solo
// aparece si el tenant realmente tiene conversaciones de ML (para universidades /
// tenants que no venden en ML, el canal no ensucia el inbox). Auto-activable.
const FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "fb_comment", label: "Comentarios" },
  { id: "whatsapp", label: "WhatsApp" },
];
const OPTIONAL_FILTERS: Record<string, { id: ChannelFilter; label: string }> = {
  mercadolibre: { id: "mercadolibre", label: "Mercado Libre" },
};

export function InboxPage() {
  const { conversations, unread, configured, loading, error } = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ChannelFilter>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter !== "all" && c.channel !== filter) return false;
      if (!needle) return true;
      return `${c.customerName || ""} ${c.senderId} ${c.lastMessagePreview || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [conversations, q, filter]);

  // Filtros efectivos: los core + los opcionales que el tenant realmente usa.
  const filters = useMemo(() => {
    const present = new Set(conversations.map((c) => c.channel));
    const extras = Object.entries(OPTIONAL_FILTERS)
      .filter(([ch]) => present.has(ch as ConvChannel))
      .map(([, f]) => f);
    return [...FILTERS, ...extras];
  }, [conversations]);

  // Selección EFECTIVA (derivada, no en un efecto): la elegida si sigue visible
  // tras filtro/búsqueda; si no, la primera de la lista. Evita el setState-in-
  // effect y el parpadeo de re-render.
  const effectiveId = useMemo(() => {
    if (selectedId && filtered.some((c) => c.conversationId === selectedId)) return selectedId;
    return filtered[0]?.conversationId ?? null;
  }, [filtered, selectedId]);

  const header = (
    <PageHeader
      crumb="Conversaciones"
      title="Conversaciones"
      count={
        loading
          ? "Cargando…"
          : `${filtered.length} ${filtered.length === 1 ? "conversación" : "conversaciones"}${unread > 0 ? ` · ${unread} sin leer` : ""}`
      }
      search={{ value: q, onChange: setQ, placeholder: "Buscar por nombre o mensaje…" }}
      tabs={
        <>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`phead__tab ${filter === f.id ? "phead__tab--active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </>
      }
    />
  );

  // Estado: endpoint no provisionado.
  if (!configured) {
    return (
      <>
        {header}
        <div style={{ display: "grid", placeItems: "center", height: "70%", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Inbox no disponible
            </div>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              El backend de conversaciones (<code>manage-conversations</code>) todavía no está
              configurado para esta organización.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {header}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          border: "1px solid var(--border-1)",
          borderRadius: 12,
          margin: 12,
          overflow: "hidden",
          background: "var(--bg-1)",
        }}
      >
        {/* Panel lista */}
        <aside
          style={{
            width: 340,
            flex: "0 0 auto",
            borderRight: "1px solid var(--border-1)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: "var(--bg-2)",
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {loading && conversations.length === 0 ? (
              <div className="muted" style={{ padding: 20, fontSize: 13 }}>
                Cargando…
              </div>
            ) : error ? (
              <div
                className="muted"
                style={{ padding: 20, fontSize: 13, color: "var(--accent-red)" }}
              >
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="muted"
                style={{ padding: 24, fontSize: 13, textAlign: "center", lineHeight: 1.5 }}
              >
                <Icon.Chat size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
                <div>
                  {conversations.length === 0
                    ? "Aún no hay conversaciones."
                    : "Nada coincide con el filtro."}
                </div>
                {conversations.length === 0 && (
                  <div style={{ fontSize: 11.5, marginTop: 6 }}>
                    Cuando alguien te escriba por Instagram o Messenger, aparecerá acá.
                  </div>
                )}
              </div>
            ) : (
              <ConversationList
                conversations={filtered}
                selectedId={effectiveId}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </aside>

        {/* Panel hilo */}
        <section
          style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          {effectiveId ? (
            <ConversationThread key={effectiveId} conversationId={effectiveId} />
          ) : (
            <div style={{ margin: "auto", textAlign: "center", padding: 24 }}>
              <Icon.Chat size={34} style={{ opacity: 0.35 }} />
              <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                Elige una conversación para ver el hilo.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
