import { PERMISSIONS } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  purity: z.string().min(1),
  ratePerGram: z.number().positive(),
  unit: z.string().default("INR"),
  source: z.string().optional(),
  effectiveAt: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  try {
    await ensureDb();
    await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);

    const url = new URL(request.url);
    const purity = url.searchParams.get("purity");

    const rates = await prisma.goldRate.findMany({
      where: purity ? { purity } : undefined,
      orderBy: { effectiveAt: "desc" },
      take: purity ? 10 : 50,
    });

    return jsonOk(rates);
  } catch (error) {
    return handleApiError(error, "admin/gold-rates GET");
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);

    const body = await parseJson(request, createSchema);

    const rate = await prisma.goldRate.create({
      data: {
        purity: body.purity,
        ratePerGram: body.ratePerGram,
        unit: body.unit,
        source: body.source,
        effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : new Date(),
      },
    });

    return jsonOk(rate, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "admin/gold-rates POST");
  }
}
