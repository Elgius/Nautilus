import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

function Attachment({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment" className={cn("flex min-w-0 shrink-0 items-center gap-2 rounded-xl border bg-background p-2", className)} {...props} />;
}

function AttachmentMedia({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-media" className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)} {...props} />;
}

function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-content" className={cn("grid min-w-0 gap-0.5", className)} {...props} />;
}

function AttachmentTitle({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="attachment-title" className={cn("truncate text-xs font-medium", className)} {...props} />;
}

function AttachmentDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="attachment-description" className={cn("text-[10px] text-muted-foreground", className)} {...props} />;
}

function AttachmentAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" variant="ghost" size="icon-xs" data-slot="attachment-action" className={cn("shrink-0", className)} {...props} />;
}

export { Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentAction };
