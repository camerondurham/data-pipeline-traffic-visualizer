import type { DashboardData } from "../types";
import { parseArchitecture, parseThrottleSnapshot, parseTrafficSnapshot } from "./parsers";

async function loadJson(path: string, bustCache: string): Promise<unknown> {
  const response = await fetch(`${path}?refresh=${bustCache}`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }

  return response.json();
}

export async function loadDashboardData(): Promise<DashboardData> {
  const bustCache = String(Date.now());
  const [architecture, desiredThrottles, liveThrottles, traffic] = await Promise.all([
    loadJson("/config/architecture.json", bustCache),
    loadJson("/config/desired-throttles.json", bustCache),
    loadJson("/config/live-throttles.json", bustCache),
    loadJson("/config/traffic-snapshot.json", bustCache)
  ]);

  return {
    architecture: parseArchitecture(architecture),
    desiredThrottles: parseThrottleSnapshot(desiredThrottles, "desired"),
    liveThrottles: parseThrottleSnapshot(liveThrottles, "live"),
    traffic: parseTrafficSnapshot(traffic)
  };
}
