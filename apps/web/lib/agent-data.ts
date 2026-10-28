export const avatarColors = ["brown", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "gray"] as const;
export type AvatarColor = (typeof avatarColors)[number] | "coral";
export const avatarShapes = ["circle", "oval", "square", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
export type AvatarShape = (typeof avatarShapes)[number];
export type AvatarIcon =
  "bot" | "sparkles" | "compass" | "code" | "book" | "chart" | AvatarShape;

export type Agent = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: AvatarColor;
  avatarIcon: AvatarIcon;
  avatarUrl?: string;
  rules: string[];
  status: "Working" | "Available";
};

export type AgentProfile = Pick<
  Agent,
  "name" | "role" | "color" | "avatarIcon" | "avatarUrl" | "rules"
>;

