import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Bot, FileText, MessageSquare, MoveUpRight, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LandingMotion } from "./landing-motion";
import "./landing.css";

export const metadata: Metadata = {
  title: "Nautilus — Where teams and AI work together",
  description: "Bring your team, AI agents, conversations, and documents into one shared workspace. Keep project context close and move work forward with Nautilus.",
};

const features = [
  { number: "01", Icon: MessageSquare, label: "PROJECT ROOMS", title: "One project. One place to move it forward.", copy: "Give every project a room. Keep discussions and saved documents together, so your team can pick up the work without piecing together the conversation." },
  { number: "02", Icon: Bot, label: "AI TEAMMATES", title: "Bring AI into the work you’re already doing.", copy: "Create agents with a clear purpose and rules. Add them to a room and give them an instruction, right where your team is working." },
  { number: "03", Icon: FileText, label: "SHARED DOCUMENTS", title: "Keep the work close to the conversation.", copy: "Open saved documents alongside your room’s discussion. Review the details, make edits, and keep the next decision connected to the work." },
];

const useCases = [
  { title: "Plan your next launch", copy: "Give the launch plan, team discussion, and supporting documents a shared home.", tag: "PROJECT PLANNING" },
  { title: "Work through a big question", copy: "Bring people and agents into a room to explore an idea and develop the next steps.", tag: "TEAM COLLABORATION" },
  { title: "Move a draft forward", copy: "Keep document edits and team feedback in the same workspace, from first thoughts to the next revision.", tag: "DOCUMENT WORK" },
];

export default function LandingPage() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main-content">Skip to content</a>
      <header className="lp-nav">
        <Link href="/landing_page" className="lp-wordmark" aria-label="Nautilus home"><BrandMark />nautilus</Link>
        <nav aria-label="Main navigation"><a href="#possibilities">Platform</a><a href="#use-cases">Use cases</a><a href="#how-it-works">How it works</a></nav>
        <Link className="lp-nav-cta" href="/login">Open workspace <MoveUpRight size={16} /></Link>
      </header>
      <main id="main-content">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><span /> THE SHARED WORKSPACE FOR PEOPLE AND AI</p>
            <h1 id="hero-title">Your team. Your agents.<br /><span>Working together.</span></h1>
            <p className="lp-intro">Bring people, AI agents, and project context into one workspace. Turn scattered conversations into work your whole team can move forward.</p>
            <div className="lp-hero-actions"><Link className="lp-button" href="/login">Open your workspace <ArrowRight size={18} /></Link><a className="lp-text-link" href="#possibilities">Explore the platform <ArrowDown size={16} /></a></div>
          </div>
          <LandingMotion />
        </section>
        <div className="lp-principle"><p>Everything your team needs to work together.</p><div><span><Users /> People</span><span><Bot /> AI agents</span><span><MessageSquare /> Conversations</span><span><FileText /> Documents</span></div></div>
        <section id="possibilities" className="lp-features" aria-labelledby="features-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">SHARED CONTEXT. COLLECTIVE PROGRESS.</p><h2 id="features-title">Less time connecting the dots.<br /><span>More time doing the work.</span></h2><p>Work gets fragmented when the people, conversations, and documents live apart. Nautilus brings them into a shared room, with AI agents alongside your team.</p></div>
          <div className="lp-feature-grid">{features.map(({ number, Icon, label, title, copy }) => <article className="lp-feature" key={number}><div className="lp-feature-top"><Icon size={28} strokeWidth={1.5} /><span>{number}</span></div><p className="lp-feature-label">{label}</p><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>
        <section id="use-cases" className="lp-use-cases" aria-labelledby="use-cases-title"><div className="lp-section-heading"><p className="lp-eyebrow">BUILT AROUND YOUR WORK</p><h2 id="use-cases-title">A shared space.<br />Plenty of ways forward.</h2></div><div className="lp-use-grid">{useCases.map(({ title, copy, tag }) => <article key={tag}><p className="lp-eyebrow">{tag}</p><h3>{title}</h3><p>{copy}</p><a className="lp-text-link" href="#how-it-works">See how to get started <ArrowRight size={16} /></a></article>)}</div></section>
        <section id="how-it-works" className="lp-how" aria-labelledby="how-title">
          <div><p className="lp-eyebrow">FROM CONTEXT TO COLLABORATION</p><h2 id="how-title">Start with a room.<br /><span>Build from there.</span></h2><p>A focused space for the project, the people, and the work ahead.</p><Link className="lp-text-link" href="/login">Open your workspace <ArrowRight size={17} /></Link></div>
          <ol className="lp-steps"><li><span>01</span><div><h3>Create a project room</h3><p>Give your work a name and a place for the team to come together.</p></div></li><li><span>02</span><div><h3>Bring your team and agents</h3><p>Add the people involved and agents with a clear role to play.</p></div></li><li><span>03</span><div><h3>Move the work forward</h3><p>Discuss ideas, work on saved documents, and give agents instructions from the room.</p></div></li></ol>
        </section>
        <section className="lp-closing"><p className="lp-eyebrow">BRING IT ALL TOGETHER</p><h2>Your next project.<br /><span>Your team and AI, together.</span></h2><p>Give your work a shared home in Nautilus.</p><Link className="lp-button" href="/login">Open your workspace <ArrowRight size={18} /></Link><div className="lp-closing-orbit" aria-hidden="true" /></section>
      </main>
      <footer className="lp-footer"><Link className="lp-wordmark" href="/landing_page"><BrandMark />nautilus</Link><p>People. Agents. Progress.</p><a href="#main-content">Back to top ↑</a></footer>
    </div>
  );
}
