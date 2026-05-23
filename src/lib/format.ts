export function formatNumber(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

export function formatPercent(value: number | undefined, digits = 1): string {
  if (value === undefined) {
    return "n/a";
  }
  return `${value.toFixed(digits)}%`;
}

export function formatTps(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return `${formatNumber(value)} tps`;
}

export function formatAge(seconds: number | undefined): string {
  if (seconds === undefined) {
    return "n/a";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
