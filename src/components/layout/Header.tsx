import { LogOut, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";

const ROLE_COLORS: Record<string, string> = {
  Admins: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  Supervisors:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Agents:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export function Header() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />

      <div className="ml-auto flex items-center gap-3">
        <Badge
          variant="secondary"
          className={ROLE_COLORS[user.highestRole] || ""}
        >
          {user.highestRole}
        </Badge>

        <DropdownMenu>
          <DropdownMenuTrigger className="relative flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex items-center gap-2 p-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{user.username}</span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
