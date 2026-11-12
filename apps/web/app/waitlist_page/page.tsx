import type { Metadata } from "next";
import { PrismaHero } from "@/components/ui/prisma-hero";
import "./waitlist.css";

export const metadata: Metadata = {
  title: "Nautilus — Join the waitlist",
  description: "Multiplayer documents management for businesses. Bring your team, AI agents, and documents into one shared workspace with Nautilus.",
};

export default function WaitlistPage() {
  return <main><PrismaHero /></main>;
}
