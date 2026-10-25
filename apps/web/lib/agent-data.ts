export type AvatarColor = "violet" | "coral" | "blue" | "green";
export type AvatarIcon =
  "bot" | "sparkles" | "compass" | "code" | "book" | "chart";

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

