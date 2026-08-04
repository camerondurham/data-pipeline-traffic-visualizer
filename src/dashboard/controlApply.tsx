import { createContext, useContext, type ReactNode } from "react";
import type { OverlayControlValueUpdateRequest } from "../runtime/types";

export type OverlayControlApplyCallback = (request: OverlayControlValueUpdateRequest) => Promise<void>;

const OverlayControlApplyContext = createContext<OverlayControlApplyCallback | undefined>(undefined);

export function OverlayControlApplyProvider({
  apply,
  children
}: {
  apply?: OverlayControlApplyCallback;
  children: ReactNode;
}) {
  return <OverlayControlApplyContext.Provider value={apply}>{children}</OverlayControlApplyContext.Provider>;
}

export function useOverlayControlApply(): OverlayControlApplyCallback | undefined {
  return useContext(OverlayControlApplyContext);
}
