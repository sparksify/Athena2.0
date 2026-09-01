/* Headshots live under /public/avatars. A real photo dropped in as
   <slug>.jpg/.jpeg/.png/.webp wins over the committed .svg placeholder
   automatically. The resolver reads the filesystem, so this module is for
   server components only. */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type AgentName = "Tim" | "Sophie" | "Claire" | "Rina";

const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"] as const;

export function resolveAvatar(slug: string) {
  for (const ext of PHOTO_EXTS) {
    if (existsSync(join(process.cwd(), "public", "avatars", `${slug}.${ext}`))) {
      return `/avatars/${slug}.${ext}`;
    }
  }
  return `/avatars/${slug}.svg`;
}

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
      src={resolveAvatar(`agent-${name.toLowerCase()}`)}
      alt={`${name} (AI agent)`}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ border: `1.5px solid ${AGENT_RING[name]}` }}
    />
  );
}
