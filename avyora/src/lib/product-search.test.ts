import { describe, expect, it } from "vitest";
import { productMatchesQuery, tokenizeSearchText } from "@/lib/product-search";

describe("productMatchesQuery", () => {
  const ring = {
    name: "Aurelia Solitaire Ring",
    category: "Rings",
    tags: ["solitaire", "diamond"],
  };
  const earring = {
    name: "Iris Drop Earrings",
    category: "Earrings",
    tags: ["drop", "flora"],
  };

  it("matches rings without returning earrings", () => {
    expect(productMatchesQuery(ring, "rings")).toBe(true);
    expect(productMatchesQuery(ring, "ring")).toBe(true);
    expect(productMatchesQuery(earring, "rings")).toBe(false);
    expect(productMatchesQuery(earring, "ring")).toBe(false);
  });

  it("matches earrings without returning rings", () => {
    expect(productMatchesQuery(earring, "earrings")).toBe(true);
    expect(productMatchesQuery(earring, "earring")).toBe(true);
    expect(productMatchesQuery(ring, "earrings")).toBe(false);
  });

  it("still finds multi-word queries", () => {
    expect(productMatchesQuery(ring, "solitaire ring")).toBe(true);
    expect(productMatchesQuery(earring, "drop earrings")).toBe(true);
    expect(productMatchesQuery(earring, "solitaire ring")).toBe(false);
  });

  it("stems simple plurals", () => {
    expect(tokenizeSearchText("Rings")).toEqual(["ring"]);
    expect(tokenizeSearchText("Earrings")).toEqual(["earring"]);
  });
});
