import type { DeliveryPartnerRecord } from "@/data/admin-ops";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import type { AuthContext } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";

export type DispatchPartnerScope = {
  /** When set, partner may only see/act on orders assigned to this courier name. */
  partnerName: string | null;
  partner: DeliveryPartnerRecord | null;
  /** Warehouse ops / super admin can monitor all partners. */
  isOpsOverseer: boolean;
};

export function canAccessDispatch(session: AuthContext | null): session is AuthContext {
  if (!session) return false;
  return (
    hasPermission(session.permissions, PERMISSIONS.DISPATCH) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) ||
    hasPermission(session.permissions, PERMISSIONS.SUPER_ADMIN)
  );
}

export function canManageDispatchJobs(session: AuthContext | null): session is AuthContext {
  return canAccessDispatch(session);
}

/** Resolve which 3rd-party partner this staff session belongs to (by email match). */
export function resolveDispatchPartnerScope(session: AuthContext): DispatchPartnerScope {
  const commerce = loadCommerce();
  const partners = (commerce.ops?.deliveryPartners ?? []).filter((p) => p.active !== false);
  const email = session.email.trim().toLowerCase();
  const partner =
    partners.find((p) => p.email?.trim().toLowerCase() === email) ?? null;

  const isOpsOverseer =
    !partner &&
    (hasPermission(session.permissions, PERMISSIONS.SUPER_ADMIN) ||
      hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE));

  // Pure DISPATCH role without a matching partner email → no jobs (misconfigured).
  if (!partner && hasPermission(session.permissions, PERMISSIONS.DISPATCH) && !isOpsOverseer) {
    return { partnerName: "__unassigned_partner__", partner: null, isOpsOverseer: false };
  }

  return {
    partnerName: partner?.name ?? null,
    partner,
    isOpsOverseer,
  };
}

export function orderAssignedToPartner(
  order: { deliveryPartner?: string | null },
  scope: DispatchPartnerScope,
): boolean {
  if (scope.isOpsOverseer && !scope.partnerName) return true;
  if (!scope.partnerName) return false;
  return (order.deliveryPartner ?? "").trim() === scope.partnerName;
}
