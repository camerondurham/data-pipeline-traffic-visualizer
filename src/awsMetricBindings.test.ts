import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  AwsMetricBindingValidationError,
  overlayDecoratorIdForBinding,
  validateAwsMetricBindingsDocument
} from "./awsMetricBindings";
import { validateArchitectureDocuments } from "./server/runtimeValidation";

function loadArchitecture() {
  return validateArchitectureDocuments(
    readFileSync("data/sample/architecture.yaml", "utf8"),
    readFileSync("data/sample/architecture-overlays.yaml", "utf8")
  );
}

function loadMetricBindingsInput(): unknown {
  return parse(readFileSync("data/sample/metric-bindings.yaml", "utf8"));
}

describe("AWS metric bindings", () => {
  it("validates the sample metric binding registry against graph IDs", () => {
    const architecture = loadArchitecture();
    const document = validateAwsMetricBindingsDocument(
      architecture.manifest,
      architecture.overlays,
      loadMetricBindingsInput()
    );

    expect(document.metric_bindings).toHaveLength(4);
    expect(document.metric_bindings.map(overlayDecoratorIdForBinding)).toContain(
      "aws-use1-orders-ingestion-incoming-records"
    );
  });

  it("rejects missing graph targets before CloudWatch is queried", () => {
    const architecture = loadArchitecture();
    const input = loadMetricBindingsInput() as { metric_bindings: Array<{ target: { id: string } }> };
    input.metric_bindings[0].target.id = "missing.node";

    expect(() => validateAwsMetricBindingsDocument(architecture.manifest, architecture.overlays, input)).toThrow(
      AwsMetricBindingValidationError
    );
    expect(() => validateAwsMetricBindingsDocument(architecture.manifest, architecture.overlays, input)).toThrow(
      /missing node/
    );
  });

  it("rejects duplicate output decorator IDs", () => {
    const architecture = loadArchitecture();
    const input = loadMetricBindingsInput() as { metric_bindings: Array<{ overlay: { decorator_id: string } }> };
    input.metric_bindings[1].overlay.decorator_id = input.metric_bindings[0].overlay.decorator_id;

    expect(() => validateAwsMetricBindingsDocument(architecture.manifest, architecture.overlays, input)).toThrow(
      /Duplicate metric overlay decorator id/
    );
  });
});
