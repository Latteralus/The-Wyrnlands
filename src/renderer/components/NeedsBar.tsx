interface NeedsBarProps {
  label: string;
  value: number; // 0-100
}

// §14.2 HUD "needs" — a small labeled bar per need (hunger/thirst/energy/
// warmth), tinted when critical so a collapse doesn't come as a surprise
// (§18: "Harsh ≠ opaque").
export function NeedsBar({ label, value }: NeedsBarProps) {
  const critical = value < 25;
  return (
    <span className={`needs-bar${critical ? ' critical' : ''}`} title={`${label}: ${Math.round(value)}`}>
      <span className="needs-bar-label">{label}</span>
      <span className="needs-bar-track">
        <span className="needs-bar-fill" style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}
