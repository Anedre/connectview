import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * IconButton — botón de SOLO icono con `aria-label` OBLIGATORIO y hit-area
 * accesible (≥36px; default 40px). Reemplaza los `.tb__iconbtn` / `.btn--icon`
 * ad-hoc y los `<Icon onClick>` sueltos (que no eran focuseables).
 *
 * Ref: design/02-sistema-de-diseno-premium.md → primitivos · IconButton.
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        soft: "bg-secondary text-foreground hover:bg-accent",
        solid: "bg-primary text-primary-foreground hover:bg-primary/85",
      },
      size: {
        sm: "size-9", // 36px (denso; ≥ WCAG 2.5.8)
        md: "size-10", // 40px (default; objetivo del brief)
        lg: "size-11", // 44px
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
)

type IconButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Nombre accesible — OBLIGATORIO (no usar solo `title`). */
    "aria-label": string
  }

function IconButton({ className, variant, size, ...props }: IconButtonProps) {
  return (
    <button
      data-slot="icon-button"
      type={props.type ?? "button"}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { IconButton, iconButtonVariants }
