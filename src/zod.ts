import { z, ZodError } from "zod";

const RequiredString = z.string().min(1);
const OverlayToneSchema = z.enum(["default", "primary", "secondary", "cross", "read"]);
const OverlayMetricValueSchema = z.union([z.string().min(1), z.number()]);
const OverlayControlValueTypeSchema = z.enum(["string", "number", "boolean"]);
const OverlayControlValueSchema = z.union([z.string().min(1), z.number(), z.boolean()]);
const OverlayControlApplyPhaseSchema = z.enum(["idle", "applying", "applied", "rejected", "failed", "stale"]);
export const ArchitectureZoneSchema = z.enum(["pre_aggregate", "aggregate", "hot", "cold", "partner"]);

export const ArchitectureNodeSchema = z
  .object({
    id: RequiredString,
    label: RequiredString,
    type: RequiredString,
    region: RequiredString,
    zone: ArchitectureZoneSchema,
    parent: RequiredString.optional()
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

export const OverlayMetricSchema = z
  .object({
    label: RequiredString,
    value: OverlayMetricValueSchema
  })
  .strict();

export const NodeDecoratorSchema = z
  .object({
    id: RequiredString,
    node_id: RequiredString,
    title: RequiredString.optional(),
    metrics: z.array(OverlayMetricSchema).default([]),
    badges: z.array(RequiredString).default([]),
    notes: z.array(RequiredString).default([])
  })
  .strict();

export const EdgeDecoratorSchema = z
  .object({
    id: RequiredString,
    edge_id: RequiredString,
    title: RequiredString.optional(),
    metric_label: RequiredString.optional(),
    badges: z.array(RequiredString).default([]),
    metrics: z.array(OverlayMetricSchema).default([]),
    warning: z.boolean().optional(),
    tone: OverlayToneSchema.optional(),
    thickness: z.number().positive().optional()
  })
  .strict();

export const RouteDecoratorSchema = z
  .object({
    id: RequiredString,
    source_node_id: RequiredString,
    title: RequiredString.optional(),
    edge_ids: z.array(RequiredString).min(1),
    metric_label: RequiredString.optional(),
    badges: z.array(RequiredString).default([]),
    metrics: z.array(OverlayMetricSchema).default([]),
    warning: z.boolean().optional(),
    tone: OverlayToneSchema.optional(),
    thickness: z.number().positive().optional()
  })
  .strict();

export const OverlayControlTargetSchema = z
  .object({
    kind: z.enum(["node", "edge", "route"]),
    id: RequiredString
  })
  .strict();

export const OverlayControlDimensionsSchema = z.record(RequiredString, OverlayControlValueSchema).default({});

export const OverlayControlPrioritySpecSchema = z
  .object({
    editable: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional()
  })
  .strict()
  .superRefine((priority, context) => {
    validateNumericRange(priority, context);
  });

export const OverlayControlSpecSchema = z
  .object({
    value_type: OverlayControlValueTypeSchema,
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: RequiredString.optional(),
    priority: OverlayControlPrioritySpecSchema.optional()
  })
  .strict()
  .superRefine((spec, context) => {
    validateNumericRange(spec, context);
    if (spec.value_type !== "number" && (spec.min !== undefined || spec.max !== undefined || spec.step !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min, max, and step are only valid for number controls"
      });
    }
  });

export const OverlayControlApplySchema = z
  .object({
    handler: RequiredString
  })
  .strict();

export const OverlayControlApplyStateSchema = z
  .object({
    phase: OverlayControlApplyPhaseSchema.default("idle"),
    operation_id: RequiredString.optional(),
    requested_at: RequiredString.optional(),
    observed_at: RequiredString.optional(),
    message: RequiredString.optional()
  })
  .strict();

export const OverlayControlStateSchema = z
  .object({
    desired_value: OverlayControlValueSchema,
    effective_value: OverlayControlValueSchema.optional(),
    priority: z.number().optional(),
    apply: OverlayControlApplyStateSchema.default({ phase: "idle" })
  })
  .strict();

export const OverlayControlSchema = z
  .object({
    id: RequiredString,
    target: OverlayControlTargetSchema,
    dimensions: OverlayControlDimensionsSchema,
    label: RequiredString,
    description: RequiredString.optional(),
    apply: OverlayControlApplySchema,
    spec: OverlayControlSpecSchema,
    state: OverlayControlStateSchema
  })
  .strict()
  .superRefine((control, context) => {
    validateControlValue(control.state.desired_value, control.spec, ["state", "desired_value"], context);
    if (control.state.effective_value !== undefined) {
      validateControlValue(control.state.effective_value, control.spec, ["state", "effective_value"], context);
    }
    if (control.state.priority !== undefined) {
      if (!control.spec.priority) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["state", "priority"],
          message: "priority state requires spec.priority"
        });
      } else {
        validateControlNumber(control.state.priority, control.spec.priority, ["state", "priority"], context);
      }
    }
  });

