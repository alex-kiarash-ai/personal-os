"use client";

/* C11: the one global motion switch. reducedMotion="user" makes every motion/react component
   respect the OS prefers-reduced-motion setting (transform/layout animations off, opacity
   crossfades stay — the accessibility-sanctioned swap). CSS keyframes get the same gate in
   globals.css; CountUp/Sparkline check useReducedMotion() themselves because the imperative
   animate() call doesn't read this context. */

import { MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
