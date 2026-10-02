import { describe, expect, it } from "vitest";
import { convertRingSize, recommendIndiaSize } from "./ring-size";

describe("convertRingSize", () => {
  it("roundtrips India to US and back", () => {
    const indiaSize = "12";
    const usSize = convertRingSize("INDIA", "US", indiaSize);

    expect(usSize).toBe("6.5");

    const backToIndia = convertRingSize("US", "INDIA", usSize!);
    expect(backToIndia).toBe(indiaSize);
  });

  it("roundtrips US to India and back", () => {
    const usSize = "7";
    const indiaSize = convertRingSize("US", "INDIA", usSize);

    expect(indiaSize).toBe("13");

    const backToUs = convertRingSize("INDIA", "US", indiaSize!);
    expect(backToUs).toBe(usSize);
  });
});

describe("recommendIndiaSize", () => {
  it("returns closest India size for circumference", () => {
    expect(recommendIndiaSize(54.4)).toBe("12");
  });

  it("returns null for invalid circumference", () => {
    expect(recommendIndiaSize(0)).toBeNull();
    expect(recommendIndiaSize(-10)).toBeNull();
    expect(recommendIndiaSize(Number.NaN)).toBeNull();
  });
});
