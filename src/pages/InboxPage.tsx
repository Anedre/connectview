import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "@/components/aria";
import { useConversations, type ConvChannel } from "@/hooks/useConversations";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { CustomerContextPanel } from "@/components/inbox/CustomerContextBar";
import { CH_COLOR } from "@/components/inbox/channelMeta";
import { slaInfo, slaChipStyle } from "@/components/inbox/sla";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";

/**
 * InboxPage — bandeja omnicanal (Pilar 6 · R13), re-skinneada al layout de 3
 * columnas del handoff ARIA (`.inbox`): lista + hilo + Cliente 360. Una sola
 * pantalla para todas las conversaciones de Instagram DM / Messenger / WhatsApp
 * / comentarios / Mercado Libre que NO entran por un contacto de Amazon Connect.
 * Toda la lógica real (hooks/queries/acciones) queda intacta — solo cambia la
 * presentación.
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
  const { conversations, unread, configured, loading, error, refetch } = useConversations();
  // Preselección por query param (?c=…) — el pop-up "Recibir" del ChatQueueAlert
  // navega a /inbox?c=<conversationId> para abrir esa conversación directo.
  // La conversación seleccionada VIVE en la URL (?c=…): así el pop-up "Recibir"
  // del ChatQueueAlert abre una conversación con solo navegar, y no hay estado
  // que sincronizar con efectos (que el React Compiler desaconseja).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("c");
  const selectConversation = (id: string) =>
    setSearchParams(
      (prev) => {
        prev.set("c", id);
        return prev;
      },
      { replace: true },
    );
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

  // SLA de primera respuesta: cuántas conversaciones esperan sin atender (y
  // cuántas ya vencieron el SLA). Cálculo directo (barato; evita useMemo con
  // for-return que rompe el gate del React Compiler).
  const slaCounts = conversations.reduce(
    (acc, c) => {
      const s = slaInfo(c);
      if (s) {
        acc.total++;
        if (s.level === "breach") acc.breach++;
      }
      return acc;
    },
    { total: 0, breach: 0 },
  );

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

  // Estado: endpoint no provisionado.
  if (!configured) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              background: "var(--bg-2)",
              color: "var(--text-3)",
              margin: "0 auto 14px",
            }}
          >
            <Icon name="chats" size={26} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Inbox no disponible</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            El backend de conversaciones (<code>manage-conversations</code>) todavía no está
            configurado para esta organización.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox page" style={{ height: "100%" }}>
      {/* ── Lista ── */}
      <div className="inbox__list">
        {/* Cabecera del sidebar: título + búsqueda real + filtros por canal. */}
        <div className="ib-listhead">
          <div className="row between" style={{ marginBottom: 10 }}>
            <b style={{ fontSize: 15 }}>Conversaciones</b>
            <span className="row gap6" style={{ alignItems: "center" }}>
              {slaCounts.total > 0 && (
                <span
                  style={slaChipStyle(slaCounts.breach > 0 ? "breach" : "warn")}
                  title={`${slaCounts.total} esperando primera respuesta${
                    slaCounts.breach > 0 ? ` · ${slaCounts.breach} con SLA vencido` : ""
                  }`}
                >
                  ⏱ {slaCounts.total} sin atender
                </span>
              )}
              <span className="dim" style={{ fontSize: 12 }}>
                {loading
                  ? "Cargando…"
                  : `${filtered.length}${unread > 0 ? ` · ${unread} sin leer` : ""}`}
              </span>
            </span>
          </div>

          {/* Búsqueda real (controla q). */}
          <label className="ib-search">
            <Icon name="search" size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o mensaje…"
            />
          </label>

          {/* Filtros por canal — chips con punto de marca + conteo. */}
          <div className="ib-filters">
            {filters.map((f) => {
              const active = filter === f.id;
              const n =
                f.id === "all"
                  ? conversations.length
                  : conversations.filter((c) => c.channel === f.id).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={"ib-chan" + (active ? " ib-chan--on" : "")}
                  onClick={() => setFilter(f.id)}
                >
                  {f.id !== "all" && (
                    <span
                      className="ib-chan__dot"
                      style={{ ["--_c" as string]: CH_COLOR[f.id as ConvChannel] }}
                    />
                  )}
                  {f.label}
                  {n > 0 && <span className="ib-chan__n">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Items */}
        <div className="ib-scroll">
          {loading && conversations.length === 0 ? (
            <SkeletonList rows={7} />
          ) : error ? (
            <ErrorState
              title="No se pudieron cargar las conversaciones"
              description={error}
              onRetry={() => refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Icon name="chats" />}
              title={
                conversations.length === 0
                  ? "Aún no hay conversaciones"
                  : "Nada coincide con el filtro"
              }
              description={
                conversations.length === 0
                  ? "Cuando alguien te escriba por Instagram, Messenger o WhatsApp, aparecerá aquí."
                  : undefined
              }
            />
          ) : (
            <ConversationList
              conversations={filtered}
              selectedId={effectiveId}
              onSelect={selectConversation}
            />
          )}
        </div>
      </div>

      {/* ── Hilo ── */}
      <div className="inbox__thread">
        {effectiveId ? (
          <ConversationThread key={effectiveId} conversationId={effectiveId} />
        ) : (
          <div style={{ margin: "auto", textAlign: "center", padding: 24 }}>
            <Icon name="chats" size={36} style={{ opacity: 0.35 }} />
            <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              Elige una conversación para ver el hilo.
            </div>
          </div>
        )}
      </div>

      {/* ── Cliente 360 ── */}
      <div className="inbox__ctx">
        {effectiveId ? (
          <CustomerContextPanel key={effectiveId} conversationId={effectiveId} />
        ) : (
          <div className="dim" style={{ padding: 24, fontSize: 12.5, textAlign: "center" }}>
            El contexto del cliente aparecerá al abrir una conversación.
          </div>
        )}
      </div>
    </div>
  );
}
