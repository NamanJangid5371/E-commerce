import { prisma } from "@/server/db";
import { isDbUnavailable } from "@/server/http";
import { logger } from "@/server/logger";
import { getSotStatus } from "@/server/sot/transactional";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

function portalName() {
  const app = process.env.NEXT_PUBLIC_AVYORA_APP || process.env.AVYORA_APP || "store";
  if (app === "admin") return "admin";
  if (app === "logistics") return "logistics";
  return "store";
}

export async function GET() {
  const timestamp = new Date().toISOString();
  let db = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (error) {
    if (!isDbUnavailable(error)) {
      logger.warn("health.db_check_failed", { error: String(error) });
    }
  }

  const sot = getSotStatus();
  const body = {
    ok: db,
    db,
    portal: portalName(),
    version: process.env.npm_package_version || "0.1.0",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp,
    /** Proof: transactional domains are PostgreSQL-owned. */
    sot,
  };

  if (!db) {
    return Response.json(body, { status: 503 });
  }

  return Response.json(body);
}
