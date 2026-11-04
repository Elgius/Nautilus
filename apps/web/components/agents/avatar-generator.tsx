"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AgentShape } from "@/components/agents/agent-portrait";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvatarGenerationError, generateAvatarPreview, type AvatarDesign } from "@/lib/avatar-generation";
import type { AvatarShape } from "@/lib/agent-data";

export function AvatarGenerator({ organizationId, shape, initialDesign, onBack, onUse }: {
  organizationId: string;
  shape: AvatarShape;
  initialDesign?: AvatarDesign;
  onBack: () => void;
  onUse: (design: AvatarDesign) => void;
}) {
  const [description, setDescription] = useState("");
  const [design, setDesign] = useState<AvatarDesign | null>(initialDesign ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => { setRetryAt(0); setQuotaExhausted(false); setError(""); }, Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || generating || retryAt > Date.now()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setGenerating(true);
    setError("");
    try {
      const result = await generateAvatarPreview(organizationId, description.trim(), controller.signal);
      if (request.current === controller && !controller.signal.aborted) setDesign(result);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Couldn’t generate this avatar. Please try again.");
        if (error instanceof AvatarGenerationError) {
          setQuotaExhausted(error.quotaExhausted);
          if (error.retryAfterSeconds) setRetryAt(Date.now() + error.retryAfterSeconds * 1000);
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setGenerating(false);
      }
    }
  }

  return (
    <form onSubmit={generate} className="avatar-generator" aria-busy={generating}>
      <figure>
        <div className="create-agent-preview">
          <AgentShape key={design ? JSON.stringify(design) : shape} shape={shape} design={design ?? undefined} animated />
        </div>
        <figcaption>{design ? "Generated avatar preview" : "Create a custom avatar"}</figcaption>
      </figure>
      <label htmlFor="avatar-description">What should your avatar look like?</label>
      <Textarea
        id="avatar-description" value={description} rows={4} required maxLength={2000}
        autoFocus disabled={generating}
        placeholder="A friendly purple cat with pointy ears and big rounded eyes…"
        aria-describedby={`avatar-preview-note${error ? " avatar-preview-error" : ""}`}
        onChange={(event) => { setDescription(event.target.value); if (!retryAt) setError(""); }}
      />
      <p id="avatar-preview-note" className="avatar-preview-note">Choose Use avatar to keep this design, then save your agent.</p>
      {generating && <p role="status" className="avatar-preview-note">Designing your avatar…</p>}
      {error && <p id="avatar-preview-error" className="create-agent-error" role="alert">{error}</p>}
      {!!retryAt && <p className="avatar-preview-note">You can retry after {new Date(retryAt).toLocaleString()}.</p>}
      <div className="create-agent-actions">
        <Button type="button" variant="ghost" onClick={onBack}>Back to presets</Button>
        <Button type="submit" disabled={generating || !!retryAt || !description.trim()}>
          {generating ? "Generating…" : retryAt ? quotaExhausted ? "Quota reached" : "Try again later" : design ? "Regenerate" : "Generate"}
        </Button>
        {design && <Button type="button" disabled={generating} onClick={() => onUse(design)}>Use avatar</Button>}
      </div>
    </form>
  );
}
