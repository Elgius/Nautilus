import Image from "next/image";
import {
  Bot,
  Sparkles,
  Compass,
  Code2,
  BookOpen,
  ChartNoAxesCombined,
} from "lucide-react";
import type { Agent, AvatarIcon } from "@/lib/agent-data";

export const avatarIcons = {
  bot: Bot,
  sparkles: Sparkles,
  compass: Compass,
  code: Code2,
  book: BookOpen,
  chart: ChartNoAxesCombined,
} satisfies Record<AvatarIcon, typeof Bot>;

export function AgentPortrait({
  agent,
  small = false,
}: {
  agent?: Pick<Agent, "name" | "color" | "avatarIcon" | "avatarUrl">;
  small?: boolean;
}) {
  const Icon = avatarIcons[agent?.avatarIcon ?? "bot"];
  return (
    <span
      title={agent?.name}
      className={`agent-avatar agent-portrait ${agent?.color ?? "green"} ${small ? "avatar-small" : ""}`}
    >
      {agent?.avatarUrl ? (
        <Image
          src={agent.avatarUrl}
          alt=""
          fill
          sizes="80px"
          unoptimized
          className="object-cover"
        />
      ) : (
        <Icon size={small ? 13 : 18} />
      )}
    </span>
  );
}
