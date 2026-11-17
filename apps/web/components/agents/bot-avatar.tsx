"use client";

import { useEffect, useRef } from "react";
import { mountAvatar, type MountedAvatar } from "open-bot-avatar/dom";
import type { BotAvatarDesign } from "../../../../shared/avatar-design";

export function BotAvatar({ design, animated, mood }: {
  design: BotAvatarDesign;
  animated: boolean;
  mood: "idle" | "thinking" | "happy";
}) {
  const host = useRef<HTMLSpanElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);

  // Keep the renderer mounted across color/mood changes so transitions remain smooth.
  useEffect(() => () => {
    avatar.current?.destroy();
    avatar.current = null;
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const options = {
      definition: design.definition,
      color: design.color,
      mood,
      followPointer: animated,
      still: !animated,
      reducedMotion: "system" as const,
      label: "",
    };
    if (avatar.current) avatar.current.update(options);
    else avatar.current = mountAvatar(host.current, options);
  }, [design, animated, mood]);

  return <span ref={host} className="agent-shape bot-avatar" aria-hidden="true" style={{ color: design.color }} />;
}
