import type { SVGProps } from "react";
import type { AgentBrand } from "./data.ts";

export { AGENTS, agentFor, agentForClient } from "./data.ts";
export type { AgentBrand } from "./data.ts";

/** Marque d'agent, monochrome, rendue en `currentColor`. */
export function AgentMark({
  agent,
  ...props
}: { agent: AgentBrand } & SVGProps<SVGSVGElement>) {
  if (agent.icon) {
    return (
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={agent.name}
        fill="currentColor"
        {...props}
      >
        <path d={agent.icon} />
        {agent.iconDetail ? <path d={agent.iconDetail} opacity={0.32} /> : null}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={agent.name} {...props}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.16" />
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="currentColor"
        fontFamily="ui-sans-serif, -apple-system, sans-serif"
      >
        {agent.glyph ?? [...agent.name][0] ?? "A"}
      </text>
    </svg>
  );
}
