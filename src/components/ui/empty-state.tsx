import * as React from "react"
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * EmptyState / ErrorState — patrón único para "sin datos" y "algo falló".
 * Reemplaza las N improvisaciones `div + texto` repartidas por el código.
 * Ref: design/02-sistema-de-diseno-premium.md → primitivos.
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * ErrorState — variante de error recuperable (con reintento). Úsalo en vez de
 * dejar la pantalla en blanco o un `toast` efímero cuando una carga falla.
 */
function ErrorState({
  title = "No se pudo cargar",
  description,
  onRetry,
  retryLabel = "Reintentar",
  className,
}: {
  title?: string
  description?: React.ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <EmptyState
      className={className}
      icon={
        <span style={{ color: "var(--accent-red)" }}>
          <AlertTriangleIcon />
        </span>
      }
      title={title}
      description={description}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon />
            {retryLabel}
          </Button>
        )
      }
    />
  )
}

export { EmptyState, ErrorState }
