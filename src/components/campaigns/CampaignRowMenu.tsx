import { useEffect, useRef, useState } from "react";
import { Btn } from "@/components/aria";

export interface RowMenuItem {
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Menú "⋯" de una tarjeta de campaña (lista). Reemplaza el botón muerto que solo
 * hacía stopPropagation. Mismo patrón que Customer360MoreMenu: cierra en click
 * afuera + ESC, y hace stopPropagation para no disparar el onClick de la tarjeta
 * (que navega al detalle). Los items se arman según el estado de la campaña.
 */
export function CampaignRowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <Btn
        variant="ghost"
        size="sm"
        icon="more"
        title="Más acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      />
      {open && (
        <div role="menu" className="camp-rowmenu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={`camp-rowmenu__item ${it.destructive ? "camp-rowmenu__item--danger" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (it.disabled) return;
                it.onSelect();
                setOpen(false);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
