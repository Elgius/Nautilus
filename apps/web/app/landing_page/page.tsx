import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Bot, FileText, Layers3, MessageSquare, MoveUpRight, Sparkles, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LandingMotion } from "./landing-motion";
import "./landing.css";

export const metadata: Metadata = {
  title: "Nautilus — Room for your next big idea",
  description: "Bring your people, AI agents, conversations, and documents together in one shared workspace.",
};

const features = [
  { number: "01", Icon: MessageSquare, title: "A room for every idea.", copy: "Give each project a shared home. Keep the conversation, context, and next steps together." },
  { number: "02", Icon: Bot, title: "Meet your new teammates.", copy: "Bring AI agents into your workspace, with profiles and roles that fit the way your team works." },
  { number: "03", Icon: FileText, title: "Keep the context close.", copy: "Bring your documents into the conversation. Spend less time looking for the work and more time moving it forward." },
];

export default function LandingPage() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main-content">Skip to content</a>
      <header className="lp-nav">
        <Link href="/landing_page" className="lp-wordmark" aria-label="Nautilus home"><BrandMark />nautilus<span className="lp-wordmark-dot">®</span></Link>
        <nav aria-label="Main navigation"><a href="#possibilities">The workspace</a><a href="#how-it-works">How it works</a></nav>
        <Link className="lp-nav-cta" href="/login">Open workspace <MoveUpRight size={15} /></Link>
      </header>
      <main id="main-content">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><span /> PEOPLE + AGENTS. ONE SHARED SPACE.</p>
            <h1 id="hero-title">Big ideas.<br />Better company.<br /><span>One workspace.</span></h1>
            <p className="lp-intro">A little less scattered. A lot more connected. Bring your people and AI agents together, and give your best work room to happen.</p>
            <div className="lp-hero-actions"><Link className="lp-button" href="/login">Find your flow <ArrowRight size={18} /></Link><a className="lp-text-link" href="#possibilities">Take a look around <ArrowDown size={16} /></a></div>
            <div className="lp-hero-note"><span className="lp-mini-avatars"><span>Y</span><Bot size={15} /><Users size={15} /></span><span>Human curiosity. A little AI possibility.</span></div>
          </div>
          <LandingMotion />
        </section>
        <div className="lp-principle"><span>A SHARED SPACE FOR</span><p>the thinkers <Sparkles /> the doers <Layers3 /> the next big thing <ArrowRight /></p></div>
        <section id="possibilities" className="lp-features" aria-labelledby="features-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">LESS FRICTION. MORE MOMENTUM.</p><h2 id="features-title">Everything in orbit.<br /><span>Nothing lost in space.</span></h2><p>Good work starts with shared context. Make space for the conversations, teammates, and ideas that move it forward.</p></div>
          <div className="lp-feature-grid">{features.map(({ number, Icon, title, copy }) => <article className="lp-feature" key={number}><div className="lp-feature-top"><Icon size={25} strokeWidth={1.5} /><span>{number}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>
        <section id="how-it-works" className="lp-how" aria-labelledby="how-title">
          <div><p className="lp-eyebrow">FROM A SPARK TO SOMETHING SHARED</p><h2 id="how-title">Make room.<br />Make progress.</h2><p>No two teams think alike. Start with a room and make it your own.</p><Link className="lp-text-link" href="/login">Step inside <ArrowRight size={17} /></Link></div>
          <ol className="lp-steps"><li><span>01</span><div><h3>Give your idea a home</h3><p>Create a room around a project, a question, or whatever comes next.</p></div></li><li><span>02</span><div><h3>Bring good company</h3><p>Invite your teammates and add agents with a role to play.</p></div></li><li><span>03</span><div><h3>Keep moving, together</h3><p>Share context, explore ideas, and keep your work in one place.</p></div></li></ol>
        </section>
        <section className="lp-closing"><p className="lp-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h2>Room to think.<br /><span>Company to create.</span></h2><Link className="lp-button" href="/login">Open your workspace <ArrowRight size={18} /></Link><div className="lp-closing-orbit" aria-hidden="true" /></section>
      </main>
      <footer className="lp-footer"><Link className="lp-wordmark" href="/landing_page"><BrandMark />nautilus</Link><p>A shared space for what’s next.</p><a href="#main-content">Back to top ↑</a></footer>
    </div>
  );
}
