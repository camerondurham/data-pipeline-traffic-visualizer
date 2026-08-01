import { z, ZodError } from "zod";
import type { ArchitectureManifest, ArchitectureOverlays } from "./zod";

const RequiredString = z.string().min(1);
const OverlayToneSchema = z.enum(["default", "primary", "secondary", "cross", "read"]);

const AwsMetricBindingTargetSchema = z
  .object({
    kind: z.enum(["node", "edge", "route"]),
    id: RequiredString
  })
  .strict();

const AwsMetricBindingCloudWatchSchema = z
  .object({
    account_id: z.string().regex(/^\d{12}$/, "account_id must be a 12 digit AWS account ID").optional(),
    region: RequiredString,
    namespace: RequiredString,
    metric_name: RequiredString,
    dimensions: z.record(RequiredString, RequiredString).default({}),
    statistic: RequiredString,
    period_seconds: z.number().int().positive().default(300),
    unit: RequiredString.optional()
  })
  .strict();

const AwsMetricWarningSchema = z
  .object({
    gte: z.number().optional(),
    gt: z.number().optional(),
    lte: z.number().optional(),
    lt: z.number().optional()
  })
  .strict()
  .refine((warning) => Object.values(warning).some((value) => value !== undefined), {
    message: "at least one warning threshold is required"
  });

const AwsMetricBindingOverlaySchema = z
  .object({
    decorator_id: RequiredString.optional(),
    title: RequiredString.optional(),
    label: RequiredString,
    unit: RequiredString.optional(),
    precision: z.number().int().min(0).max(6).default(0),
    scale: z.number().positive().default(1),
    badges: z.array(RequiredString).default(["aws"]),
    missing_badge: RequiredString.default("stale"),
    error_badge: RequiredString.default("error"),
    warning: AwsMetricWarningSchema.optional(),
    tone: OverlayToneSchema.optional(),
    thickness: z.number().positive().optional()
  })
  .strict();

const AwsMetricBindingSchema = z
  .object({
    id: RequiredString,
    target: AwsMetricBindingTargetSchema,
    cloudwatch: AwsMetricBindingCloudWatchSchema,
    overlay: AwsMetricBindingOverlaySchema
  })
  .strict();

const AwsMetricBindingsDocumentSchema = z
  .object({
    metric_bindings: z.array(AwsMetricBindingSchema).default([])
  })
  .strict();

export type AwsMetricBinding = z.infer<typeof AwsMetricBindingSchema>;
type AwsMetricBindingsDocument = z.infer<typeof AwsMetricBindingsDocumentSchema>;

export class AwsMetricBindingValidationError extends Error {
  readonly diagnostics: string[];

  constructor(diagnostics: string[]) {
    super(diagnostics.join("\n"));
    this.name = "AwsMetricBindingValidationError";
    this.diagnostics = diagnostics;
  }
}

export function overlayDecoratorIdForBinding(binding: AwsMetricBinding): string {
  return binding.overlay.decorator_id ?? `aws-${binding.id}`;
}

function parseAwsMetricBindingsDocument(input: unknown): AwsMetricBindingsDocument {
  try {
    return AwsMetricBindingsDocumentSchema.parse(input ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AwsMetricBindingValidationError(
        error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "metric_bindings";
          return `${path}: ${issue.message}`;
        })
      );
    }
    throw error;
  }
}

export function validateAwsMetricBindingsDocument(
  manifest: ArchitectureManifest,
  overlays: ArchitectureOverlays,
  input: unknown
): AwsMetricBindingsDocument {
  const document = parseAwsMetricBindingsDocument(input);
  const diagnostics: string[] = [];
  const nodeIds = new Set(manifest.nodes.map((node) => node.id));
  const edgeIds = new Set(manifest.edges.map((edge) => edge.id));
  const routeIds = new Set(overlays.route_decorators.map((decorator) => decorator.id));
  const bindingIds = new Set<string>();
  const decoratorIds = new Set<string>();

  for (const binding of document.metric_bindings) {
    if (bindingIds.has(binding.id)) {
      diagnostics.push(`Duplicate metric binding id: ${binding.id}`);
    }
    bindingIds.add(binding.id);

    const decoratorId = overlayDecoratorIdForBinding(binding);
    if (decoratorIds.has(decoratorId)) {
      diagnostics.push(`Duplicate metric overlay decorator id: ${decoratorId}`);
    }
    decoratorIds.add(decoratorId);

    if (binding.target.kind === "node" && !nodeIds.has(binding.target.id)) {
      diagnostics.push(`Metric binding ${binding.id} references missing node: ${binding.target.id}`);
    }
    if (binding.target.kind === "edge" && !edgeIds.has(binding.target.id)) {
      diagnostics.push(`Metric binding ${binding.id} references missing edge: ${binding.target.id}`);
    }
    if (binding.target.kind === "route" && !routeIds.has(binding.target.id)) {
      diagnostics.push(`Metric binding ${binding.id} references missing route decorator: ${binding.target.id}`);
    }
  }

  if (diagnostics.length > 0) {
    throw new AwsMetricBindingValidationError(diagnostics);
  }

  return document;
}
