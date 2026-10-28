"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import {
  Bot,
  Sparkles,
  Compass,
  Code2,
  BookOpen,
  ChartNoAxesCombined,
} from "lucide-react";
import { avatarShapes, type Agent, type AvatarIcon, type AvatarShape } from "@/lib/agent-data";

export const avatarIcons = {
  bot: Bot,
  sparkles: Sparkles,
  compass: Compass,
  code: Code2,
  book: BookOpen,
  chart: ChartNoAxesCombined,
} satisfies Partial<Record<AvatarIcon, typeof Bot>>;

const shapePaths: Record<AvatarShape, string> = {
  circle: "M50 4a46 46 0 1 0 0 92 46 46 0 1 0 0-92Z",
  oval: "M50 12C20 12 3 31 3 53s21 35 47 35 47-13 47-35S80 12 50 12Z",
  square: "M22 9h56q13 0 13 13v56q0 13-13 13H22Q9 91 9 78V22Q9 9 22 9Z",
  pill: "M33 20h34a30 30 0 0 1 0 60H33a30 30 0 0 1 0-60Z",
  triangle: "M42 10q8-13 16 0l37 66q8 15-9 15H14Q-3 91 5 76Z",
  hexagon: "M43 5q7-4 14 0l30 18q7 4 7 12v31q0 8-7 12L57 96q-7 4-14 0L13 78q-7-4-7-12V35q0-8 7-12Z",
  cloud: "M22 82C0 82-2 57 13 47 7 27 26 11 43 20 58 7 80 18 80 35c24 4 25 34 7 40-7 16-25 18-37 10-10 8-22 5-28-3Z",
  drop: "M50 1C40 14 10 45 10 62a40 36 0 0 0 80 0C90 45 60 14 50 1Z",
};

export function isAvatarShape(icon: AvatarIcon): icon is AvatarShape {
  return (avatarShapes as readonly string[]).includes(icon);
}

export function AgentShape({ shape, animated = false }: { shape: AvatarShape; animated?: boolean }) {
  const motion = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!animated || !motion.current) return;
    const element = motion.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let blinkTimer: number | undefined;
    let openEyesTimer: number | undefined;
    let glanceTimer: number | undefined;
    let pointerFrame: number | undefined;
    let lastPointerAt = 0;

    function look(x: number, y: number) {
      element.style.setProperty("--eye-x", `${x}px`);
      element.style.setProperty("--eye-y", `${y}px`);
    }
    function scheduleBlink() {
      blinkTimer = window.setTimeout(() => {
        element.dataset.blinking = "true";
        openEyesTimer = window.setTimeout(() => {
          delete element.dataset.blinking;
          scheduleBlink();
        }, 180);
      }, 2500 + Math.random() * 4500);
    }
    function scheduleGlance() {
      glanceTimer = window.setTimeout(() => {
        if (Date.now() - lastPointerAt > 2500) look(Math.random() * 6 - 3, Math.random() * 4 - 2);
        scheduleGlance();
      }, 2200 + Math.random() * 2800);
    }
    function stop() {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(openEyesTimer);
      window.clearTimeout(glanceTimer);
      if (pointerFrame !== undefined) window.cancelAnimationFrame(pointerFrame);
      pointerFrame = undefined;
      delete element.dataset.blinking;
      element.dataset.motion = "paused";
      look(0, 0);
    }
    function syncMotion() {
      stop();
      if (reducedMotion.matches || document.hidden) return;
      element.dataset.motion = "active";
      scheduleBlink();
      scheduleGlance();
    }
    function followPointer(event: PointerEvent) {
      if (reducedMotion.matches || document.hidden || event.pointerType !== "mouse") return;
      lastPointerAt = Date.now();
      if (pointerFrame !== undefined) window.cancelAnimationFrame(pointerFrame);
      pointerFrame = window.requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const x = (event.clientX - bounds.left - bounds.width / 2) / (window.innerWidth / 2);
        const y = (event.clientY - bounds.top - bounds.height / 2) / (window.innerHeight / 2);
        look(Math.max(-4, Math.min(4, x * 4)), Math.max(-3, Math.min(3, y * 3)));
        pointerFrame = undefined;
      });
    }

    element.style.setProperty("--avatar-idle-duration", `${3.8 + Math.random() * 1.6}s`);
    syncMotion();
    reducedMotion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    document.addEventListener("pointermove", followPointer, { passive: true });
    return () => {
      stop();
      reducedMotion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      document.removeEventListener("pointermove", followPointer);
    };
  }, [animated]);

  const avatar = (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className="agent-shape">
      <g className="agent-shape-body">
        <path d={shapePaths[shape]} fill="currentColor" />
        <g className="agent-shape-gaze">
          <g fill="#050505" className="agent-shape-eyes">
            <ellipse cx="38" cy="56" rx="5" ry="7" />
            <ellipse cx="64" cy="56" rx="5" ry="7" />
          </g>
        </g>
      </g>
    </svg>
  );
  return animated ? <span ref={motion} className="agent-shape-motion" aria-hidden="true">{avatar}</span> : avatar;
}

export function AgentPortrait({
  agent,
  small = false,
  animated = false,
}: {
  agent?: Pick<Agent, "name" | "color" | "avatarIcon" | "avatarUrl">;
  small?: boolean;
  animated?: boolean;
}) {
  const icon = agent?.avatarIcon ?? "bot";
  const shape = isAvatarShape(icon) ? icon : null;
  const Icon = avatarIcons[icon as keyof typeof avatarIcons] ?? Bot;
  return (
    <span
      title={agent?.name}
      className={`agent-avatar agent-portrait ${agent?.color ?? "green"} ${shape && !agent?.avatarUrl ? "agent-shape-portrait" : ""} ${small ? "avatar-small" : ""}`}
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
      ) : shape ? (
        <AgentShape key={`${shape}-${agent?.color}`} shape={shape} animated={animated && !small} />
      ) : (
        <Icon size={small ? 13 : 18} />
      )}
    </span>
  );
}
