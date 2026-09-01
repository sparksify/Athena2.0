/* Illustrated headshots (generated placeholders, committed under
   /public/avatars). Real photos upload via admin later and replace the
   files without code changes. */

export type AgentName = "Tim" | "Sophie" | "Claire" | "Rina";

const AGENT_RING: Record<AgentName, string> = {
  Tim: "#6366F1",
  Sophie: "#EC4899",
  Claire: "#10B981",
  Rina: "#F59E0B",
};

export function PersonAvatar({ src, alt, size = 28 }: { src: string; alt: string; size?: number }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-[#2A3447]"
    />
  );
}

/** Agent headshot with a colored identity ring so agents read distinctly from humans. */
export function AgentAvatar({ name, size = 28 }: { name: AgentName; size?: number }) {
  return (
    <img
      src={`/avatars/agent-${name.toLowerCase()}.svg`}
      alt={`${name} (AI agent)`}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ border: `1.5px solid ${AGENT_RING[name]}` }}
    />
  );
}
