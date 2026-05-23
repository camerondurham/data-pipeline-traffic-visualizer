import desiredFixture from "../../public/config/desired-throttles.json";
import liveFixture from "../../public/config/live-throttles.json";
import { getApplicableRules, getRulesForService, compareThrottleSnapshots, ruleMatches } from "./throttles";
import { parseThrottleSnapshot } from "./parsers";

describe("throttle rule helpers", () => {
  const desired = parseThrottleSnapshot(desiredFixture, "desired");
  const live = parseThrottleSnapshot(liveFixture, "live");

  it("matches wildcard schema and contributor values", () => {
    const [rule] = getRulesForService(desired, "stream-router").filter((candidate) => candidate.id === "router-default");

    expect(ruleMatches(rule!, { schema: "order_event", contributor: "partner-c" })).toBe(true);
  });

  it("returns applicable rules in priority order", () => {
    const rules = getRulesForService(desired, "stream-router");
    const applicable = getApplicableRules(rules, { schema: "product_event", contributor: "partner-c" });

    expect(applicable.map((rule) => rule.id)).toEqual([
      "router-partner-c",
      "router-products-hot",
      "router-default"
    ]);
  });

  it("detects desired vs live drift in min, max, priority, and enabled fields", () => {
    const comparisons = compareThrottleSnapshots(
      getRulesForService(desired, "stream-router"),
      getRulesForService(live, "stream-router")
    );
    const partnerRule = comparisons.find((comparison) => comparison.id === "router-partner-c");

    expect(partnerRule?.status).toBe("drift");
    expect(partnerRule?.driftFields).toContain("enabled");
  });

  it("supports slow-lane rules for throttled traffic replay", () => {
    const rules = getRulesForService(desired, "hot-index-slow-lane");
    const applicable = getApplicableRules(rules, { schema: "order_event", contributor: "partner-a" });

    expect(applicable[0]?.id).toBe("hot-slow-drain");
  });
});
