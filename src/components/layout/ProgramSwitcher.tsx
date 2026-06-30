import { useMemo, useState } from "react";
import { useProgram, type ActiveProgram } from "@/context/ProgramContext";
import { type Program, type ProgramStatus } from "@/hooks/usePrograms";
import { Stack, CaretDown, MagnifyingGlass, Check } from "@phosphor-icons/react";

/**
 * ProgramSwitcher — control global del "programa activo" en el top-bar (Pilar 1).
 * Single-select + "Todos" + "Sin programa". Scopea leads/campañas/reportes.
 */

const STATUS_DOT: Record<ProgramStatus, string> = {
  borrador: "var(--text-3)",
  activo: "var(--accent-green)",
  pausado: "var(--accent-amber)",
  cerrado: "var(--accent-cyan)",
  archivado: "var(--text-3)",
};

export function ProgramSwitcher() {
  const { programs, activeProgramId, activeProgram, setActiveProgram } = useProgram();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const label =
    activeProgramId === "all"
      ? "Todos los programas"
      : activeProgramId === "none"
        ? "Sin programa"
        : activeProgram?.name || "Programa";

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const live = programs
      .filter((p) => p.status !== "archivado")
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.code.toLowerCase().includes(needle) ||
          (p.faculty || "").toLowerCase().includes(needle)
      );
    const m = new Map<string, Program[]>();
    for (const p of live) {
      const k = p.faculty || "Sin facultad";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [programs, q]);

  const pick = (id: ActiveProgram) => {
    setActiveProgram(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="tbx__status-wrap">
      <button
        className="tbx__status"
        onClick={() => setOpen((o) => !o)}
        title="Programa activo · scopea leads, campañas y reportes"
        style={{ background: "var(--bg-3)", color: "var(--text-1)" }}
      >
        <Stack size={14} weight="fill" style={{ opacity: 0.8 }} />
        <span className="truncate" style={{ maxWidth: 170 }}>
          {label}
        </span>
        <CaretDown size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div className="tbx__menu" style={{ minWidth: 300, maxHeight: 440, overflow: "auto" }}>
          <div className="tbx__menu-head">Programa activo</div>

          <div style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--bg-1)", zIndex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--bg-3)",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            >
              <MagnifyingGlass size={14} style={{ opacity: 0.6 }} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar programa…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--text-1)",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          <button
            className={`sb__item ${activeProgramId === "all" ? "sb__item--active" : ""}`}
            style={{ margin: 0 }}
            onClick={() => pick("all")}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-cyan)", flex: "0 0 auto" }} />
            <span className="sb__label">Todos los programas</span>
            {activeProgramId === "all" && <Check size={12} />}
          </button>
          <button
            className={`sb__item ${activeProgramId === "none" ? "sb__item--active" : ""}`}
            style={{ margin: 0 }}
            onClick={() => pick("none")}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-3)", flex: "0 0 auto" }} />
            <span className="sb__label">Sin programa</span>
            {activeProgramId === "none" && <Check size={12} />}
          </button>

          {programs.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-3)" }}>
              No hay programas aún. Creá uno en <strong>Crecimiento › Programas</strong>.
            </div>
          )}

          {groups.map(([faculty, items]) => (
            <div key={faculty}>
              <div className="tbx__menu-head" style={{ opacity: 0.7 }}>
                {faculty}
              </div>
              {items.map((p) => {
                const isCur = p.programId === activeProgramId;
                return (
                  <button
                    key={p.programId}
                    className={`sb__item ${isCur ? "sb__item--active" : ""}`}
                    style={{ margin: 0 }}
                    onClick={() => pick(p.programId)}
                    title={p.code}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.status], flex: "0 0 auto" }} />
                    <span className="sb__label" style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, overflow: "hidden" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {p.code}
                        {typeof p.leadCount === "number" ? ` · ${p.leadCount} leads` : ""}
                      </span>
                    </span>
                    {isCur && <Check size={12} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />}
    </div>
  );
}
