import type { OverlayMetric } from "./zod";

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function formatMetricChip(metric: OverlayMetric): string {
  const label = metric.label.toLowerCase();
  if (label === "instance" || label === "instance type") {
    return String(metric.value);
  }
  return `${metric.value} ${metric.label}`;
}
