import { ThemeController } from "@/components/theme-settings";
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
    <html suppressHydrationWarning lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t="system";try{var v=localStorage.getItem("nautilus-theme-v1");if(v==="light"||v==="dark")t=v}catch(e){}var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=t;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"})()` }} />
      </head>
      <body className="min-h-full flex flex-col"><ThemeController />{children}</body>
    </html>
  );
}
