import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as Icon from "@/components/vox/primitives";

interface Customer360MoreMenuProps {
  customerPhone: string | null;
  contactId: string | null;
  onRefreshProfile?: () => void;
}

/**
 * Small dropdown attached to the ⋯ button in the Cliente 360° header.
 * Houses the quick actions that don't deserve their own toolbar slot:
 *   - Refrescar perfil — re-runs the customer profile lookup
 *   - Copiar teléfono  — copies the customer phone to the clipboard
 *   - Copiar contactId — handy for support / debugging tickets
 *
 * Closes on outside click + ESC. Renders inline (not portal) since the
 * Cliente 360° header sits at the top of its column and there's no
 * overflow clipping concern.
 */
export function Customer360MoreMenu({
  customerPhone,
  contactId,
  onRefreshProfile,
}: Customer360MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("No se pudo copiar");
    }
    setOpen(false);
  };

  const items: Array<{
    icon: React.ReactNode;
    label: string;
    disabled?: boolean;
    onClick: () => void;
  }> = [
    {
      icon: <Icon.Refresh size={13} />,
      label: "Refrescar perfil",
      disabled: !onRefreshProfile,
      onClick: () => {
        onRefreshProfile?.();
        toast.success("Perfil refrescado");
        setOpen(false);
      },
    },
    {
      icon: <Icon.Copy size={13} />,
      label: "Copiar teléfono",
      disabled: !customerPhone,
      onClick: () =>
        customerPhone && copyToClipboard(customerPhone, "Teléfono"),
    },
    {
      icon: <Icon.Copy size={13} />,
      label: "Copiar Contact ID",
      disabled: !contactId,
      onClick: () => contactId && copyToClipboard(contactId, "Contact ID"),
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn--ghost btn--sm btn--icon"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más acciones"
      >
        <Icon.More size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 200,
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: 10,
            boxShadow: "0 14px 38px rgba(0,0,0,0.45)",
            padding: 4,
            zIndex: 60,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={it.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                background: "transparent",
                border: 0,
                borderRadius: 6,
                cursor: it.disabled ? "not-allowed" : "pointer",
                color: it.disabled ? "var(--text-3)" : "var(--text-1)",
                fontSize: 12.5,
                textAlign: "left",
                opacity: it.disabled ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-2)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 22,
                  height: 22,
                  color: "var(--text-3)",
                }}
              >
                {it.icon}
              </span>
              <span style={{ flex: 1 }}>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
