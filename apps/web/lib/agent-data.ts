import type { AvatarDesign } from '../../../shared/avatar-design';
import type { AvatarColor, AvatarIcon } from '../../../shared/agent-appearance';
export { avatarColors, avatarColorValues, avatarShapes } from '../../../shared/agent-appearance';
export type { AvatarColor, AvatarIcon, AvatarShape } from '../../../shared/agent-appearance';

export type Agent = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: AvatarColor;
  avatarIcon: AvatarIcon;
  avatarUrl?: string;
  avatarDesign?: AvatarDesign;
  rules: string[];
  status: "Working" | "Available";
};

export type AgentProfile = Pick<
  Agent,
  "name" | "role" | "color" | "avatarIcon" | "avatarUrl" | "avatarDesign" | "rules"
>;


export type AgentCreationInput = Pick<AgentProfile, "name" | "color" | "avatarIcon" | "avatarUrl" | "avatarDesign"> & {
  description: string;
};
