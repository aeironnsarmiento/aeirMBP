export function formatPlays(plays: number): string {
  return plays === 1 ? "1 play" : `${plays.toLocaleString()} plays`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatListeningTime(minutes: number): string {
  if (minutes <= 0) return "0m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const RELATIVE_STEPS: Array<[limitSeconds: number, divisor: number, unit: string]> = [
  [60, 1, "s"],
  [3600, 60, "m"],
  [86_400, 3600, "h"],
  [604_800, 86_400, "d"],
];

export function formatRelativeTime(when: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
  if (seconds < 30) return "just now";

  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${unit}`;
  }

  return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

export function initialsFor(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
