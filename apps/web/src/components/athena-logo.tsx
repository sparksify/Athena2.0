// Athena brand mark: neon network sphere + spectrum wordmark, after the
// brand art Steve provided (blue→orange gradient type, rainbow node sphere).

const OUTER = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 16 + 13 * Math.cos(a), y: 16 + 13 * Math.sin(a) };
});
const INNER = [30, 90, 150, 210, 270, 330].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 16 + 7.2 * Math.cos(a), y: 16 + 7.2 * Math.sin(a) };
});
const OUTER_COLORS = ["#22D3EE", "#34D399", "#FDE047", "#FB923C", "#F472B6", "#C084FC", "#818CF8", "#60A5FA"];
const INNER_COLORS = ["#38BDF8", "#4ADE80", "#FACC15", "#F97316", "#A78BFA", "#2DD4BF"];

export function AthenaMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      {/* mesh: outer ring, inner ring, spokes */}
      <g stroke="#5B6B8C" strokeWidth={0.5} opacity={0.55}>
        {OUTER.map((p, i) => {
          const q = OUTER[(i + 1) % OUTER.length]!;
          return <line key={`o${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        })}
        {INNER.map((p, i) => {
          const q = INNER[(i + 1) % INNER.length]!;
          return <line key={`i${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        })}
        {OUTER.map((p, i) => {
          const q = INNER[i % INNER.length]!;
          return <line key={`s${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        })}
      </g>
      {/* glow + node dots */}
      {OUTER.map((p, i) => (
        <g key={`n${i}`}>
          <circle cx={p.x} cy={p.y} r={2.6} fill={OUTER_COLORS[i]} opacity={0.22} />
          <circle cx={p.x} cy={p.y} r={1.3} fill={OUTER_COLORS[i]} />
        </g>
      ))}
      {INNER.map((p, i) => (
        <circle key={`m${i}`} cx={p.x} cy={p.y} r={0.95} fill={INNER_COLORS[i]} />
      ))}
      {/* center waveform pulse */}
      <g stroke="#22D3EE" strokeWidth={1.1} strokeLinecap="round">
        <line x1={13.4} y1={14.6} x2={13.4} y2={17.4} opacity={0.85} />
        <line x1={16} y1={12.6} x2={16} y2={19.4} />
        <line x1={18.6} y1={14.6} x2={18.6} y2={17.4} opacity={0.85} />
      </g>
    </svg>
  );
}

export function AthenaWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`bg-gradient-to-r from-sky-400 via-cyan-300 to-orange-400 bg-clip-text font-bold tracking-[0.22em] text-transparent ${className}`}
    >
      ATHENA
    </span>
  );
}

export function AthenaLogo({ size = 30, className = "text-base" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <AthenaMark size={size} />
      <AthenaWordmark />
    </span>
  );
}
