type Props = {
  /** 0-1 */
  progress: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  /** Dashed track for passing periods, so the two states read differently. */
  dashed?: boolean;
};

export function ProgressRing({ progress, size = 232, stroke = 10, children, dashed }: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth={stroke}
          strokeDasharray={dashed ? '2 8' : undefined}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center px-8 text-center">{children}</div>
    </div>
  );
}
