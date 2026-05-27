import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Headset,
  Activity,
  BarChart3,
  Disc,
  Settings,
  Phone,
  PhoneOff,
  UserCheck,
  UserX,
  Sparkles,
  Moon,
  Sun,
  HelpCircle,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { toast } from "sonner";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toggleTheme, resolvedTheme } = useTheme();

  // Global ⌘K / Ctrl+K handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const setAgentState = (stateName: string) => {
    try {
      if (typeof connect !== "undefined" && connect.agent) {
        connect.agent((agent) => {
          const states = agent.getAgentStates();
          const target = states.find((s) => s.name === stateName);
          if (target) {
            agent.setState(target, {
              success: () => toast.success(`Status changed to ${stateName}`),
              failure: () => toast.error(`Failed to change status`),
            });
          }
        });
      }
    } catch {
      toast.error("Could not change agent state");
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Escribe un comando o búsqueda…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Navegación">
          <CommandItem onSelect={run(() => navigate("/"))}>
            <LayoutDashboard className="mr-2 h-4 w-4 text-blue-500" />
            Inicio
            <CommandShortcut>G luego D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/agent"))}>
            <Headset className="mr-2 h-4 w-4 text-emerald-500" />
            Agent Desktop
            <CommandShortcut>G luego A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/queue"))}>
            <Activity className="mr-2 h-4 w-4 text-amber-500" />
            Cola en vivo
            <CommandShortcut>G luego Q</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/campaigns"))}>
            <BarChart3 className="mr-2 h-4 w-4 text-orange-500" />
            Campañas
            <CommandShortcut>G luego C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/reports"))}>
            <BarChart3 className="mr-2 h-4 w-4 text-purple-500" />
            Reportes
            <CommandShortcut>G luego R</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/recordings"))}>
            <Disc className="mr-2 h-4 w-4 text-pink-500" />
            Grabaciones
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/admin"))}>
            <Settings className="mr-2 h-4 w-4 text-rose-500" />
            Configuración
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Acciones del agente">
          <CommandItem onSelect={run(() => setAgentState("Available"))}>
            <UserCheck className="mr-2 h-4 w-4 text-emerald-500" />
            Marcarme Disponible
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => setAgentState("Offline"))}>
            <UserX className="mr-2 h-4 w-4 text-slate-500" />
            Marcarme Offline
            <CommandShortcut>O</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => toast.info("Abriendo marcador…"))}>
            <Phone className="mr-2 h-4 w-4 text-blue-500" />
            Llamada saliente
          </CommandItem>
          <CommandItem onSelect={run(() => toast.info("Terminando llamada actual…"))}>
            <PhoneOff className="mr-2 h-4 w-4 text-rose-500" />
            Colgar llamada actual
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Preferencias">
          <CommandItem onSelect={run(toggleTheme)}>
            {resolvedTheme === "dark" ? (
              <Sun className="mr-2 h-4 w-4 text-amber-500" />
            ) : (
              <Moon className="mr-2 h-4 w-4 text-indigo-500" />
            )}
            Cambiar a modo {resolvedTheme === "dark" ? "claro" : "oscuro"}
            <CommandShortcut>Ctrl ⇧ D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              toast.info("Atajos de teclado: presiona ? para verlos")
            )}
          >
            <HelpCircle className="mr-2 h-4 w-4 text-muted-foreground" />
            Ver atajos de teclado
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              toast.success("AI Assist activado", {
                description: "Amazon Q + Bedrock listos para ayudar",
              })
            )}
          >
            <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
            Activar AI Assist
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
