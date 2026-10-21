/* Headshots live under /public/avatars. A real photo dropped in as
   <slug>.jpg/.jpeg/.png/.webp wins over the committed .svg placeholder
   automatically. The resolver reads the filesystem, so this module is for
   server components only. */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type AgentName = "Tim" | "Sophie" | "Claire" | "Rina";

const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"] as const;

/** Path of the headshot for a slug, or null when no file exists (the avatar then renders initials). */
export function resolveAvatar(slug: string): string | null {
  for (const ext of [...PHOTO_EXTS, "svg"]) {
    if (existsSync(join(process.cwd(), "public", "avatars", `${slug}.${ext}`))) {
      return `/avatars/${slug}.${ext}`;
    }
  }
  return null;
}

const INITIAL_HUES = [222, 262, 292, 332, 12, 42, 152, 182];
function initialsOf(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

const AGENT_RING: Record<AgentName, string> = {
  Tim: "#6366F1",
  Sophie: "#EC4899",
  Claire: "#10B981",
  Rina: "#F59E0B",
};

export function PersonAvatar({ src, alt, size = 28 }: { src: string | null; alt: string; size?: number }) {
  if (!src) {
    const hue = INITIAL_HUES[[...alt].reduce((h, ch) => h + ch.charCodeAt(0), 0) % INITIAL_HUES.length];
    return (
      <span
        role="img"
        aria-label={alt}
        className="inline-flex shrink-0 select-none items-center justify-center rounded-full border border-[#2A3447] font-semibold text-white"
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), background: `hsl(${hue} 45% 38%)` }}
      >
        {initialsOf(alt)}
      </span>
    );
  }
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
      src={resolveAvatar(`agent-${name.toLowerCase()}`) ?? `/avatars/agent-${name.toLowerCase()}.svg`}
      alt={`${name} (AI agent)`}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ border: `1.5px solid ${AGENT_RING[name]}` }}
    />
  );
}
