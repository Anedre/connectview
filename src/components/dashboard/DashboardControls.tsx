import { useEffect, useRef, useState } from "react";
import * as Icon from "@/components/vox/primitives";

/**
 * DashboardControls — the Kommo-style control bar that sits at the top of the
 * executive Inicio: a segmented period switch (Hoy/Ayer/Semana/Mes) + a user
 * filter ("Todos / un agente"). Both are functional — they drive the panel's
 * data window and per-agent scoping. Theme-aware (CSS tokens only).
 */

export type Period = "today" | "yesterday" | "week" | "month";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
];

export interface DashboardControlsProps {
  period: Period;
  onPeriod: (p: Period) => void;
  /** agent usernames available to filter by */
  users: string[];
  /** null = "Todos" */
  selectedUser: string | null;
  onUser: (u: string | null) => void;
  rangeLabel?: string;
  loading?: boolean;
}

export function DashboardControls({
  period,
  onPeriod,
  users,
  selectedUser,
  onUser,
  rangeLabel,
  loading,
}: DashboardControlsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  // close the user dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = users
    .filter((u) => u.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  return (
    <div className="dash-controls">
      {/* Segmented period control */}
      <div className="dash-seg" role="tablist" aria-label="Período">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            className={`dash-seg__opt ${period === p.id ? "dash-seg__opt--active" : ""}`}
            onClick={() => onPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {rangeLabel && <span className="dash-controls__range">{rangeLabel}</span>}

      {/* User filter */}
      <div className="dash-userwrap" ref={popRef}>
        <button className="dash-userbtn" onClick={() => setOpen((o) => !o)}>
          <Icon.User size={14} />
          <span className="dash-userbtn__label">{selectedUser ?? "Todos"}</span>
          <Icon.ChevDown size={13} />
        </button>
        {open && (
          <div className="dash-userpop">
            <div className="dash-userpop__head">Filtrar por agente</div>
            <div className="dash-userpop__search">
              <Icon.Search size={13} />
              <input
                autoFocus
                placeholder="Buscar agente…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="dash-userpop__list">
              <button
                className={`dash-userpop__opt ${selectedUser === null ? "dash-userpop__opt--active" : ""}`}
                onClick={() => {
                  onUser(null);
                  setOpen(false);
                }}
              >
                <Icon.Users size={14} /> Todos los agentes
              </button>
              {filtered.map((u) => (
                <button
                  key={u}
                  className={`dash-userpop__opt ${selectedUser === u ? "dash-userpop__opt--active" : ""}`}
                  onClick={() => {
                    onUser(u);
                    setOpen(false);
                  }}
                >
                  <span className="dash-userpop__av">{u.slice(0, 1).toUpperCase()}</span>
                  {u}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="dash-userpop__empty">Sin coincidencias</div>
              )}
            </div>
          </div>
        )}
      </div>

      <span className="dash-controls__live">
        <span className="dash-controls__dot" style={{ opacity: loading ? 0.4 : 1 }} />
        {loading ? "cargando…" : "datos en vivo"}
      </span>
    </div>
  );
}
