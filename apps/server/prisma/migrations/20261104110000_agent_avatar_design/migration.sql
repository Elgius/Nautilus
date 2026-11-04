-- Store validated SVG path, color, and eye geometry for generated agent avatars.
ALTER TABLE "agent" ADD COLUMN "avatarDesign" JSONB;
