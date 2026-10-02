import { PERMISSIONS } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonOk } from "@/server/http";
import { getRecommendationAnalytics } from "@/server/recommendations/analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureDb();
    // Staff with report access; SUPER_ADMIN (*) included via hasPermission.
    await requirePermission(request, PERMISSIONS.REPORT_VIEW);

    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30) || 30, 1), 365);
    const analytics = await getRecommendationAnalytics(days);

    return jsonOk({
      periodDays: days,
      ...analytics,
      revenueAttributed: null,
      note:
        analytics.impressions === 0 && analytics.clicks === 0
          ? "No recommendation events in this period yet — browse the storefront to generate impressions, or restart admin after prisma migrate if events already exist."
          : "Revenue attribution is null until purchase events are linked to recommendation click ids.",
    });
  } catch (error) {
    return handleApiError(error, "admin/analytics/recommendations GET");
  }
}
