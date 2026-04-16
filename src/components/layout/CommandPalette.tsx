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
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={run(() => navigate("/"))}>
            <LayoutDashboard className="mr-2 h-4 w-4 text-blue-500" />
            Dashboard
            <CommandShortcut>G then D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/agent"))}>
            <Headset className="mr-2 h-4 w-4 text-emerald-500" />
            Agent Desktop
            <CommandShortcut>G then A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/monitoring"))}>
            <Activity className="mr-2 h-4 w-4 text-amber-500" />
            Real-time Monitoring
            <CommandShortcut>G then M</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/reports"))}>
            <BarChart3 className="mr-2 h-4 w-4 text-purple-500" />
            Reports & Analytics
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/recordings"))}>
            <Disc className="mr-2 h-4 w-4 text-pink-500" />
            Call Recordings
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/admin"))}>
            <Settings className="mr-2 h-4 w-4 text-rose-500" />
            Administration
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Agent Actions">
          <CommandItem onSelect={run(() => setAgentState("Available"))}>
            <UserCheck className="mr-2 h-4 w-4 text-emerald-500" />
            Go Available
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => setAgentState("Offline"))}>
            <UserX className="mr-2 h-4 w-4 text-slate-500" />
            Go Offline
            <CommandShortcut>O</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => toast.info("Opening number pad..."))}>
            <Phone className="mr-2 h-4 w-4 text-blue-500" />
            Make Outbound Call
          </CommandItem>
          <CommandItem onSelect={run(() => toast.info("Ending current call..."))}>
            <PhoneOff className="mr-2 h-4 w-4 text-rose-500" />
            End Current Call
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          <CommandItem onSelect={run(toggleTheme)}>
            {resolvedTheme === "dark" ? (
              <Sun className="mr-2 h-4 w-4 text-amber-500" />
            ) : (
              <Moon className="mr-2 h-4 w-4 text-indigo-500" />
            )}
            Toggle {resolvedTheme === "dark" ? "Light" : "Dark"} Mode
            <CommandShortcut>⌘⇧D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              toast.info("Keyboard shortcuts: Press ? to see all")
            )}
          >
            <HelpCircle className="mr-2 h-4 w-4 text-muted-foreground" />
            Show Keyboard Shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              toast.success("AI Assist activated", {
                description: "Amazon Q + Bedrock ready to help",
              })
            )}
          >
            <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
            Activate AI Assist
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
