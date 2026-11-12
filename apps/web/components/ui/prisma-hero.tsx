"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useRef, type CSSProperties } from "react";

interface WordsPullUpProps {
  text: string;
  className?: string;
  showAsterisk?: boolean;
  style?: CSSProperties;
}

export const WordsPullUp = ({ text, className = "", showAsterisk = false, style }: WordsPullUpProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");

  return (
    <div ref={ref} className={`inline-flex flex-wrap ${className}`} style={style}>
      {words.map((word, i) => {
        const isLast = i === words.length - 1;
        return (
          <motion.span
            key={i}
            initial={reduceMotion ? false : { y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="relative inline-block"
            style={{ marginRight: isLast ? 0 : "0.25em" }}
          >
            {word}
            {showAsterisk && isLast && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
};

interface Segment {
  text: string;
  className?: string;
}

interface WordsPullUpMultiStyleProps {
  segments: Segment[];
  className?: string;
  style?: CSSProperties;
}

export const WordsPullUpMultiStyle = ({ segments, className = "", style }: WordsPullUpMultiStyleProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const words = segments.flatMap((segment) =>
    segment.text.split(" ").filter(Boolean).map((word) => ({ word, className: segment.className })),
  );

  return (
    <div ref={ref} className={`inline-flex flex-wrap justify-center ${className}`} style={style}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={reduceMotion ? false : { y: 20, opacity: 0 }}
          animate={isInView ? { y: 0, opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className={`inline-block ${word.className ?? ""}`}
          style={{ marginRight: "0.25em" }}
        >
          {word.word}
        </motion.span>
      ))}
    </div>
  );
};

const navItems = ["Documents", "Collaboration", "For businesses"];

export const PrismaHero = () => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="prisma-hero min-h-svh w-full bg-black text-[#E1E0CC]">
      <div className="relative min-h-svh w-full overflow-hidden rounded-2xl md:rounded-[2rem]">
        <div aria-hidden="true" className="prisma-background absolute inset-0" />
        <div aria-hidden="true" className="prisma-noise pointer-events-none absolute inset-0 opacity-70 mix-blend-overlay" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

        <nav aria-label="Nautilus navigation" className="absolute top-0 left-1/2 z-20 max-w-full -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-b-2xl bg-black px-4 py-2 sm:gap-6 md:gap-12 md:rounded-b-3xl md:px-8 lg:gap-14">
            {navItems.map((item) => (
              <a key={item} href="#" className="whitespace-nowrap text-[10px] text-[#E1E0CC]/80 transition-colors hover:text-[#E1E0CC] focus-visible:outline-2 focus-visible:outline-offset-4 sm:text-xs md:text-sm">
                {item}
              </a>
            ))}
          </div>
        </nav>

        <div className="relative flex min-h-svh items-end px-4 pt-24 pb-2 sm:px-6 md:px-10">
          <div className="grid w-full grid-cols-12 items-end gap-4">
            <div className="col-span-12 lg:col-span-8">
              <h1 className="text-[26vw] leading-[0.85] font-medium tracking-[-0.07em] sm:text-[24vw] md:text-[22vw] lg:text-[20vw] xl:text-[19vw] 2xl:text-[20vw]">
                <WordsPullUp text="Nautilus" />
              </h1>
            </div>
            <div className="col-span-12 flex flex-col gap-5 pb-6 lg:col-span-4 lg:pb-10">
              <motion.p
                initial={reduceMotion ? false : { y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="text-xs leading-[1.2] text-[#E1E0CC]/70 sm:text-sm md:text-base"
              >
                <strong className="mb-3 block text-xl font-medium text-[#E1E0CC] md:text-2xl">Multiplayer documents management for businesses.</strong>
                Bring your team, AI agents, and documents into one shared workspace. Create, organize, and move work forward together.
              </motion.p>
              <motion.button
                type="button"
                initial={reduceMotion ? false : { y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="group inline-flex items-center gap-2 self-start rounded-full bg-[#E1E0CC] py-1 pr-1 pl-5 text-sm font-medium text-black transition-all hover:gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E1E0CC] sm:text-base"
              >
                Join waitlst
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black transition-transform group-hover:scale-110 sm:h-10 sm:w-10">
                  <ArrowRight aria-hidden="true" className="h-4 w-4 text-[#E1E0CC]" />
                </span>
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
