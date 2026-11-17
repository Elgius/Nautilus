"use client";

import { useId, useState, type FormEvent } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentQuestion } from "../../../../shared/room-chat";

/** A private clarification requested by an agent, separate from room chat. */
export function InputBox({ question, agentName, disabled, pending = false, onAnswer, onLater }: {
  question: AgentQuestion;
  agentName?: string;
  disabled?: boolean;
  pending?: boolean;
  onAnswer: (answer: string) => void;
  onLater?: () => void;
}) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!disabled && !question.answer && answer.trim()) onAnswer(answer.trim());
  }
  return <form className="room-agent-input-box" aria-label="Agent question" aria-busy={pending} onSubmit={submit}>
    <div className="room-agent-input-box-label"><MessageCircleQuestion size={15} aria-hidden="true" /><span>{question.answer ? "Your answer" : `${agentName ?? "Your agent"} needs your input`}</span></div>
    <label htmlFor={id}>{question.question}</label>
    {question.answer ? <p className="whitespace-pre-wrap">{question.answer}</p> : <>
      {!!question.options?.length && <div className="room-agent-input-box-options" role="group" aria-label="Suggested answers">
        {question.options.map((option) => <Button key={option} type="button" size="sm" variant={answer === option ? "secondary" : "outline"} disabled={disabled} aria-pressed={answer === option} onClick={() => setAnswer(option)}>{option}</Button>)}
      </div>}
      <Textarea id={id} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer…" maxLength={4000} disabled={disabled} required />
      <div className="room-agent-input-box-footer">
        <span>Only you and your agent</span>
        {onLater && <Button type="button" size="sm" variant="ghost" onClick={onLater}>Answer later</Button>}
        <Button type="submit" size="sm" disabled={disabled || !answer.trim()}>{pending ? "Sending…" : "Send answer"}</Button>
      </div>
    </>}
  </form>;
}
