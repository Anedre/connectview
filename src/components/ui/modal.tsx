import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

/**
 * Modal — superposición accesible de UNA pieza (focus-trap, Esc, restore-focus
 * vía base-ui) con el scrim y la sombra tokenizados del design system.
 * Úsalo en vez de los overlays manuales (`position:fixed` + div sin a11y).
 * `ConfirmDialog` se construye encima de esto.
 *
 * Ref: design/02-sistema-de-diseno-premium.md → primitivos · Modal.
 */
function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  showClose: _showClose,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  showClose?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-[var(--z-overlay)] supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          style={{ background: "var(--scrim)" }}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-[var(--z-modal)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          style={{
            background: "var(--bg-1)",
            color: "var(--text-1)",
            boxShadow: "var(--shadow-modal)",
          }}
        >
          {title && (
            <DialogPrimitive.Title className="text-base leading-snug font-semibold">
              {title}
            </DialogPrimitive.Title>
          )}
          {description && (
            <DialogPrimitive.Description
              className="mt-1.5 text-sm"
              style={{ color: "var(--text-2)" }}
            >
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
          {footer && (
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export { Modal }
