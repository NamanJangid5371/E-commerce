import { describe, expect, it } from "vitest";
import { hasAnyPermission, hasPermission, PERMISSIONS } from "./permissions";

describe("hasPermission", () => {
  it("grants all permissions with wildcard", () => {
    expect(hasPermission(["*"], PERMISSIONS.PRODUCT_VIEW)).toBe(true);
    expect(hasPermission(["*"], PERMISSIONS.ORDER_REFUND)).toBe(true);
  });

  it("grants all permissions with SUPER_ADMIN code", () => {
    expect(hasPermission(["SUPER_ADMIN"], PERMISSIONS.PRODUCT_VIEW)).toBe(true);
    expect(hasPermission(["SUPER_ADMIN"], PERMISSIONS.SETTINGS_MANAGE)).toBe(true);
  });

  it("checks specific permission codes", () => {
    const permissions = [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.ORDER_VIEW];

    expect(hasPermission(permissions, PERMISSIONS.PRODUCT_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.ORDER_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.PRODUCT_DELETE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.COUPON_MANAGE)).toBe(false);
  });
});

describe("hasAnyPermission", () => {
  it("returns true when any listed permission matches", () => {
    const permissions = [PERMISSIONS.PRODUCT_VIEW];
    expect(
      hasAnyPermission(permissions, [PERMISSIONS.ORDER_VIEW, PERMISSIONS.PRODUCT_VIEW]),
    ).toBe(true);
  });

  it("returns false when none match", () => {
    const permissions = [PERMISSIONS.PRODUCT_VIEW];
    expect(
      hasAnyPermission(permissions, [PERMISSIONS.ORDER_VIEW, PERMISSIONS.CUSTOMER_VIEW]),
    ).toBe(false);
  });

  it("respects wildcard", () => {
    expect(hasAnyPermission(["*"], [PERMISSIONS.SETTINGS_MANAGE])).toBe(true);
  });
});
