import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { useTopBarActions } from "@/components/layout/TopBarSlot";

/**
 * PageHeader — toolbar fino de cada sección. Con el `AppTopBar` conectado al
 * sidebar:
 *  - el **título y subtítulo** ya NO se renderizan (el breadcrumb los cubre), y
 *  - las **acciones** se "suben" al top bar (a la derecha, junto al estado),
 *    como en el mockup — vía `useTopBarActions`.
 *
 * Lo que queda aquí es el toolbar funcional: filtro · tabs · búsqueda · métrica.
 * Si no queda nada de eso, el header no renderiza (evita una barra vacía).
 * `crumb`/`title`/`sub` se mantienen en la API para no romper las páginas.
 */
export function PageHeader({
  count,
  filterPill,
  search,
  tabs,
  actions,
}: {
  crumb?: string;
  title?: ReactNode;
  sub?: ReactNode;
  count?: ReactNode;
  filterPill?: string;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** Pestañas/segmentos inline (Día/Semana/Mes, Tablero/Tabla…). */
  tabs?: ReactNode;
  actions?: ReactNode;
}) {
  // Sube las acciones al top bar (chrome). Se actualizan en cada render para que
  // el estado de los botones (disabled/loading) quede fresco.
  useTopBarActions(actions ?? null, [actions]);

  const hasContent = !!(filterPill || tabs || search || count != null);
  if (!hasContent) return null;

  return (
    <div className="phead">
      <div className="phead__row">
        {filterPill && (
          <span className="phead__pill">
            <span className="phead__pill-dot" />
            {filterPill}
          </span>
        )}
        {tabs && <div className="phead__tabs">{tabs}</div>}
        {search && (
          <label className="phead__search">
            <Search size={13} />
            <input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder || "Buscar…"}
            />
          </label>
        )}
        {count != null && <span className="phead__count">{count}</span>}
      </div>
    </div>
  );
}
