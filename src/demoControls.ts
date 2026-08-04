import { OverlayControlSchema, type ArchitectureOverlays, type OverlayControl } from "./zod";

export const DEMO_THROTTLE_STORAGE_KEY = "runtime-architecture-console:demo-throttles:v1";

interface StoredDemoThrottles {
  version: 1;
  values: Record<string, number>;
}

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function readStoredValues(storage: Storage | undefined): Record<string, number> {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(DEMO_THROTTLE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<StoredDemoThrottles>;
    if (parsed.version !== 1 || !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed.values).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    );
  } catch {
    return {};
  }
}

function restoredControl(control: OverlayControl, value: number): OverlayControl | undefined {
  if (control.control_type !== "throttle") {
    return undefined;
  }

  const candidate = {
    ...control,
    state: {
      ...control.state,
      desired_value: value,
      effective_value: value,
      apply: {
        phase: "applied" as const,
        message: "Restored browser-local simulated value."
      }
    }
  };

  const result = OverlayControlSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

export function restoreDemoThrottleValues(
  overlays: ArchitectureOverlays,
  storage: Storage | undefined = getBrowserStorage()
): { overlays: ArchitectureOverlays; restoredCount: number } {
  const values = readStoredValues(storage);
  let restoredCount = 0;
  const controls = overlays.controls.map((control) => {
    const value = values[control.id];
    if (value === undefined) {
      return control;
    }
    const restored = restoredControl(control, value);
    if (!restored) {
      return control;
    }
    restoredCount += 1;
    return restored;
  });

  return {
    overlays: restoredCount > 0 ? { ...overlays, controls } : overlays,
    restoredCount
  };
}

export function persistDemoThrottleValue(
  controlId: string,
  value: number,
  storage: Storage | undefined = getBrowserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    const values = readStoredValues(storage);
    const payload: StoredDemoThrottles = {
      version: 1,
      values: { ...values, [controlId]: value }
    };
    storage.setItem(DEMO_THROTTLE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Demo edits remain valid in memory when browser storage is unavailable.
  }
}

export function resetDemoThrottleValues(storage: Storage | undefined = getBrowserStorage()): void {
  try {
    storage?.removeItem(DEMO_THROTTLE_STORAGE_KEY);
  } catch {
    // Resetting in-memory state still works when browser storage is unavailable.
  }
}
