import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";
import { formatDistanceToNow } from "date-fns";
import * as Icon from "@/components/vox/primitives";
import {
  Avatar,
  Card,
  CardBody,
  Kpi,
} from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import { NotIntegrated } from "@/components/vox/NotIntegrated";
import { useConnections } from "@/hooks/useConnections";
import { useConfirm } from "@/components/ui/confirm-dialog";

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "",
  RUNNING: "chip--green",
  PAUSED: "chip--amber",
  COMPLETED: "chip--cyan",
  CANCELLED: "chip--red",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  RUNNING: "En curso",
  PAUSED: "Pausada",
  COMPLETED: "Terminada",
  CANCELLED: "Cancelada",
};

type TabId = "active" | "drafts" | "finished" | "all";

const TABS: Array<{ id: TabId; label: string; statuses: string[] }> = [
  { id: "active", label: "Activas", statuses: ["RUNNING", "PAUSED"] },
  { id: "drafts", label: "Borradores", statuses: ["DRAFT"] },
  { id: "finished", label: "Terminadas", statuses: ["COMPLETED", "CANCELLED"] },
  { id: "all", label: "Todas", statuses: [] },
];

function progressPct(c: Campaign): number {
  const total = Number(c.totalContacts || 0);
  if (!total) return 0;
  const done = Number(c.doneCount || 0) + Number(c.failedCount || 0);
  return Math.round((done / total) * 100);
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const { campaigns, loading, error, refresh } = useCampaigns(5000);
  const { config } = useConnections();
  // Las campañas/contactos persisten en la base de datos del tenant (BYO Data
  // Plane). Sin ella, mostramos "no integrado" en vez del empty normal.
  const dataPlaneEnabled = !!config?.connect?.dataPlaneEnabled;
  const [activeTab, setActiveTab] = useState<TabId>("active");
  const [query, setQuery] = useState("");
  const mutations = useCampaignMutations();
  const { confirm, confirmDialog } = useConfirm();

  const tabCounts = useMemo(() => {
    const acc: Record<TabId, number> = {
      active: 0,
      drafts: 0,
      finished: 0,
      all: campaigns.length,
    };
    for (const c of campaigns) {
      if (c.status === "RUNNING" || c.status === "PAUSED") acc.active += 1;
      else if (c.status === "DRAFT") acc.drafts += 1;
      else acc.finished += 1;
    }
    return acc;
  }, [campaigns]);

  const visibleCampaigns = useMemo(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    let list = campaigns;
    if (tab && tab.statuses.length > 0) {
      list = list.filter((c) => tab.statuses.includes(c.status));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.description || "").toLowerCase().includes(q) ||
          (c.sourcePhoneNumber || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [campaigns, activeTab, query]);

  const handleClone = async (e: React.MouseEvent, campaign: Campaign) => {
    e.stopPropagation();
    try {
      const res = await mutations.clone(campaign.campaignId);
      toast.success(`Clonada como "${res.name}"`);
      navigate(`/campaigns/${res.campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error clonando");
    }
  };

  const handleRelaunch = async (e: React.MouseEvent, campaign: Campaign) => {
    e.stopPropagation();
    if (
      !(await confirm({
        title: `¿Relanzar "${campaign.name}" con TODOS los contactos?`,
        destructive: true,
        confirmLabel: "Relanzar",
      }))
    )
      return;
    try {
      const res = await mutations.relaunch(campaign.campaignId, "all");
      toast.success(`Relanzada · ${res.rowsReset} contactos reseteados`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error relanzando");
    }
  };

  const totalReached = campaigns.reduce(
    (acc, c) => acc + (c.doneCount || 0) + (c.failedCount || 0),
    0
  );
  const totalContacts = campaigns.reduce(
    (acc, c) => acc + (c.totalContacts || 0),
    0
  );
  // Solo cuenta actividad en vivo de campañas ACTIVAS (RUNNING/PAUSED) — antes
  // sumaba también contadores stale de campañas terminadas → "EN VIVO 1" con
  // "0 activas" (contacto fantasma).
  const live = campaigns.reduce(
    (acc, c) =>
      acc +
      (c.status === "RUNNING" || c.status === "PAUSED"
        ? (c.dialingCount || 0) + (c.connectedCount || 0)
        : 0),
    0
  );

  return (
    <div className="view">
      <PageHeader
        crumb="Crecimiento"
        title="Campañas outbound"
        filterPill="Todos"
        count={`${campaigns.length} campañas`}
        sub={
          <>
            {tabCounts.active} activas · {totalReached.toLocaleString()} contactos alcanzados
          </>
        }
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Buscar campaña…",
        }}
        actions={
          <>
            <button className="btn">
              <Icon.Megaphone size={14} /> Plantillas
            </button>
            <button className="btn btn--primary" onClick={() => navigate("/campaigns/nueva")}>
              <Icon.Plus size={14} /> Nueva campaña
            </button>
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label="Total campañas"
          value={String(tabCounts.all)}
          delta={
            tabCounts.active > 0
              ? `${tabCounts.active} ${
                  tabCounts.active === 1 ? "activa" : "activas"
                }`
              : "ninguna activa"
          }
          // Bug #21 — only show an up-arrow when there's actually
          // something trending up. With 0 activas the arrow is noise.
          deltaDir={tabCounts.active > 0 ? "up" : "flat"}
        />
        <Kpi
          label="Alcance acumulado"
          value={totalReached.toLocaleString()}
          delta={`de ${totalContacts.toLocaleString()} contactos`}
          deltaDir="flat"
        />
        <Kpi
          label="En vivo ahora"
          value={String(live)}
          delta={
            live > 0 ? "conectados/marcando" : "sin actividad en vivo"
          }
          deltaDir={live > 0 ? "up" : "flat"}
          color="var(--accent-green)"
        />
        <Kpi
          label="Tasa de progreso"
          value={`${
            totalContacts ? Math.round((totalReached / totalContacts) * 100) : 0
          }%`}
          delta="acumulado"
          deltaDir="flat"
        />
      </div>

      <div style={{ height: 16 }} />

      <Card>
        <div className="card__head" style={{ flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 6 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`btn btn--sm ${activeTab === t.id ? "" : "btn--ghost"}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                <span className="mono" style={{ fontSize: 10.5, marginLeft: 4, opacity: 0.7 }}>
                  {tabCounts[t.id]}
                </span>
              </button>
            ))}
          </div>
          <div className="tb__search" style={{ maxWidth: 280, height: 30, marginLeft: "auto" }}>
            <Icon.Search size={13} />
            <input
              placeholder="Buscar campañas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <CardBody flush>
          {loading && campaigns.length === 0 && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12.5,
              }}
            >
              Cargando campañas…
            </div>
          )}

          {error && campaigns.length === 0 && (
            <div
              style={{
                padding: 16,
                background: "var(--accent-red-soft)",
                color: "var(--accent-red)",
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && visibleCampaigns.length === 0 &&
            (campaigns.length === 0 && !dataPlaneEnabled ? (
              <NotIntegrated
                title="Todavía no integraste tu base de datos"
                message="Tus campañas y sus contactos se guardan en TU cuenta AWS (BYO Data Plane). Activala en Integraciones para crear y correr campañas."
                ctaLabel="Conectar base de datos"
                icon={<Icon.Megaphone size={26} />}
              />
            ) : (
              <div
                style={{
                  padding: 48,
                  textAlign: "center",
                  color: "var(--text-3)",
                }}
              >
                <Icon.Megaphone size={32} style={{ opacity: 0.4 }} />
                <div style={{ marginTop: 12, fontSize: 13 }}>
                  {query
                    ? `No hay campañas que coincidan con "${query}".`
                    : campaigns.length === 0
                    ? "Sin campañas todavía. Crea la primera para empezar."
                    : "No hay campañas en este tab."}
                </div>
                {campaigns.length === 0 && (
                  <button
                    className="btn btn--primary"
                    style={{ marginTop: 16 }}
                    onClick={() => navigate("/campaigns/nueva")}
                  >
                    <Icon.Plus size={14} /> Crear primera campaña
                  </button>
                )}
              </div>
            ))}

          {visibleCampaigns.map((c) => {
            const pct = progressPct(c);
            const liveCount = (c.dialingCount || 0) + (c.connectedCount || 0);
            const completed = c.doneCount || 0;
            const failed = (c.failedCount || 0) + (c.noAnswerCount || 0);
            return (
              <div
                key={c.campaignId}
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border-1)",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/campaigns/${c.campaignId}`)}
              >
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                    <span
                      className={`chip ${STATUS_CHIP[c.status] || ""}`}
                      style={{ minWidth: 84, justifyContent: "center" }}
                    >
                      <span className="dot" />
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="truncate"
                        style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-1)" }}
                      >
                        {c.name}
                      </div>
                      <div
                        className="muted mono"
                        style={{ fontSize: 11, display: "flex", gap: 10 }}
                      >
                        <span>
                          {completed + failed} / {c.totalContacts}
                        </span>
                        {c.sourcePhoneNumber && <span>{c.sourcePhoneNumber}</span>}
                        {c.createdAt && (
                          <span>
                            {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 12 }}>
                    {liveCount > 0 && (
                      <span className="chip chip--green">
                        <span
                          className="pulse"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "currentColor",
                          }}
                        />
                        {liveCount} en vivo
                      </span>
                    )}
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      onClick={(e) => handleClone(e, c)}
                      disabled={mutations.pending}
                      title="Clonar"
                    >
                      <Icon.Plus size={14} />
                    </button>
                    {(c.status === "COMPLETED" || c.status === "CANCELLED") && (
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        onClick={(e) => handleRelaunch(e, c)}
                        disabled={mutations.pending}
                        title="Relanzar"
                      >
                        <Icon.Refresh size={14} />
                      </button>
                    )}
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      title="Más"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon.More size={14} />
                    </button>
                  </div>
                </div>
                <div className="bar">
                  <div
                    style={{
                      width: `${pct}%`,
                      background:
                        c.status === "PAUSED"
                          ? "var(--accent-amber)"
                          : "var(--accent-cyan)",
                    }}
                  />
                </div>
                <div
                  className="row"
                  style={{ justifyContent: "space-between", marginTop: 8, fontSize: 11 }}
                >
                  <span
                    className="muted"
                    title={
                      c.status === "COMPLETED" || c.status === "CANCELLED"
                        ? "Tasa de éxito final (Completados / total)"
                        : "Avance: cuántos contactos ya se procesaron"
                    }
                  >
                    {/* Bug #22/#23 — for finished campaigns "Avance" is
                        misleading; it's really the success rate. */}
                    {c.status === "COMPLETED" || c.status === "CANCELLED"
                      ? "Tasa éxito"
                      : "Avance"}{" "}
                    <span className="mono" style={{ color: "var(--text-1)" }}>
                      {pct}%
                    </span>
                  </span>
                  <span className="muted">
                    Completados{" "}
                    <span className="mono" style={{ color: "var(--accent-green)" }}>
                      {completed}
                    </span>
                  </span>
                  <span className="muted">
                    Fallidos{" "}
                    <span className="mono" style={{ color: "var(--accent-red)" }}>
                      {failed}
                    </span>
                  </span>
                  <span className="muted">
                    Pendientes{" "}
                    <span className="mono" style={{ color: "var(--text-1)" }}>
                      {Math.max(0, (c.totalContacts || 0) - completed - failed)}
                    </span>
                  </span>
                  <Avatar name={c.createdBy ?? "—"} size="sm" />
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      {confirmDialog}
    </div>
  );
}
