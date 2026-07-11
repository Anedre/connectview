import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  JOURNEY_KINDS,
  JOURNEY_PALETTE_GROUPS,
  journeyIcon,
  type JourneyKindDef,
} from "@/lib/journeyFlow";
import type { JourneyNodeKind } from "@/hooks/useJourneys";

/**
 * JourneyNodePicker — popover estilo command-palette que lista el catálogo de
 * pasos del journey (JOURNEY_KINDS por JOURNEY_PALETTE_GROUPS). Espejo del
 * NodePicker de Bots (reutiliza su CSS .fb-picker*): potencia el quick-connect
 * (arrastrar un edge al vacío) y el "+" de insertar-en-conexión. Busca por
 * label/blurb; ↑/↓ + Enter elige, Esc/click-afuera cierra. Posicionado fixed en
 * (screenX,screenY) y ajustado para no salirse del viewport.
 */
function buildEntries(query: string): { group: string; items: JourneyKindDef[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { group: string; items: JourneyKindDef[] }[] = [];
  for (const group of JOURNEY_PALETTE_GROUPS) {
    const items: JourneyKindDef[] = [];
    for (const def of Object.values(JOURNEY_KINDS)) {
      if (def.notInPalette || def.group !== group) continue;
      if (q && !def.label.toLowerCase().includes(q) && !def.blurb.toLowerCase().includes(q))
        continue;
      items.push(def);
    }
    if (items.length > 0) groups.push({ group, items });
  }
  return groups;
}

const POPOVER_W = 320;
const POPOVER_MAXH = 420;

export function JourneyNodePicker({
  screenX,
  screenY,
  onPick,
  onClose,
}: {
  screenX: number;
  screenY: number;
  onPick: (kind: JourneyNodeKind) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const groups = buildEntries(q);
  const flat = groups.flatMap((g) => g.items);
  const clampedActive = flat.length === 0 ? 0 : Math.min(active, flat.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Mantener el popover dentro del viewport (empuja arriba/izq si se sale).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 12;
    const w = el.offsetWidth || POPOVER_W;
    const h = el.offsetHeight || POPOVER_MAXH;
    let left = screenX;
    let top = screenY;
    if (left + w + margin > window.innerWidth) left = window.innerWidth - w - margin;
    if (top + h + margin > window.innerHeight) top = window.innerHeight - h - margin;
    el.style.left = `${Math.max(margin, left)}px`;
    el.style.top = `${Math.max(margin, top)}px`;
  }, [screenX, screenY, q]);

  // Click-afuera cierra. `pointerdown` en CAPTURA: el pane de React Flow frena
  // el mousedown en burbuja (para su paneo) → un listener normal no se entera.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as HTMLElement)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[clampedActive];
      if (pick) onPick(pick.kind);
    }
  };

  return (
    <div
      ref={rootRef}
      className="fb-picker"
      style={{ left: screenX, top: screenY }}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Elegir paso"
    >
      <div className="fb-picker__search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder="Buscar paso…"
        />
      </div>

      <div className="fb-picker__list">
        {groups.length === 0 && <div className="fb-picker__empty">Sin resultados</div>}
        {groups.map((g) => (
          <div key={g.group} className="fb-picker__group">
            <div className="fb-picker__group-h">{g.group}</div>
            {g.items.map((it) => {
              const idx = flat.indexOf(it);
              const Icn = journeyIcon(it.icon);
              const isActive = idx === clampedActive;
              return (
                <button
                  key={it.kind}
                  type="button"
                  className={`fb-picker__item ${isActive ? "fb-picker__item--on" : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(it.kind)}
                >
                  <span
                    className="fb-picker__icon"
                    style={{ background: `${it.accent}1a`, color: it.accent }}
                  >
                    <Icn size={15} strokeWidth={2.2} />
                  </span>
                  <span className="fb-picker__text">
                    <span className="fb-picker__label">{it.label}</span>
                    <span className="fb-picker__blurb">{it.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
