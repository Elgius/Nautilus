"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavMain({
  items,
}: {
  items: {
    title: string;
    icon: ReactNode;
    isActive: boolean;
    onClick: () => void;
    href: string;
    onPrefetch?: () => void;
    badge?: number;
  }[];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              render={<Link href={item.href} prefetch onMouseEnter={item.onPrefetch} onFocus={item.onPrefetch} />}
              tooltip={item.title}
              isActive={item.isActive}
              aria-current={item.isActive ? "page" : undefined}
              onClick={item.onClick}
            >
              {item.icon}
              <span>{item.title}</span>
            </SidebarMenuButton>
            {item.badge !== undefined && (
              <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
