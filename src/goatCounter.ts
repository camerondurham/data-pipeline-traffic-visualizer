export const GOATCOUNTER_SCRIPT_SRC = "//gc.zgo.at/count.js";

type Env = Record<string, string | undefined>;

export interface HeadScriptTag {
  tag: "script";
  attrs: Record<string, string | boolean>;
  injectTo: "head";
}

export function getGoatCounterCountUrl(env: Env): string | undefined {
  if (env.VITE_STATIC_DEMO !== "1") {
    return undefined;
  }

  const countUrl = env.VITE_GOATCOUNTER_COUNT_URL?.trim();
  return countUrl || undefined;
}

export function buildGoatCounterHeadTags(env: Env): HeadScriptTag[] {
  const countUrl = getGoatCounterCountUrl(env);
  if (!countUrl) {
    return [];
  }

  return [
    {
      tag: "script",
      attrs: {
        "data-goatcounter": countUrl,
        async: true,
        src: GOATCOUNTER_SCRIPT_SRC
      },
      injectTo: "head"
    }
  ];
}
