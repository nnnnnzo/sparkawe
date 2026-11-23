import type { SVGProps } from "react";
import { cn } from "../utils.ts";

export const BRAND = {
  name: "Spark",
  wordmark: "spark",
  descriptor: "Agentic Workspace Environment",
  tagline: "One space. Many ways to create.",
} as const;

/** Le spectre de la charte. Une seule signature, sans hiérarchie entre les teintes. */
export const SPECTRUM = {
  violet: "#A69BC8",
  blue: "#769AC8",
  cyan: "#7AB8C1",
  lime: "#B4BC82",
  coral: "#CE9E8D",
  /** Accent d’extension : le spectre du logo reste à cinq couleurs. */
  honey: "#BF9C67",
} as const;

export const SPECTRUM_ORDER = [
  SPECTRUM.violet,
  SPECTRUM.blue,
  SPECTRUM.cyan,
  SPECTRUM.lime,
  SPECTRUM.coral,
] as const;

const rays = [
  ["M103 80L198 24", SPECTRUM.violet],
  ["M103 80L205 51", SPECTRUM.blue],
  ["M103 80H211", SPECTRUM.cyan],
  ["M103 80L203 109", SPECTRUM.lime],
  ["M103 80L196 136", SPECTRUM.coral],
] as const;

const convergence = [
  "M18 80H103",
  "M103 18V142",
  "M61 50L103 80",
  "M67 108L103 80",
] as const;

export function SparkMark({
  variant = "color",
  className,
  ...props
}: SVGProps<SVGSVGElement> & { variant?: "color" | "mono" }) {
  return (
    <svg
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden
      className={cn("spark-mark", className)}
      {...props}
    >
      <g
        className="spark-mark-ray"
        strokeWidth={3.2}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      >
        {rays.map(([path, color]) => (
          <path
            key={path}
            d={path}
            stroke={variant === "color" ? color : "currentColor"}
          />
        ))}
      </g>
      <g
        className="spark-mark-ink"
        stroke="currentColor"
        strokeWidth={4.2}
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        {convergence.map((path) => (
          <path key={path} d={path} />
        ))}
      </g>
    </svg>
  );
}

export function SparkWordmark({ className }: { className?: string }) {
  return <span className={cn("spark-wordmark", className)}>{BRAND.wordmark}</span>;
}

export function SparkLockup({
  variant = "color",
  className,
}: {
  variant?: "color" | "mono";
  className?: string;
}) {
  return (
    <span className={cn("spark-lockup", className)}>
      <SparkMark variant={variant} />
      <SparkWordmark />
    </span>
  );
}

/** Signature spectrale : cinq segments, jamais utilisée comme couleur dominante. */
export function Spectrum({ className }: { className?: string }) {
  return (
    <span className={cn("spark-spectrum", className)} aria-hidden>
      {SPECTRUM_ORDER.map((color) => (
        <i key={color} style={{ background: color }} />
      ))}
    </span>
  );
}
