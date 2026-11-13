import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-block size-8 shrink-0 overflow-hidden rounded-lg", className)}
    >
      <Image
        src="/nautilus-submarine-logo.jpg"
        alt="Nautilus submarine logo"
        fill
        sizes="96px"
        loading="eager"
        className="-translate-x-[3%] -translate-y-[18%] scale-150 object-contain"
      />
    </span>
  );
}
