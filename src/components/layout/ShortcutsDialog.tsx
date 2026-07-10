import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Download, HelpCircle } from "lucide-react";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  {
    category: "Global",
    items: [
      { keys: ["⌘", "K"], description: "Abrir la paleta de comandos" },
      { keys: ["⌘", "⇧", "D"], description: "Cambiar modo oscuro" },
      { keys: ["?"], description: "Ver atajos de teclado" },
      { keys: ["Esc"], description: "Cerrar diálogos" },
    ],
  },
  {
    category: "Navegación (estilo vim)",
    items: [
      { keys: ["G", "D"], description: "Ir a Inicio" },
      { keys: ["G", "A"], description: "Ir a Agent Desktop" },
      { keys: ["G", "M"], description: "Ir a Cola en vivo" },
      { keys: ["G", "R"], description: "Ir a Reportes" },
      { keys: ["G", "C"], description: "Ir a Grabaciones" },
      { keys: ["G", "S"], description: "Ir a Configuración" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            Ayuda
          </DialogTitle>
          <DialogDescription>
            Descarga el manual o usa los atajos para ir más rápido.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Documentación
            </h4>
            <a
              href="/docs/ARIA-Manual-de-usuario.pdf"
              download
              target="_blank"
              rel="noopener"
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-2.5 text-sm font-medium">
                <FileText className="h-4 w-4" style={{ color: "var(--teal, #158A8C)" }} />
                Manual de usuario
                <span className="text-xs font-normal text-muted-foreground">
                  · PDF · 15 secciones
                </span>
              </span>
              <Download className="h-4 w-4 text-muted-foreground" />
            </a>
          </div>
          {shortcuts.map((group) => (
            <div key={group.category}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {group.category}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.description}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <span className="text-sm">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <Kbd>{k}</Kbd>
                          {i < item.keys.length - 1 && group.category.includes("vim") && (
                            <span className="text-xs text-muted-foreground">luego</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
