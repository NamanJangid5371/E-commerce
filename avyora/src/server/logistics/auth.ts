import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import type { AuthContext } from "@/server/auth/rbac";

export function canViewLogistics(session: AuthContext | null): session is AuthContext {
  if (!session) return false;
  return (
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE)
  );
}

export function canManageLogistics(session: AuthContext | null): session is AuthContext {
  if (!session) return false;
  return hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE);
}
