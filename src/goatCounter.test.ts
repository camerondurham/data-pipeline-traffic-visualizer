import { buildGoatCounterHeadTags, GOATCOUNTER_SCRIPT_SRC, getGoatCounterCountUrl } from "./goatCounter";

describe("sample demo telemetry", () => {
  it("does not enable GoatCounter outside the static demo", () => {
    expect(
      getGoatCounterCountUrl({
        VITE_STATIC_DEMO: undefined,
        VITE_GOATCOUNTER_COUNT_URL: "https://u64cam.goatcounter.com/count"
      })
    ).toBeUndefined();
  });

  it("requires an explicit GoatCounter endpoint for the static demo", () => {
    expect(
      buildGoatCounterHeadTags({
        VITE_STATIC_DEMO: "1",
        VITE_GOATCOUNTER_COUNT_URL: " "
      })
    ).toEqual([]);
  });

  it("adds the website GoatCounter script for the deployed static demo", () => {
    expect(
      buildGoatCounterHeadTags({
        VITE_STATIC_DEMO: "1",
        VITE_GOATCOUNTER_COUNT_URL: "https://u64cam.goatcounter.com/count"
      })
    ).toEqual([
      {
        tag: "script",
        attrs: {
          "data-goatcounter": "https://u64cam.goatcounter.com/count",
          async: true,
          src: GOATCOUNTER_SCRIPT_SRC
        },
        injectTo: "head"
      }
    ]);
  });
});
