export const PERMISSIONS = {
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_CREATE: "PRODUCT_CREATE",
  PRODUCT_UPDATE: "PRODUCT_UPDATE",
  PRODUCT_DELETE: "PRODUCT_DELETE",
  ORDER_VIEW: "ORDER_VIEW",
  ORDER_UPDATE: "ORDER_UPDATE",
  ORDER_CANCEL: "ORDER_CANCEL",
  ORDER_REFUND: "ORDER_REFUND",
  /** 3rd-party / local dispatch partners — last-mile + COD doorstep only. */
  DISPATCH: "DISPATCH",
  CUSTOMER_VIEW: "CUSTOMER_VIEW",
  CUSTOMER_UPDATE: "CUSTOMER_UPDATE",
  INVENTORY_VIEW: "INVENTORY_VIEW",
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  REPORT_VIEW: "REPORT_VIEW",
  SETTINGS_MANAGE: "SETTINGS_MANAGE",
  MEDIA_MANAGE: "MEDIA_MANAGE",
  REVIEW_MODERATE: "REVIEW_MODERATE",
  COUPON_MANAGE: "COUPON_MANAGE",
  SUPER_ADMIN: "*",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(userPermissions: string[], required: string): boolean {
  if (userPermissions.includes("*") || userPermissions.includes("SUPER_ADMIN")) {
    return true;
  }
  return userPermissions.includes(required);
}

/** True if the session has any of the listed permissions (or wildcard). */
export function hasAnyPermission(userPermissions: string[], required: string[]): boolean {
  return required.some((code) => hasPermission(userPermissions, code));
}
