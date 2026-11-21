"use client";

import { useEffect, useRef } from "react";
import { mountAvatar, type MountedAvatar } from "open-bot-avatar/dom";
import type { AvatarState } from "open-bot-avatar";
import type { BotAvatarDesign } from "../../../../shared/avatar-design";

export function BotAvatar({ design, animated, mood, state }: {
  design: BotAvatarDesign;
  animated: boolean;
  mood: "idle" | "thinking" | "happy";
  state?: AvatarState;
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
      state,
      followPointer: animated && state === undefined,
      still: !animated && (!state || state === "idle"),
      reducedMotion: "system" as const,
      label: "",
    };
    if (avatar.current) avatar.current.update(options);
    else avatar.current = mountAvatar(host.current, options);
  }, [design, animated, mood, state]);

  return <span ref={host} className="agent-shape bot-avatar" aria-hidden="true" style={{ color: design.color }} />;
}
