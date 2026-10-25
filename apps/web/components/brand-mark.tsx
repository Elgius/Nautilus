import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-block size-8 shrink-0 overflow-hidden rounded-lg", className)}
    >
      <Image
        src="/nautilus-logo.png"
        alt="Current N logo"
        fill
        sizes="96px"
        className="scale-200 object-contain"
      />
    </span>
  );
}