export const ArchitectureOverlaysSchema = z
  .object({
    node_decorators: z.array(NodeDecoratorSchema).default([]),
    edge_decorators: z.array(EdgeDecoratorSchema).default([]),
    route_decorators: z.array(RouteDecoratorSchema).default([]),
    controls: z.array(OverlayControlSchema).default([])
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
export type OverlayMetric = z.infer<typeof OverlayMetricSchema>;
export type NodeDecorator = z.infer<typeof NodeDecoratorSchema>;
export type EdgeDecorator = z.infer<typeof EdgeDecoratorSchema>;
export type RouteDecorator = z.infer<typeof RouteDecoratorSchema>;
export type OverlayControlValue = z.infer<typeof OverlayControlValueSchema>;
export type OverlayControlApplyPhase = z.infer<typeof OverlayControlApplyPhaseSchema>;
export type OverlayControlApply = z.infer<typeof OverlayControlApplySchema>;
export type OverlayControlTarget = z.infer<typeof OverlayControlTargetSchema>;
export type OverlayControlDimensions = z.infer<typeof OverlayControlDimensionsSchema>;
export type OverlayControlPrioritySpec = z.infer<typeof OverlayControlPrioritySpecSchema>;
export type OverlayControlSpec = z.infer<typeof OverlayControlSpecSchema>;
export type OverlayControlApplyState = z.infer<typeof OverlayControlApplyStateSchema>;
export type OverlayControlState = z.infer<typeof OverlayControlStateSchema>;
export type OverlayControl = z.infer<typeof OverlayControlSchema>;
export type ArchitectureOverlays = z.infer<typeof ArchitectureOverlaysSchema>;

export const EMPTY_ARCHITECTURE_OVERLAYS: ArchitectureOverlays = {
  node_decorators: [],
  edge_decorators: [],
  route_decorators: [],
  controls: []
};

function validateNumericRange(
  range: { min?: number; max?: number },
  context: z.RefinementCtx
): void {
  if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min must be less than or equal to max"
    });
  }
}

function validateControlValue(
  value: OverlayControlValue,
  spec: z.infer<typeof OverlayControlSpecSchema>,
  path: Array<string | number>,
  context: z.RefinementCtx
): void {
  if (typeof value !== spec.value_type) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `expected ${spec.value_type} control value`
    });
    return;
  }

  if (spec.value_type === "number") {
    validateControlNumber(value as number, spec, path, context);
  }
}

function validateControlNumber(
  value: number,
  spec: { min?: number; max?: number; step?: number },
  path: Array<string | number>,
  context: z.RefinementCtx
): void {
  if (spec.min !== undefined && value < spec.min) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `value must be greater than or equal to ${spec.min}`
    });
  }
  if (spec.max !== undefined && value > spec.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `value must be less than or equal to ${spec.max}`
    });
  }
  if (spec.step !== undefined) {
    const base = spec.min ?? 0;
    const steps = (value - base) / spec.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `value must align to step ${spec.step}`
      });
    }
  }
}

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

export function validateArchitectureOverlays(input: unknown): ArchitectureOverlays {
  return ArchitectureOverlaysSchema.parse(input ?? {});
}
