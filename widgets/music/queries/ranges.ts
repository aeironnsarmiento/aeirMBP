export type TimeRange = "week" | "month" | "all";

/**
 * Three options, not five.
 *
 * With an account three weeks old, week / month / 3 months / year / all time
 * renders three identical views. The wider ranges come back when the history
 * makes them distinct.
 *
 * Kept free of database imports: the expanded music view is a client component
 * and needs these values, and a value import reaching the query layer would
 * pull the Postgres driver into the browser bundle.
 */
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

/** Lower bound for a range, or null for all time. */
export function windowStart(range: TimeRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
}
