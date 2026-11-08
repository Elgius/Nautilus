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
  loading,
  error,
  onRetry,
}: {
  projects: {
    id: string;
    name: string;
    icon: ReactNode;
    onClick: () => void;
  }[];
  onCreate: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
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
      {loading && <p role="status" className="px-2 py-1 text-xs text-sidebar-foreground/70">Loading starred rooms…</p>}
      {error && <div role="alert" className="px-2 py-1 text-xs text-sidebar-foreground/70"><p>{error}</p><button type="button" className="mt-1 underline" onClick={onRetry}>Retry starred rooms</button></div>}
      {!loading && !error && projects.length === 0 && (
        <p className="px-2 py-1 text-xs text-sidebar-foreground/70">
          Star a room to keep it here.
        </p>
      )}
    </SidebarGroup>
  );
}
