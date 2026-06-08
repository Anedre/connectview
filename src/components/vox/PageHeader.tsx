import type { ReactNode } from "react";
import { Search } from "lucide-react";

/**
 * PageHeader — the unified top-bar grammar across Vox (Kommo-style, roadmap
 * design pass). Every list/section page renders the SAME structure:
 *
 *   crumb
 *   TÍTULO · [green filter pill] · [search] · count        [ …actions… ]
 *   sub
 *
 * Consistency here is the single biggest lift toward Kommo's professional feel.
 */
export function PageHeader({
  crumb,
  title,
  sub,
  count,
  filterPill,
  search,
  actions,
}: {
  crumb?: string;
  title: string;
  sub?: ReactNode;
  count?: ReactNode;
  filterPill?: string;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  actions?: ReactNode;
}) {
  return (
    <div className="view__head">
      <div>
        {crumb && (
          <div className="view__crumb">
            <span>{crumb}</span>
          </div>
        )}
        <div className="view__titlerow">
          <h1 className="view__title">{title}</h1>
          {filterPill && <span className="filter-pill">{filterPill}</span>}
          {search && (
            <label className="searchbox">
              <Search size={13} />
              <input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder || "Buscar…"}
              />
            </label>
          )}
          {count != null && <span className="view__count">{count}</span>}
        </div>
        {sub && <div className="view__sub">{sub}</div>}
      </div>
      {actions && <div className="view__actions">{actions}</div>}
    </div>
  );
}
