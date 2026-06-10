import { cn } from "@/lib/utils"

/**
 * BrandLockup — logo + nombre de marca, fuente ÚNICA de la identidad visible.
 * Reemplaza las ~5 implementaciones dispersas (VoxLogo en App.tsx, el tile "A"
 * del login, el `.sb__logo`/`.sb__name` del sidebar, etc.) y fija la marca a
 * **AIRA** (corrige el bug "ARIA"/"Vox" visible — ver design/01 · P11).
 *
 * El codename interno "Vox/Connectview" se mantiene en identificadores de código;
 * esto es solo el texto de cara al usuario.
 */
function BrandLockup({
  size = 28,
  name = "AIRA",
  tagline,
  className,
}: {
  size?: number
  name?: string
  /** Texto secundario opcional (ej. "BY NOVASYS" o "Plataforma de contact center"). */
  tagline?: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          background:
            "linear-gradient(135deg, var(--accent-amber), var(--accent-pink) 70%)",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            width: size * 0.38,
            height: size * 0.38,
            borderRadius: "50%",
            background: "var(--bg-1)",
          }}
        />
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span
          className="truncate font-semibold"
          style={{
            color: "var(--text-1)",
            fontSize: size * 0.52,
            letterSpacing: "-0.01em",
          }}
        >
          {name}
        </span>
        {tagline && (
          <span
            className="truncate"
            style={{
              color: "var(--text-3)",
              fontSize: Math.max(10, size * 0.34),
              letterSpacing: "0.04em",
            }}
          >
            {tagline}
          </span>
        )}
      </div>
    </div>
  )
}

export { BrandLockup }
