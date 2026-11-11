"use client";

import { Wifi, WifiOff, LoaderCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function RoomConnectionStatus({ joined, status }: { joined: boolean; status: string }) {
  const state = !joined ? 'disconnected' : status === 'Connected' ? 'connected'
    : status === 'Connecting…' || status === 'Reconnecting…' ? 'connecting' : 'disconnected';
  const label = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting' : 'Not connected';
  const Icon = state === 'connected' ? Wifi : state === 'connecting' ? LoaderCircle : WifiOff;
  return <TooltipProvider>
    <Tooltip>
      <TooltipTrigger className="room-connection-status" data-state={state} aria-label={label}>
        <Icon size={14} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" align="start">{label}</TooltipContent>
    </Tooltip>
    <span className="sr-only" role="status">{label}</span>
  </TooltipProvider>;
}
