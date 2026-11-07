"use client";

import { useState } from "react";
import { ArrowRight, Bot, FileText, MessageSquare, Pause, Play, Users } from "lucide-react";

export function LandingMotion() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={`lp-scene${paused ? " lp-motion-paused" : ""}`}>
      <div className="lp-scene-art" role="img" aria-label="Illustrative project room: people, an AI agent, and project documents come together around a launch plan.">
        <div className="lp-scene-grid" />
        <div className="lp-context-nodes" aria-hidden="true">
          <div className="lp-context-node"><Users size={21} /><span>Your people</span><small>One team</small></div>
          <div className="lp-context-node"><Bot size={21} /><span>Your agents</span><small>A role to play</small></div>
          <div className="lp-context-node"><FileText size={21} /><span>Your documents</span><small>Context close by</small></div>
        </div>
        <div className="lp-connections" aria-hidden="true"><span /><span /><span /></div>
        <div className="lp-product" aria-hidden="true">
          <aside className="lp-product-sidebar"><span className="lp-product-brand">n.</span><MessageSquare size={18} /><FileText size={18} /><Bot size={18} /></aside>
          <div className="lp-product-main">
            <div className="lp-product-top"><span><span className="lp-online" /> Product launch</span><span className="lp-preview-label">ILLUSTRATIVE WORKSPACE</span></div>
            <div className="lp-product-body"><div className="lp-product-heading"><span className="lp-eyebrow">ONE ROOM. SHARED CONTEXT.</span><h3>Let’s move this forward.</h3></div>
              <div className="lp-product-message"><span className="lp-avatar">J</span><div><strong>Jordan <small>Teammate</small></strong><p>The launch brief is ready for review. Let’s work through the next steps here.</p></div></div>
              <div className="lp-product-document"><FileText size={23} /><div><strong>Launch brief</strong><span>Project document</span></div><ArrowRight size={17} /></div>
              <div className="lp-product-agent"><span className="lp-avatar"><Bot size={20} /></span><div><strong>Research agent <small>Room agent</small></strong><p>A dedicated teammate for the questions ahead.</p></div></div>
            </div>
            <div className="lp-product-bottom"><MessageSquare size={15} /> Conversations and documents, together.</div>
          </div>
        </div>
      </div>
      <button className="lp-motion-toggle" type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Play motion" : "Pause motion"}</button>
    </div>
  );
}
