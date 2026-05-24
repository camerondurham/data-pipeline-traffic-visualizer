import { z, ZodError } from "zod";

const RequiredString = z.string().min(1);
export const ArchitectureZoneSchema = z.enum(["pre_aggregate", "aggregate", "hot", "cold", "partner"]);

export const ArchitectureNodeSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    type: RequiredString,
    region: RequiredString,
    zone: ArchitectureZoneSchema,
    parent: RequiredString.optional(),
    collapsed: z.boolean().optional()
  })
  .strict();

export const ArchitectureEdgeSchema = z
  .object({
    id: RequiredString,
    from: RequiredString,
    to: RequiredString,
    type: RequiredString,
    label: RequiredString.optional()
  })
  .strict();

export const FlowLaneSchema = z
  .object({
    id: RequiredString,
    label: RequiredString
  })
  .strict();

export const FlowStageSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    lane: RequiredString,
    node_ids: z.array(RequiredString).min(1)
  })
  .strict();

export const RegionViewSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    mode: z.literal("region"),
    region: RequiredString,
    lanes: z.array(FlowLaneSchema).optional(),
    stages: z.array(FlowStageSchema).optional()
  })
  .strict();

export const CrossRegionViewSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    mode: z.literal("cross_region"),
    group_by: z.literal("destination_region")
  })
  .strict();

export const FocusViewSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    mode: z.literal("focus"),
    focus_edges: z.array(RequiredString).min(1),
    primary_edges: z.array(RequiredString).min(1),
    secondary_edges: z.array(RequiredString).default([])
  })
  .strict();

export const ArchitectureViewSchema = z.discriminatedUnion("mode", [
  RegionViewSchema,
  CrossRegionViewSchema,
  FocusViewSchema
]);

export const ArchitectureManifestSchema = z
  .object({
    nodes: z.array(ArchitectureNodeSchema).min(1),
    edges: z.array(ArchitectureEdgeSchema).min(1),
    views: z.array(ArchitectureViewSchema).min(1)
  })
  .strict();

export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;
export type ArchitectureEdge = z.infer<typeof ArchitectureEdgeSchema>;
export type FlowLane = z.infer<typeof FlowLaneSchema>;
export type FlowStage = z.infer<typeof FlowStageSchema>;
export type RegionView = z.infer<typeof RegionViewSchema>;
export type CrossRegionView = z.infer<typeof CrossRegionViewSchema>;
export type FocusView = z.infer<typeof FocusViewSchema>;
export type ArchitectureView = z.infer<typeof ArchitectureViewSchema>;
export type ArchitectureManifest = z.infer<typeof ArchitectureManifestSchema>;

export function formatValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "manifest";
        return `${path}: ${issue.message}`;
      })
      .join("\n");
  }

  return error instanceof Error ? error.message : "Unknown validation error";
}

export function validateArchitectureManifest(input: unknown): ArchitectureManifest {
  return ArchitectureManifestSchema.parse(input);
}
