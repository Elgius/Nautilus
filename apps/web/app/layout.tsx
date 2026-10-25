import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./workspace.css";
import "./agent-naming.css";
import "./workspace-theme.css";
import "./theme.css";
import "./auth.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agents hub — Your team, in sync",
  description:
    "A shared workspace for your people and AI agents. Bring context, conversations, and collective progress together with Agents hub.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
