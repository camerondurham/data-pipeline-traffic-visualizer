import "./test/setup";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  DEMO_THROTTLE_STORAGE_KEY,
  persistDemoThrottleValue,
  resetDemoThrottleValues,
  restoreDemoThrottleValues
} from "./demoControls";
import { validateArchitectureOverlays } from "./zod";

function loadSeedOverlays() {
  return validateArchitectureOverlays(parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8")));
}

describe("browser demo throttle persistence", () => {
  afterEach(() => localStorage.clear());

  it("restores only known values that still satisfy each throttle spec", () => {
    localStorage.setItem(
      DEMO_THROTTLE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        values: {
          "orders-processor-outflow-throttle": 750,
          "partner-processor-outflow-throttle": 725,
          "removed-control": 900
        }
      })
    );

    const restored = restoreDemoThrottleValues(loadSeedOverlays());

    expect(restored.restoredCount).toBe(1);
    expect(restored.overlays.controls.find((control) => control.id === "orders-processor-outflow-throttle")?.state).toEqual(
      expect.objectContaining({ desired_value: 750, effective_value: 750 })
    );
    expect(restored.overlays.controls.find((control) => control.id === "partner-processor-outflow-throttle")?.state.desired_value).toBe(500);
  });

  it("ignores corrupt storage and supports persist plus reset", () => {
    localStorage.setItem(DEMO_THROTTLE_STORAGE_KEY, "{not-json");
    expect(restoreDemoThrottleValues(loadSeedOverlays()).restoredCount).toBe(0);

    persistDemoThrottleValue("orders-processor-outflow-throttle", 800);
    expect(JSON.parse(localStorage.getItem(DEMO_THROTTLE_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      values: { "orders-processor-outflow-throttle": 800 }
    });

    resetDemoThrottleValues();
    expect(localStorage.getItem(DEMO_THROTTLE_STORAGE_KEY)).toBeNull();
  });
});
