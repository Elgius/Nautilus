"use client";

import { useState } from "react";
import { ArrowUpRight, Bot, Check, FileText, MessageSquare, Pause, Play, Sparkles, Users } from "lucide-react";

export function LandingMotion() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={`lp-scene${paused ? " lp-motion-paused" : ""}`}>
      <div className="lp-scene-art" role="img" aria-label="Illustration of people, agents, and documents connected around a shared project room">
        <div className="lp-scene-grid" />
        <div className="lp-orbit lp-orbit-outer"><span /></div>
        <div className="lp-orbit lp-orbit-inner"><span /></div>
        <div className="lp-cross lp-cross-one">+</div><div className="lp-cross lp-cross-two">+</div>
        <div className="lp-floating lp-float-people"><span className="lp-float-icon"><Users size={18} /></span><div><strong>Your people</strong><small>Great minds, together.</small></div><span className="lp-online" /></div>
        <div className="lp-room-card"><div className="lp-room-card-top"><span><span className="lp-online" /> A SHARED ROOM</span><ArrowUpRight size={16} /></div><div className="lp-room-symbol"><Sparkles size={31} strokeWidth={1.3} /></div><h3>The next big thing</h3><p>A little space. Endless possibility.</p><div className="lp-room-divider" /><div className="lp-room-bottom"><span><MessageSquare size={14} /> Ideas in motion</span><span className="lp-card-avatars"><i>J</i><i>M</i><i><Bot size={13} /></i></span></div></div>
        <div className="lp-floating lp-float-agent"><span className="lp-agent-icon"><Bot size={21} /></span><div><strong>A fresh perspective</strong><small>Your agents are in.</small></div><Sparkles size={14} /></div>
        <div className="lp-floating lp-float-doc"><FileText size={21} /><div><strong>The big idea.doc</strong><small>Context, all in one place.</small></div><span className="lp-check"><Check size={13} /></span></div>
        <span className="lp-scene-caption">CONNECTED BY CONTEXT. POWERED BY YOU.</span>
      </div>
      <button className="lp-motion-toggle" type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Play motion" : "Pause motion"}</button>
    </div>
  );
}
