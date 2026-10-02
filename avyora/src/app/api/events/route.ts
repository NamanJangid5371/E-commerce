import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { ingestUserEvent, trackEventSchema } from "@/server/recommendations/events";
import { logger } from "@/server/logger";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureDb();
    const ip = clientIpFromRequest(request) ?? "unknown";
    const limited = rateLimit(`events:${ip}`, 120, 60_000);
    if (!limited.ok) {
      return jsonError("Too many events. Please slow down.", 429);
    }

    const body = await parseJson(request, trackEventSchema);

    let userId: string | null = null;
    try {
      const session = await getSessionFromRequest(request);
      userId = session?.userId ?? null;
    } catch (error) {
      logger.warn("events.session_read_failed", { error: String(error) });
    }

    const anonId = userId ? null : body.anonId ?? null;
    if (!userId && !anonId) {
      return jsonError("anonId is required for anonymous tracking.", 400);
    }

    const result = await ingestUserEvent({
      userId,
      anonId,
      eventType: body.eventType,
      productId: body.productId,
      categoryId: body.categoryId,
      searchQuery: body.searchQuery,
      metadata: body.metadata,
    });

    // Never fail the storefront hard for analytics ingestion.
    return jsonOk({ tracked: Boolean(result.ok), id: result.id }, result.ok ? 201 : 202);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    logger.warn("events.post_failed", { error: String(error) });
    // Soft-fail: tracking must not break shopping.
    return jsonOk({ tracked: false }, 202);
  }
}
