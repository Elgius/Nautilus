"use client";

import { useRef, useState, type FormEvent } from "react";
import { Upload, RotateCcw, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentPortrait, avatarIcons } from "@/components/agents/agent-portrait";
import type {
  Agent,
  AgentProfile,
  AvatarColor,
  AvatarIcon,
} from "@/lib/agent-data";

const colors: AvatarColor[] = ["violet", "coral", "blue", "green"];

export function AgentProfileDialog({
  agent,
  onClose,
  onSave,
}: {
  agent: Agent;
  onClose: () => void;
  onSave: (profile: AgentProfile) => Promise<string | null>;
}) {
  const [profile, setProfile] = useState<AgentProfile>({
    name: agent.name,
    role: agent.role,
    color: agent.color,
    avatarIcon: agent.avatarIcon,
    avatarUrl: agent.avatarUrl,
    rules: agent.rules,
  });
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState(() =>
    agent.rules
      .filter((rule) => rule.trim())
      .map((text, id) => ({ id, text })),
  );
  const [newRule, setNewRule] = useState("");
  const nextRuleId = useRef(rules.length);
  const ruleInput = useRef<HTMLInputElement>(null);
  const rulesLength = rules
    .map((rule) => rule.text.trim())
    .filter(Boolean)
    .join("\n").length;
  const pendingRule = newRule.trim();
  const totalRulesLength = rulesLength + pendingRule.length + (rulesLength && pendingRule ? 1 : 0);
  const canAddRule = !!pendingRule && totalRulesLength <= 6000 && rules.length < 100;
  function addRule() {
    if (!canAddRule) return;
    const rule = { id: nextRuleId.current++, text: pendingRule };
    setRules((previous) => [...previous, rule]);
    setNewRule("");
    ruleInput.current?.focus();
  }
  const [avatarError, setAvatarError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const savedRules = [...rules.map((rule) => rule.text.trim()), pendingRule].filter(Boolean);
    if (savedRules.join("\n").length > 6000 || savedRules.length > 100) return;
    setSaving(true);
    setSaveError("");
    try {
      const error = await onSave({ ...profile, rules: savedRules });
      if (error) {
        setSaveError(error);
        return;
      }
      onClose();
    } catch {
      setSaveError("Couldn’t save this agent. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  function readAvatar(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setAvatarError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Choose an image smaller than 2 MB.");
      return;
    }
    setAvatarError("");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string")
        setProfile((previous) => ({
          ...previous,
          avatarUrl: reader.result as string,
        }));
    };
    reader.onerror = () =>
      setAvatarError("Couldn’t read that image. Try another file.");
    reader.readAsDataURL(file);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="agent-profile-dialog sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Customize {agent.name}</DialogTitle>
          <DialogDescription>
            Give your agent an identity and clear instructions for how to work.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="agent-profile-form" aria-busy={saving}>
          <fieldset disabled={saving} className="contents">
            <section
              className="agent-avatar-editor"
              aria-labelledby="avatar-heading"
            >
              <div className="agent-avatar-preview">
                <AgentPortrait agent={profile} />
              </div>
              <div>
                <h3 id="avatar-heading">Agent avatar</h3>
                <p>Choose an icon or upload your own image.</p>
                <div className="agent-upload-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => upload.current?.click()}
                  >
                    <Upload size={14} />
                    Upload image
                  </Button>
                  {profile.avatarUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setProfile((previous) => ({
                          ...previous,
                          avatarUrl: undefined,
                        }))
                      }
                    >
                      <RotateCcw size={13} />
                      Reset
                    </Button>
                  )}
                </div>
                <input
                  ref={upload}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label="Upload agent avatar"
                  onChange={(event) => {
                    readAvatar(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <p className="agent-upload-hint">
                  PNG, JPEG or WebP · up to 2 MB
                </p>
              </div>
            </section>
            {avatarError && (
              <p className="agent-profile-error" role="alert">
                {avatarError}
              </p>
            )}
            <fieldset className="agent-avatar-presets">
              <legend>Avatar icon</legend>
              <div>
                {(
                  Object.entries(avatarIcons) as [
                    AvatarIcon,
                    typeof avatarIcons.bot,
                  ][]
                ).map(([key, Icon]) => (
                  <Button variant="ghost" size="sm"
                    type="button"
                    key={key}
                    aria-label={`${key} avatar`}
                    aria-pressed={
                      !profile.avatarUrl && profile.avatarIcon === key
                    }
                    onClick={() =>
                      setProfile((previous) => ({
                        ...previous,
                        avatarIcon: key,
                        avatarUrl: undefined,
                      }))
                    }
                  >
                    <Icon size={18} />
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset className="agent-avatar-colors">
              <legend>Avatar color</legend>
              <div>
                {colors.map((color) => (
                  <Button variant="ghost" size="sm"
                    type="button"
                    key={color}
                    aria-label={`${color} avatar color`}
                    aria-pressed={profile.color === color}
                    className={`agent-avatar ${color}`}
                    onClick={() =>
                      setProfile((previous) => ({ ...previous, color }))
                    }
                  >
                    {profile.color === color && <span aria-hidden="true">✓</span>}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="agent-profile-field">
              <label htmlFor="agent-profile-name">Agent name</label>
              <Input
                id="agent-profile-name"
                value={profile.name}
                maxLength={30}
                required
                onChange={(event) => {
                  setProfile((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }));
                  setSaveError("");
                }}
              />
            </div>
            <div className="agent-profile-field">
              <label htmlFor="agent-profile-role">Purpose</label>
              <Input
                id="agent-profile-role"
                value={profile.role}
                maxLength={70}
                required
                onChange={(event) => setProfile((previous) => ({ ...previous, role: event.target.value }))}
              />
            </div>
            <div className="agent-profile-field">
              <label id="agent-rules-heading" htmlFor="agent-profile-rules">Rules for this agent</label>
              <p id="agent-rules-help">
                Add rules one at a time to set the tone, boundaries, and habits.
              </p>
              <ol className="agent-rules-list" aria-labelledby="agent-rules-heading">
                {rules.map((rule, index) => (
                  <li key={rule.id} className="agent-rule-row">
                    <span className="agent-rule-number" aria-hidden="true">{index + 1}</span>
                    <Textarea
                      aria-label={`Rule ${index + 1}`}
                      value={rule.text}
                      rows={2}
                      maxLength={6000}
                      onChange={(event) =>
                        setRules((previous) => previous.map((item) =>
                          item.id === rule.id
                            ? { ...item, text: event.target.value.replace(/\r?\n/g, " ") }
                            : item,
                        ))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove rule ${index + 1}`}
                      onClick={() => {
                        setRules((previous) => previous.filter((item) => item.id !== rule.id));
                        ruleInput.current?.focus();
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="agent-rule-composer">
                <Input
                  ref={ruleInput}
                  id="agent-profile-rules"
                  aria-describedby="agent-rules-help"
                  aria-label="New rule"
                  placeholder="Write a rule…"
                  value={newRule}
                  onChange={(event) => setNewRule(event.target.value.replace(/\r?\n/g, " "))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      addRule();
                    }
                  }}
                  maxLength={6000}
                />
                <Button type="button" variant="outline" disabled={!canAddRule} onClick={addRule}>
                  <Plus size={14} /> Add rule
                </Button>
              </div>
              {totalRulesLength > 6000 && (
                <p className="agent-profile-error" role="alert">Keep all rules within 6,000 characters.</p>
              )}
              {rules.length + (pendingRule ? 1 : 0) > 100 && (
                <p className="agent-profile-error" role="alert">Keep your list within 100 rules.</p>
              )}
            </div>
            {saveError && (
              <p className="agent-profile-error" role="alert">{saveError}</p>
            )}
            <div className="agent-profile-footer">
              <span>Saved to your organisation.</span>
              <div>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || totalRulesLength > 6000 || rules.length + (pendingRule ? 1 : 0) > 100}>{saving ? "Saving…" : "Save changes"}</Button>
              </div>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
