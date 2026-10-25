"use client";

import { useRouter } from "next/navigation";

import {
  Bot,
  Building2,
  CircleHelp,
  Hash,
  Settings2,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LucideIcon } from "lucide-react";

export type WorkspaceView =
  | "Overview"
  | "Rooms"
  | "Agents"
  | "Documents"
  | "Knowledge"
  | "Activity"
  | "Settings";

type AppSidebarProps = {
  workspaceName: string;
  view: WorkspaceView;
  navigation: { label: WorkspaceView; icon: LucideIcon }[];
  rooms: { id: string; name: string; favorite: boolean }[];
  agentCount: number;
  onNavigate: (view: WorkspaceView) => void;
  onOpenRoom: (id: string) => void;
  onAction: (action: "room" | "invite" | "help" | "notifications") => void;
};

export function AppSidebar({
  workspaceName,
  view,
  navigation,
  rooms,
  agentCount,
  onNavigate,
  onOpenRoom,
  onAction,
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();
  function run(action: () => void) {
    setOpenMobile(false);
    action();
  }
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" tooltip={workspaceName} />}
              >
                <BrandMark />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {workspaceName}
                  </span>
                  <span className="text-xs">Agents hub · Team workspace</span>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "right"}
                align="start"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => router.push("/organizations")}
                  >
                    <Building2 />
                    Switch organisation
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => run(() => onNavigate("Settings"))}
                  >
                    <Settings2 />
                    Workspace settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => run(() => onAction("invite"))}
                  >
                    <Users />
                    Invite teammates
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navigation.map(({ label, icon: Icon }) => ({
            title: label === "Agents" ? "Agent hub" : label,
            icon: <Icon />,
            isActive: view === label,
            onClick: () => run(() => onNavigate(label)),
            badge: label === "Agents" ? agentCount : undefined,
          }))}
        />
        <NavProjects
          projects={rooms
            .filter((room) => room.favorite)
            .map((room) => ({
              id: room.id,
              name: room.name,
              icon: <Hash />,
              onClick: () => run(() => onOpenRoom(room.id)),
            }))}
          onCreate={() => run(() => onAction("room"))}
        />
        <div className="mt-auto p-2 group-data-[collapsible=icon]:hidden">
          <div className="rounded-lg border border-sidebar-border/20 p-3 text-sm">
            <Bot className="mb-2 size-5" />
            <p className="font-medium">Better, together.</p>
            <p className="mt-1 text-xs text-sidebar-foreground/70">
              Bring your people and agents into one shared space.
            </p>
          </div>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Invite teammates"
              onClick={() => run(() => onAction("invite"))}
            >
              <Users />
              <span>Invite teammates</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Help & getting started"
              onClick={() => run(() => onAction("help"))}
            >
              <CircleHelp />
              <span>Help & getting started</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser
          onSettings={() => run(() => onNavigate("Settings"))}
          onNotifications={() => run(() => onAction("notifications"))}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
