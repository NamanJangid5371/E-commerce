/** Accept Prisma JWT permission codes and legacy commerce roster codes. */
export function hasLogisticsAccess(permissions: string[] | undefined) {
  if (!permissions?.length) return false;
  return (
    permissions.includes("*") ||
    permissions.includes("SUPER_ADMIN") ||
    permissions.includes("ORDER_VIEW") ||
    permissions.includes("ORDER_UPDATE") ||
    permissions.includes("DISPATCH") ||
    permissions.includes("orders") ||
    permissions.includes("shipping") ||
    permissions.includes("dispatch")
  );
}

/** Partner desk — last-mile / COD (not warehouse packing). */
export function hasDispatchAccess(permissions: string[] | undefined) {
  if (!permissions?.length) return false;
  return (
    permissions.includes("*") ||
    permissions.includes("SUPER_ADMIN") ||
    permissions.includes("DISPATCH") ||
    permissions.includes("dispatch") ||
    permissions.includes("ORDER_UPDATE") ||
    permissions.includes("shipping")
  );
}

/** True when the account is a delivery partner only (no warehouse ops). */
export function isDispatchOnly(permissions: string[] | undefined) {
  if (!permissions?.length) return false;
  if (
    permissions.includes("*") ||
    permissions.includes("SUPER_ADMIN") ||
    permissions.includes("ORDER_UPDATE") ||
    permissions.includes("ORDER_VIEW") ||
    permissions.includes("shipping") ||
    permissions.includes("orders")
  ) {
    return false;
  }
  return permissions.includes("DISPATCH") || permissions.includes("dispatch");
}
