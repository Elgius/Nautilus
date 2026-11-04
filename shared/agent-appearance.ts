export const avatarColors = ["brown", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "gray"] as const;
export type AvatarColor = (typeof avatarColors)[number] | "coral";
export const avatarColorValues: Record<AvatarColor, string> = {
  brown: "#a77943", red: "#ff2c4b", orange: "#ff7900", amber: "#ffb500",
  green: "#00cd82", teal: "#00bfae", blue: "#0787f9", violet: "#9c5bfa",
  pink: "#fa2ca4", gray: "#898989", coral: "#c66e5c",
};
export const avatarShapes = ["circle", "oval", "square", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
export type AvatarShape = (typeof avatarShapes)[number];
export type AvatarIcon =
  "bot" | "sparkles" | "compass" | "code" | "book" | "chart" | AvatarShape;

// Transport data is validated before rendering a custom SVG design.
export type AgentAppearance = {
  color?: AvatarColor;
  avatarIcon?: AvatarIcon;
  avatarUrl?: string | null;
  avatarDesign?: unknown;
};
