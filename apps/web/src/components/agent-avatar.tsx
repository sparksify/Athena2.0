// Placeholder avatars for the persistent AI agents (Tim, Sophie, Claire,
// Rina). Generated art until real persona images are uploaded via admin.

export type AgentName = "Tim" | "Sophie" | "Claire" | "Rina";

const AGENT_STYLE: Record<AgentName, { from: string; to: string; accent: string }> = {
  Tim: { from: "#6366F1", to: "#3B82F6", accent: "#C7D2FE" },
  Sophie: { from: "#EC4899", to: "#F43F5E", accent: "#FBCFE8" },
  Claire: { from: "#10B981", to: "#14B8A6", accent: "#A7F3D0" },
  Rina: { from: "#F59E0B", to: "#F97316", accent: "#FDE68A" },
};

export function AgentAvatar({ name, size = 28 }: { name: AgentName; size?: number }) {
  const s = AGENT_STYLE[name];
  const id = `agent-${name}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label={`${name} (AI agent)`} className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={s.from} />
          <stop offset="100%" stopColor={s.to} />
        </linearGradient>
      </defs>
      <circle cx={20} cy={20} r={19} fill={`url(#${id})`} />
      <circle cx={20} cy={20} r={19} fill="none" stroke="#0B0F17" strokeOpacity={0.25} strokeWidth={1} />
      {/* friendly bot face */}
      <circle cx={14.5} cy={17} r={2.6} fill="#FFFFFF" />
      <circle cx={25.5} cy={17} r={2.6} fill="#FFFFFF" />
      <circle cx={15.1} cy={17.5} r={1.1} fill={s.to} />
      <circle cx={26.1} cy={17.5} r={1.1} fill={s.to} />
      <path d="M13.5 25 Q20 30 26.5 25" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
      {/* antenna spark marks it as an agent, not a person */}
      <line x1={20} y1={5.5} x2={20} y2={2.8} stroke={s.accent} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={20} cy={1.8} r={1.6} fill={s.accent} />
    </svg>
  );
}
