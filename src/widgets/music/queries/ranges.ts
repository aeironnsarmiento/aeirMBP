export type TimeRange = "week" | "month" | "all";

export const TIME_RANGES: readonly TimeRange[] = ["week", "month", "all"];

export const RANGE_LABELS: Record<TimeRange, string> = {
  week: "Week",
  month: "Month",
  all: "All time",
};

const RANGE_DAYS: Record<Exclude<TimeRange, "all">, number> = {
  week: 7,
  month: 30,
};

export function isTimeRange(value: unknown): value is TimeRange {
  return TIME_RANGES.includes(value as TimeRange);
}

export function windowStart(range: TimeRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
}
