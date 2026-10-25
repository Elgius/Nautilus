"use client";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavProjects({
  projects,
  onCreate,
}: {
  projects: {
    id: string;
    name: string;
    icon: ReactNode;
    onClick: () => void;
  }[];
  onCreate: () => void;
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Starred rooms</SidebarGroupLabel>
      <SidebarGroupAction title="Create room" onClick={onCreate}>
        <Plus />
        <span className="sr-only">Create room</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {projects.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton onClick={item.onClick}>
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {projects.length === 0 && (
        <p className="px-2 py-1 text-xs text-sidebar-foreground/70">
          Star a room to keep it here.
        </p>
      )}
    </SidebarGroup>
  );
}
