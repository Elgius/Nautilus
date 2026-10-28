"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AgentShape } from "@/components/agents/agent-portrait";
import { avatarColors, avatarShapes, type AgentCreationInput, type AvatarColor, type AvatarShape } from "@/lib/agent-data";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const avatarColorValues: Record<AvatarColor, string> = {
  brown: "#a77943", red: "#ff2c4b", orange: "#ff7900", amber: "#ffb500",
  green: "#00cd82", teal: "#00bfae", blue: "#0787f9", violet: "#9c5bfa",
  pink: "#fa2ca4", gray: "#898989", coral: "#c66e5c",
};

export function CreateAgentDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: AgentCreationInput) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<AvatarColor>("blue");
  const [shape, setShape] = useState<AvatarShape>("circle");
  const [step, setStep] = useState<"identity" | "work">("identity");
  const [work, setWork] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !name.trim()) return;
    if (step === "identity") {
      setError("");
      setStep("work");
      return;
    }
    if (!work.trim()) return;
    setCreating(true);
    setError("");
    try {
      const message = await onCreate({ name: name.trim(), color, avatarIcon: shape, description: work.trim() });
      if (message) setError(message);
    } catch {
      setError("Couldn’t create this agent. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !creating) onClose(); }}>
      <DialogContent
        className="create-agent-dialog sm:max-w-xl"
        showCloseButton={!creating}
        style={{ "--avatar-color": avatarColorValues[color] } as CSSProperties}
      >
        <DialogTitle className="sr-only">Create agent</DialogTitle>
        <DialogDescription className="sr-only">
          {step === "identity" ? "Choose your agent’s color, shape, and name to get started." : "Describe the work you want your agent to do."}
        </DialogDescription>
        <form onSubmit={submit} aria-busy={creating}>
          <fieldset disabled={creating} className="create-agent-fields">
            <div className="create-agent-preview"><AgentShape key={`${shape}-${color}`} shape={shape} animated /></div>
            {step === "identity" ? (
              <>
                <fieldset className="create-agent-colors">
                  <legend className="sr-only">Avatar color</legend>
                  <div>
                    {avatarColors.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-label={`${option} avatar color`}
                        aria-pressed={color === option}
                        style={{ "--swatch-color": avatarColorValues[option] } as CSSProperties}
                        onClick={() => setColor(option)}
                      ><span /></button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="create-agent-shapes">
                  <legend className="sr-only">Avatar shape</legend>
                  <div>
                    {avatarShapes.map((option) => (
                      <button key={option} type="button" aria-label={`${option} avatar`} aria-pressed={shape === option} onClick={() => setShape(option)}>
                        <AgentShape shape={option} />
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="create-agent-name">
                  <label htmlFor="create-agent-name">Name</label>
                  <Input
                    id="create-agent-name" name="name" value={name} required maxLength={30}
                    placeholder="Name your agent" autoComplete="off" autoFocus
                    aria-invalid={!!error} aria-describedby={error ? "create-agent-error" : undefined}
                    onChange={(event) => { setName(event.target.value); setError(""); }}
                  />
                </div>
              </>
            ) : (
              <div className="create-agent-work">
                <label htmlFor="create-agent-work">what work do you want done?</label>
                <Textarea
                  id="create-agent-work" name="work" value={work} required maxLength={6000}
                  rows={5} autoFocus placeholder="Describe the task, goals, and any important details…"
                  aria-invalid={!!error} aria-describedby={error ? "create-agent-error" : undefined}
                  onChange={(event) => { setWork(event.target.value); setError(""); }}
                />
              </div>
            )}
            {creating && <p role="status">Preparing your agent’s purpose and rules…</p>}
            {error && <p id="create-agent-error" className="create-agent-error" role="alert">{error}</p>}
            <div className="create-agent-actions">
              {step === "work" && (
                <Button type="button" variant="ghost" onClick={() => { setStep("identity"); setError(""); }}>Back</Button>
              )}
              <Button type="submit" className="create-agent-submit" disabled={creating || !name.trim() || (step === "work" && !work.trim())}>
                {creating ? "Creating agent…" : step === "identity" ? "Next" : "Create agent"}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
