import { useMemo } from "react";
import type { PipelineConfig, PipelineViewMode } from "@/hooks/usePipelineConfig";
import type { ActiveCampaignsData } from "@/hooks/useActiveCampaigns";
import * as Icon from "@/components/vox/primitives";

export interface QueueKpis {
  /** Total contacts currently in the pipeline (not finished). */
  totalActive: number;
  /** Contacts past urgentSeconds. */
  critical: number;
  /** Average wait-in-current-stage in seconds across active contacts. */
  avgWaitSeconds: number;
  /** Longest wait-in-current-stage in seconds. */
  oldestSeconds: number;
  /** Agents available & idle. */
  agentsAvailable: number;
  /** Total agents in scope. */
  agentsTotal: number;
}

interface Props {
  config: PipelineConfig;
  onConfigChange: (patch: Partial<PipelineConfig>) => void;
  kpis: QueueKpis;
  activeCampaigns: ActiveCampaignsData | null;
  onShowSettings: () => void;
  onToggleAudit: () => void;
  auditOpen: boolean;
  onRefresh: () => void;
  loading?: boolean;
}

export function QueueManagerHeader({
  config,
  onConfigChange,
  kpis,
  activeCampaigns,
  onShowSettings,
  onToggleAudit,
  auditOpen,
  onRefresh,
  loading,
}: Props) {
  const runningCampaigns = useMemo(() => {
    const list = activeCampaigns?.campaigns || [];
    return list.filter(
      (c) => c.campaign.status === "RUNNING" || c.campaign.status === "PAUSED"
    );
  }, [activeCampaigns]);

  const onSelectMode = (mode: PipelineViewMode) => {
    if (mode !== config.viewMode) onConfigChange({ viewMode: mode });
  };

  const onSelectTab = (tab: string) => {
    if (tab !== config.activeCampaignTab)
      onConfigChange({ activeCampaignTab: tab });
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="view__head" style={{ marginBottom: 0 }}>
        <div>
          <div className="view__crumb">
            <span>Operación</span>
          </div>
          <h1 className="view__title">Cola en vivo</h1>
          <div className="view__sub row" style={{ flexWrap: "wrap", gap: 10 }}>
            <span className="row" style={{ gap: 6 }}>
              <span
                className="pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent-green)",
                  color: "var(--accent-green)",
                }}
              />
              <span style={{ color: "var(--accent-green)" }}>En vivo</span>
            </span>
            <span className="muted">·</span>
            <span>
              <span className="mono" style={{ color: "var(--text-1)" }}>
                {kpis.agentsAvailable}
              </span>{" "}
              de{" "}
              <span className="mono" style={{ color: "var(--text-1)" }}>
                {kpis.agentsTotal}
              </span>{" "}
              agentes disponibles
            </span>
            {kpis.critical > 0 && (
              <>
                <span className="muted">·</span>
                <span
                  className="row"
                  style={{ gap: 4, color: "var(--accent-red)" }}
                >
                  <Icon.Shield size={12} />
                  <span className="mono">{kpis.critical}</span>{" "}
                  cr{kpis.critical === 1 ? "ítica" : "íticas"}
                </span>
              </>
            )}
            <span className="muted">· refresh cada 3s</span>
          </div>
        </div>

        <div className="view__actions">
          <div className="tb__search" style={{ maxWidth: 280, height: 32 }}>
            <Icon.Search size={13} />
            <input
              value={config.query}
              onChange={(e) => onConfigChange({ query: e.target.value })}
              placeholder="Buscar teléfono, nombre, cola…"
            />
          </div>
          <button
            className="btn btn--ghost btn--icon"
            onClick={onShowSettings}
            title="Personalizar"
          >
            <Icon.Settings size={14} />
          </button>
          <button
            className={`btn ${auditOpen ? "" : "btn--ghost"} btn--icon`}
            onClick={onToggleAudit}
            title="Audit log"
          >
            <Icon.Note size={14} />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
          >
            <Icon.Refresh
              size={14}
              style={loading ? { animation: "spin 1s linear infinite" } : undefined}
            />
          </button>
        </div>
      </div>

      <div className="tabs" style={{ alignItems: "flex-end" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            overflowX: "auto",
            flex: 1,
            minWidth: 0,
          }}
        >
          <TabButton
            active={config.activeCampaignTab === "ALL"}
            onClick={() => onSelectTab("ALL")}
            label="Todas"
            count={runningCampaigns.length}
          />
          {runningCampaigns.map((c) => {
            const id = c.campaign.campaignId;
            const live = c.counts.dialing + c.counts.connected;
            const paused = c.campaign.status === "PAUSED";
            return (
              <TabButton
                key={id}
                active={config.activeCampaignTab === id}
                onClick={() => onSelectTab(id)}
                label={c.campaign.name}
                count={live > 0 ? live : undefined}
                dotColor={paused ? "var(--accent-amber)" : "var(--accent-green)"}
                pulse={!paused}
              />
            );
          })}
          {runningCampaigns.length === 0 && (
            <span
              style={{
                padding: "10px 14px",
                fontSize: 12,
                fontStyle: "italic",
                color: "var(--text-3)",
              }}
            >
              Sin campañas activas
            </span>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Modo de visualización"
          className="row"
          style={{ gap: 4, paddingBottom: 6 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={config.viewMode === "flow"}
            onClick={() => onSelectMode("flow")}
            className={`btn btn--sm ${config.viewMode === "flow" ? "" : "btn--ghost"}`}
            title="Vista de flujo"
          >
            <Icon.Workflow size={12} /> Flow
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={config.viewMode === "board"}
            onClick={() => onSelectMode("board")}
            className={`btn btn--sm ${config.viewMode === "board" ? "" : "btn--ghost"}`}
            title="Vista de tablero"
          >
            <Icon.Queue size={12} /> Board
          </button>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  dotColor,
  pulse,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  dotColor?: string;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tabs__tab ${active ? "tabs__tab--active" : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      {dotColor && (
        <span
          className={pulse ? "pulse" : ""}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
            color: dotColor,
            display: "inline-block",
          }}
        />
      )}
      <span style={{ maxWidth: 180 }} className="truncate">
        {label}
      </span>
      {count !== undefined && (
        <span className="count">{count}</span>
      )}
    </button>
  );
}
