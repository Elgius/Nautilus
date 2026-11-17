// Adapted from Vercel AI Elements (Apache-2.0); see LICENSE.
"use client";
import { PreviewCard } from "@base-ui/react/preview-card";
import { cn } from "cn";
import { useState } from "react";
import { badgeVariants } from "@/components/ui/badge";
import type { ComponentProps } from "react";
export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    className={cn("group inline items-center gap-1", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    className={cn("transition-colors group-hover:bg-accent", className)}
    {...props}
  />
);


/** AI Elements inline citation adapted to Base UI; click/keyboard also opens evidence on touch devices. */
export function InlineCitationLink({ href, title, quote, locator, version, number, children }: {
  href: string; title: string; quote?: string; locator?: string; version?: string | null; number?: number; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <InlineCitation>
    <InlineCitationText>{children}</InlineCitationText>
    <PreviewCard.Root open={open} onOpenChange={setOpen}>
      <PreviewCard.Trigger render={<button type="button" />} delay={150} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}
        data-slot="inline-citation-card-trigger" aria-label={`Citation ${number ?? ''}: ${title}`} aria-expanded={open}
        className={cn(badgeVariants({ variant: 'secondary' }), 'mx-1 cursor-pointer align-baseline no-underline')}>
        {number ? `[${number}]` : title}
      </PreviewCard.Trigger>
      <PreviewCard.Portal><PreviewCard.Positioner sideOffset={6} collisionPadding={12}>
        <PreviewCard.Popup data-slot="inline-citation-card-body" className="z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md">
          <strong>{title}</strong>
          {quote && <blockquote className="border-l-2 pl-2 whitespace-pre-wrap">{quote}</blockquote>}
          {locator && <p className="text-xs text-muted-foreground">{locator}</p>}
          {version && <p className="break-all text-xs text-muted-foreground">Saved version: {version}</p>}
          <a href={href} className="inline-block underline" target="_blank" rel="noopener noreferrer">Open source</a>
        </PreviewCard.Popup>
      </PreviewCard.Positioner></PreviewCard.Portal>
    </PreviewCard.Root>
  </InlineCitation>;
}
