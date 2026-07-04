import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * Hint — wrapper ergonómico sobre el Tooltip (base-ui) para poner hovers
 * informativos en cualquier elemento sin ruido: `<Hint label="…"><chip/></Hint>`.
 * Usa el `TooltipProvider` global (App.tsx) y el estilo premium `.aria-hint`
 * (tokens propios --text-1/--bg-0, no los tokens shadcn que este proyecto no
 * define). `render` monta los handlers sobre el hijo directo → no agrega DOM ni
 * rompe grids/flex. Si `label` viene vacío, pasa el hijo tal cual.
 */
export function Hint({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (label == null || label === "") return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} sideOffset={8} className="aria-hint">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
