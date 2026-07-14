import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";
import { CampaignRowMenu, type RowMenuItem } from "@/components/campaigns/CampaignRowMenu";
import { getApiEndpoints } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { NotIntegrated } from "@/components/vox/NotIntegrated";
import { CampaignBlendBoard } from "@/components/campaigns/CampaignBlendBoard";
import { useConnections } from "@/hooks/useConnections";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useCan } from "@/hooks/usePermissions";
import { Btn, Card, Stat, Pill, Av, HeroBand, Num, Icon } from "@/components/aria";

const STATUS_TONE: Record<string, "green" | "gold" | "cyan" | "red" | "outline"> = {
  DRAFT: "outline",
  RUNNING: "green",
  PAUSED: "gold",
  COMPLETED: "cyan",
  CANCELLED: "red",
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

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}
      >
        {label}
      </div>
      <div
        className="tnum"
        style={{ fontSize: 15, fontWeight: 750, marginTop: 2, color: tone || "var(--text-1)" }}
      >
        {value}
      </div>
    </div>
  );
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
  // Crear/editar/lanzar campañas = capacidad `manage_campaigns` (Admin por
  // defecto). Un Supervisor VE la sección y su monitoreo en vivo, pero sin los
  // controles de gestión. La matriz de Seguridad puede re-escalar esto en vivo.
  const canManage = useCan("manage_campaigns");

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
          (c.sourcePhoneNumber || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [campaigns, activeTab, query]);

  const handleClone = async (campaign: Campaign, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await mutations.clone(campaign.campaignId);
      toast.success(`Clonada como "${res.name}"`);
      navigate(`/campaigns/${res.campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error clonando");
    }
  };

  const handleRelaunch = async (campaign: Campaign, e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  // Pausar / reanudar / cancelar desde el menú ⋯ de la tarjeta (mismo endpoint
  // controlCampaign que usa el detalle). Cancelar pide confirmación.
  const handleControl = async (campaign: Campaign, action: "pause" | "resume" | "cancel") => {
    const ep = getApiEndpoints();
    if (!ep?.controlCampaign) {
      toast.error("Endpoint no configurado");
      return;
    }
    if (
      action === "cancel" &&
      !(await confirm({
        title: `¿Cancelar "${campaign.name}"?`,
        description: "Se detiene la marcación; los contactos pendientes no se llamarán.",
        destructive: true,
        confirmLabel: "Cancelar campaña",
      }))
    )
      return;
    try {
      const r = await fetch(ep.controlCampaign, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.campaignId, action }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(
        action === "pause"
          ? "Campaña pausada"
          : action === "resume"
            ? "Campaña reanudada"
            : "Campaña cancelada",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo aplicar la acción");
    }
  };

  // Acciones del menú ⋯ según el estado de la campaña.
  const menuItems = (c: Campaign): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      { label: "Abrir detalle", onSelect: () => navigate(`/campaigns/${c.campaignId}`) },
    ];
    if (!canManage) return items;
    if (c.status === "RUNNING")
      items.push({ label: "Pausar", onSelect: () => handleControl(c, "pause") });
    if (c.status === "PAUSED")
      items.push({ label: "Reanudar", onSelect: () => handleControl(c, "resume") });
    items.push({ label: "Clonar", onSelect: () => handleClone(c) });
    if (c.status === "COMPLETED" || c.status === "CANCELLED")
      items.push({ label: "Relanzar (todos)", onSelect: () => handleRelaunch(c) });
    if (c.status === "RUNNING" || c.status === "PAUSED")
      items.push({
        label: "Cancelar campaña",
        destructive: true,
        onSelect: () => handleControl(c, "cancel"),
      });
    return items;
  };

  const totalReached = campaigns.reduce(
    (acc, c) => acc + (c.doneCount || 0) + (c.failedCount || 0),
    0,
  );
  const totalContacts = campaigns.reduce((acc, c) => acc + (c.totalContacts || 0), 0);
  // Solo cuenta actividad en vivo de campañas ACTIVAS (RUNNING/PAUSED) — antes
  // sumaba también contadores stale de campañas terminadas → "EN VIVO 1" con
  // "0 activas" (contacto fantasma).
  const live = campaigns.reduce(
    (acc, c) =>
      acc +
      (c.status === "RUNNING" || c.status === "PAUSED"
        ? (c.dialingCount || 0) + (c.connectedCount || 0)
        : 0),
    0,
  );

  const progressRate = totalContacts ? Math.round((totalReached / totalContacts) * 100) : 0;

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero — reemplaza el PageHeader por el lenguaje premium de ARIA
          sin perder el reporting real que vive debajo. */}
      <HeroBand
        title="Campañas outbound"
        chip={
          live > 0 ? (
            <>
              <span className="dot dot--live" /> En vivo · {live} conectados/marcando
            </>
          ) : (
            <>
              {tabCounts.active} activas · {totalReached.toLocaleString()} contactos alcanzados
            </>
          )
        }
        chipIcon={live > 0 ? "live" : "megaphone"}
        chipTone={live > 0 ? "var(--green)" : "var(--accent)"}
        right={
          <div className="row gap10">
            <Btn variant="ghost" size="sm" icon="refresh" onClick={() => refresh()}>
              Actualizar
            </Btn>
            {canManage && (
              <Btn
                variant="primary"
                size="sm"
                icon="plus"
                onClick={() => navigate("/campaigns/nueva")}
              >
                Nueva campaña
              </Btn>
            )}
          </div>
        }
      />

      {/* KPI strip — métricas reales agregadas de las campañas. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}
      >
        <Stat
          icon="megaphone"
          color="var(--accent)"
          label="Total campañas"
          value={<Num value={tabCounts.all} />}
          sub={
            tabCounts.active > 0
              ? `${tabCounts.active} ${tabCounts.active === 1 ? "activa" : "activas"}`
              : "ninguna activa"
          }
        />
        <Stat
          icon="phone"
          color="var(--cyan)"
          label="Alcance acumulado"
          value={<Num value={totalReached} />}
          sub={`de ${totalContacts.toLocaleString()} contactos`}
        />
        <Stat
          icon="handshake"
          color="var(--green)"
          label="En vivo ahora"
          value={<Num value={live} />}
          sub={live > 0 ? "conectados/marcando" : "sin actividad en vivo"}
        />
        <Stat
          icon="target"
          color="var(--gold)"
          label="Tasa de progreso"
          value={<Num value={progressRate} suffix="%" />}
          sub="acumulado"
        />
      </div>

      {/* Pilar 7 · Fase B — tablero blend en vivo (solo si hay voz activa). */}
      <CampaignBlendBoard />

      <Card
        title={
          <div className="row gap6">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`btn btn--sm ${activeTab === t.id ? "btn--soft" : "btn--ghost"}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                <span className="tnum" style={{ fontSize: 10.5, marginLeft: 4, opacity: 0.7 }}>
                  {tabCounts[t.id]}
                </span>
              </button>
            ))}
          </div>
        }
        extra={
          <div className="tb__search" style={{ maxWidth: 280, height: 30 }}>
            <Icon name="search" size={13} />
            <input
              placeholder="Buscar campañas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
        pad={false}
      >
        {loading && campaigns.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
            Cargando campañas…
          </div>
        )}

        {error && campaigns.length === 0 && (
          <div
            style={{
              margin: 16,
              padding: 16,
              borderRadius: 12,
              background: "color-mix(in srgb,var(--red) 12%,var(--bg-1))",
              color: "var(--red)",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {!loading &&
          !error &&
          visibleCampaigns.length === 0 &&
          (campaigns.length === 0 && !dataPlaneEnabled ? (
            <NotIntegrated
              title="Todavía no integraste tu base de datos"
              message="Tus campañas y sus contactos se guardan en TU cuenta AWS (BYO Data Plane). Actívala en Integraciones para crear y correr campañas."
              ctaLabel="Conectar base de datos"
              icon={<Icon name="megaphone" size={26} />}
            />
          ) : (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
              <Icon name="megaphone" size={32} style={{ opacity: 0.4 }} />
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {query
                  ? `No hay campañas que coincidan con "${query}".`
                  : campaigns.length === 0
                    ? "Sin campañas todavía. Crea la primera para empezar."
                    : "No hay campañas en este tab."}
              </div>
              {campaigns.length === 0 && (
                <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
                  <Btn variant="primary" icon="plus" onClick={() => navigate("/campaigns/nueva")}>
                    Crear primera campaña
                  </Btn>
                </div>
              )}
            </div>
          ))}

        {visibleCampaigns.length > 0 && (
          <div className="col gap12" style={{ padding: 16 }}>
            {visibleCampaigns.map((c) => {
              const pct = progressPct(c);
              const liveCount = (c.dialingCount || 0) + (c.connectedCount || 0);
              const completed = c.doneCount || 0;
              const failed = (c.failedCount || 0) + (c.noAnswerCount || 0);
              const barColor = c.status === "PAUSED" ? "var(--gold)" : "var(--cyan)";
              const isFinished = c.status === "COMPLETED" || c.status === "CANCELLED";
              return (
                <div
                  key={c.campaignId}
                  className="card card__pad row-clickable"
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/campaigns/${c.campaignId}`)}
                >
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <div className="row gap12" style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          display: "grid",
                          placeItems: "center",
                          background: "color-mix(in srgb," + barColor + " 15%,var(--bg-1))",
                          color: barColor,
                          flex: "0 0 auto",
                        }}
                      >
                        <Icon name="megaphone" size={18} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          className="trunc"
                          style={{ fontSize: 14, fontWeight: 750, color: "var(--text-1)" }}
                        >
                          {c.name}
                        </div>
                        <div className="dim tnum row gap12" style={{ fontSize: 11, marginTop: 3 }}>
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
                    <div className="row gap8" style={{ flex: "0 0 auto" }}>
                      {liveCount > 0 && (
                        <Pill tone="green" icon="live">
                          {liveCount} en vivo
                        </Pill>
                      )}
                      <Pill tone={STATUS_TONE[c.status] || "outline"}>
                        {STATUS_LABEL[c.status] || c.status}
                      </Pill>
                      <CampaignRowMenu items={menuItems(c)} />
                    </div>
                  </div>

                  <div className="row between" style={{ fontSize: 11.5, marginBottom: 5 }}>
                    {/* Bug #22/#23 — for finished campaigns "Avance" is
                        misleading; it's really the success rate. */}
                    <span
                      className="dim"
                      title={
                        isFinished
                          ? "Tasa de éxito final (Completados / total)"
                          : "Avance: cuántos contactos ya se procesaron"
                      }
                    >
                      {isFinished ? "Tasa éxito" : "Avance"}
                    </span>
                    <b className="tnum">{pct}%</b>
                  </div>
                  <div className="bar" style={{ marginBottom: 12 }}>
                    <span style={{ width: `${pct}%`, background: barColor }} />
                  </div>

                  <div className="row between wrap gap12">
                    <div className="row gap20">
                      <Metric label="Completados" value={completed} tone="var(--green)" />
                      <Metric label="Fallidos" value={failed} tone="var(--red)" />
                      <Metric
                        label="Pendientes"
                        value={Math.max(0, (c.totalContacts || 0) - completed - failed)}
                      />
                    </div>
                    <Av name={c.createdBy ?? "—"} size={26} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {confirmDialog}
    </div>
  );
}
