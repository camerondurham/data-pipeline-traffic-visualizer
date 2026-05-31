import type { OverlayControl, OverlayControlApplyPhase, OverlayControlValue } from "../zod";

export interface ControlApplyRequest {
  control: OverlayControl;
  desiredValue?: OverlayControlValue;
  priority?: number;
  requestedAt: string;
}

export interface ControlApplyResult {
  operationId: string;
  message?: string;
}

export interface ControlPollResult {
  phase: Exclude<OverlayControlApplyPhase, "idle">;
  effectiveValue?: OverlayControlValue;
  message?: string;
  observedAt?: string;
}

export interface OverlayControlHandler {
  apply(request: ControlApplyRequest): Promise<ControlApplyResult>;
  poll(operationId: string): Promise<ControlPollResult>;
}

interface SimulatedOperation {
  effectiveValue?: OverlayControlValue;
}

export class SimulatedThrottleConfigHandler implements OverlayControlHandler {
  private sequence = 0;
  private readonly operations = new Map<string, SimulatedOperation>();

  async apply(request: ControlApplyRequest): Promise<ControlApplyResult> {
    this.sequence += 1;
    const operationId = `sim-throttle-${this.sequence}`;
    this.operations.set(operationId, {
      effectiveValue: request.desiredValue
    });
    return {
      operationId,
      message: "Queued simulated throttle config update; waiting for generated config observation."
    };
  }

  async poll(operationId: string): Promise<ControlPollResult> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      return {
        phase: "failed",
        observedAt: new Date().toISOString(),
        message: `Operation ${operationId} is no longer tracked`
      };
    }
    this.operations.delete(operationId);
    return {
      phase: "applied",
      effectiveValue: operation.effectiveValue,
      observedAt: new Date().toISOString(),
      message: "Observed generated throttle config with requested value."
    };
  }
}

export function createDefaultControlHandlers(): Record<string, OverlayControlHandler> {
  return {
    "simulated-throttle-config": new SimulatedThrottleConfigHandler()
  };
}
