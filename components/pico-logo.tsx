import { cn } from "@/lib/utils";

/**
 * Pico brand mark — a glowing coin-like orb that nods to the price point
 * (a single penny / single token of USDC). Inline SVG so it ships zero bytes
 * over the wire beyond the page itself.
 */
export function PicoMark({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[0_0_24px_rgba(168,85,247,0.45)]", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id="pico-orb" cx="32" cy="28" r="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="35%" stopColor="#f59e0b" />
          <stop offset="70%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </radialGradient>
        <radialGradient id="pico-rim" cx="32" cy="32" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="80%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.6)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#pico-orb)" />
      <circle cx="32" cy="32" r="28" fill="url(#pico-rim)" opacity="0.6" />
      <circle
        cx="22"
        cy="22"
        r="6"
        fill="rgba(255,255,255,0.55)"
        filter="blur(2px)"
      />
    </svg>
  );
}

/**
 * Brand hero — used at the top of the Mini App. Pairs the orb with the
 * lowercase wordmark and tagline. Animated subtle pulse to feel alive.
 */
export function PicoHero({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative">
        <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-purple-500/30 blur-2xl" />
        <PicoMark size={48} />
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-mono text-3xl font-semibold tracking-tight">
          pico
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">
          Pennies of AI, settled inline.
        </span>
      </div>
    </div>
  );
}
