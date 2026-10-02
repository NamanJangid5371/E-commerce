import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { createHash } from "crypto";
import { z } from "zod";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  experimentKey: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().optional(),
});

function hashSession(experimentKey: string, sessionId: string): number {
  const digest = createHash("sha256").update(`${experimentKey}:${sessionId}`).digest();
  return digest.readUInt32BE(0);
}

function pickVariant(
  variants: { id: string; key: string; weight: number; config: unknown }[],
  bucket: number,
): { id: string; key: string; weight: number; config: unknown } {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let cursor = bucket % totalWeight;

  for (const variant of variants) {
    cursor -= variant.weight;
    if (cursor < 0) return variant;
  }

  return variants[variants.length - 1];
}

export async function POST(request: Request) {
  try {
    await ensureDb();

    const body = await parseJson(request, assignSchema);

    const experiment = await prisma.experiment.findUnique({
      where: { key: body.experimentKey },
      include: { variants: true },
    });

    if (!experiment || experiment.status !== "RUNNING" || experiment.variants.length === 0) {
      return jsonError("Experiment not available", 404);
    }

    const existing = await prisma.experimentExposure.findUnique({
      where: {
        experimentId_sessionId: {
          experimentId: experiment.id,
          sessionId: body.sessionId,
        },
      },
      include: { variant: true },
    });

    if (existing) {
      return jsonOk({
        experimentKey: body.experimentKey,
        variantKey: existing.variant.key,
        variantId: existing.variantId,
        assigned: false,
      });
    }

    const bucket = hashSession(body.experimentKey, body.sessionId);
    const variant = pickVariant(experiment.variants, bucket);

    await prisma.experimentExposure.create({
      data: {
        experimentId: experiment.id,
        variantId: variant.id,
        sessionId: body.sessionId,
        userId: body.userId,
      },
    });

    return jsonOk({
      experimentKey: body.experimentKey,
      variantKey: variant.key,
      variantId: variant.id,
      config: variant.config,
      assigned: true,
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "experiments/assign POST");
  }
}
