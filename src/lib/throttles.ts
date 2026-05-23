import type { ArchitectureNode, ThrottleRule, ThrottleSnapshot, ThrottleType } from "../types";

export interface RuleQuery {
  schema: string;
  contributor: string;
}

export interface RuleComparison {
  id: string;
  desired?: ThrottleRule;
  live?: ThrottleRule;
  status: "match" | "drift" | "missingLive" | "missingDesired";
  driftFields: string[];
}

export function getSupportedThrottleTypes(node: ArchitectureNode | undefined): ThrottleType[] {
  return node?.throttleTypes ?? [];
}

export function sortRulesByPriority(rules: ThrottleRule[]): ThrottleRule[] {
  return [...rules].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

export function getRulesForService(
  snapshot: ThrottleSnapshot,
  serviceId: string,
  supportedTypes: ThrottleType[] = []
): ThrottleRule[] {
  const rules = snapshot.services[serviceId]?.rules ?? [];
  const filteredRules =
    supportedTypes.length === 0
      ? rules
      : rules.filter((rule) => supportedTypes.includes(rule.throttleType));
  return sortRulesByPriority(filteredRules);
}

function dimensionMatches(configuredValue: string, actualValue: string): boolean {
  return configuredValue === "*" || configuredValue === actualValue;
}

export function ruleMatches(rule: ThrottleRule, query: RuleQuery): boolean {
  return (
    dimensionMatches(rule.dimensions.schema, query.schema) &&
    dimensionMatches(rule.dimensions.contributor, query.contributor)
  );
}

export function getApplicableRules(rules: ThrottleRule[], query: RuleQuery): ThrottleRule[] {
  return sortRulesByPriority(rules.filter((rule) => rule.enabled && ruleMatches(rule, query)));
}

function compareRules(desired: ThrottleRule, live: ThrottleRule): string[] {
  const fields: string[] = [];
  if (desired.throttleType !== live.throttleType) fields.push("type");
  if (desired.dimensions.schema !== live.dimensions.schema) fields.push("schema");
  if (desired.dimensions.contributor !== live.dimensions.contributor) fields.push("contributor");
  if (desired.minTps !== live.minTps) fields.push("min");
  if (desired.maxTps !== live.maxTps) fields.push("max");
  if (desired.priority !== live.priority) fields.push("priority");
  if (desired.enabled !== live.enabled) fields.push("enabled");
  return fields;
}

export function compareThrottleSnapshots(
  desiredRules: ThrottleRule[],
  liveRules: ThrottleRule[]
): RuleComparison[] {
  const desiredById = new Map(desiredRules.map((rule) => [rule.id, rule]));
  const liveById = new Map(liveRules.map((rule) => [rule.id, rule]));
  const ids = [...new Set([...desiredById.keys(), ...liveById.keys()])].sort();

  return ids.map((id) => {
    const desired = desiredById.get(id);
    const live = liveById.get(id);

    if (!desired) {
      return { id, live, status: "missingDesired", driftFields: ["desired"] };
    }
    if (!live) {
      return { id, desired, status: "missingLive", driftFields: ["live"] };
    }

    const driftFields = compareRules(desired, live);
    return {
      id,
      desired,
      live,
      status: driftFields.length > 0 ? "drift" : "match",
      driftFields
    };
  });
}

export function hasThrottleDriftForService(
  desiredSnapshot: ThrottleSnapshot,
  liveSnapshot: ThrottleSnapshot,
  node: ArchitectureNode
): boolean {
  const supportedTypes = getSupportedThrottleTypes(node);
  const comparisons = compareThrottleSnapshots(
    getRulesForService(desiredSnapshot, node.id, supportedTypes),
    getRulesForService(liveSnapshot, node.id, supportedTypes)
  );
  return comparisons.some((comparison) => comparison.status !== "match");
}
