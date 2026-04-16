import { LogOut, User, Bell, Search, Command } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";

const ROLE_COLORS: Record<string, string> = {
  Admins:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900",
  Supervisors:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900",
  Agents:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
};

export function Header() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <header className="glass sticky top-0 z-40 flex h-16 items-center gap-3 border-b px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-6" />

      {/* Search bar - modern CRM style */}
      <div className="relative hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search contacts, agents, or cases..."
          className="h-9 w-full rounded-lg border bg-background/50 pl-9 pr-16 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
          <Command className="h-3 w-3" />K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Notifications */}
        <button
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background/50 text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4 transition-transform group-hover:scale-110" />
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
        </button>

        {/* Role badge */}
        <Badge
          variant="outline"
          className={`border font-medium ${ROLE_COLORS[user.highestRole] || ""}`}
        >
          {user.highestRole}
        </Badge>

        <Separator orientation="vertical" className="h-6" />

        {/* Avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="group relative flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-accent">
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-semibold text-white shadow-sm">
                {initials}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div className="hidden text-left lg:block">
              <div className="text-sm font-medium leading-tight">
                {user.username}
              </div>
              <div className="text-xs text-muted-foreground">Connect Agent</div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-semibold text-white">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {user.username}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {user.securityProfiles.map((p) => (
                  <Badge
                    key={p}
                    variant="secondary"
                    className="text-[10px] font-medium"
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2">
              <User className="h-4 w-4" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut} className="gap-2 text-rose-600">
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
