"use client";
import { Bell, ChevronsUpDown, LogOut, Settings2 } from "lucide-react";
import { useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { errorMessage, signOut } from "@/lib/auth-client";
import { initials } from "@/lib/auth-types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function NavUser({
  onSettings,
  onNotifications,
}: {
  onSettings: () => void;
  onNotifications: () => void;
}) {
  const { isMobile } = useSidebar();
  const { session } = useWorkspaceSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      await signOut();
    } catch (error) {
      setError(errorMessage(error));
      setPending(false);
    }
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" tooltip={session.user.name} />}
          >
            <Avatar>
              <AvatarFallback>{initials(session.user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{session.user.name}</span>
              <span className="truncate text-xs">{session.user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{session.user.name}</DropdownMenuLabel>
              <DropdownMenuItem onClick={onSettings}>
                <Settings2 />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onNotifications}>
                <Bell />
                Notifications
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} disabled={pending}>
                <LogOut />
                {pending ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {error && (
          <p className="px-2 py-1 text-xs" role="alert">
            {error}
          </p>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
