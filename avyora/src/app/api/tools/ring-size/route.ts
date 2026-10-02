import {
  convertRingSize,
  getRingSizeRow,
  recommendIndiaSize,
  RING_SIZE_TABLE,
  type RingSizeSystem,
} from "@/server/pricing/ring-size";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SYSTEMS = ["INDIA", "US", "UK", "EU"] as const;

const recommendSchema = z.object({
  circumferenceMm: z.number().positive(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = (url.searchParams.get("from") ?? "INDIA").toUpperCase() as RingSizeSystem;
    const to = (url.searchParams.get("to") ?? "US").toUpperCase() as RingSizeSystem;
    const value = url.searchParams.get("value");

    if (!SYSTEMS.includes(from as (typeof SYSTEMS)[number]) || !SYSTEMS.includes(to as (typeof SYSTEMS)[number])) {
      return jsonError("Invalid size system. Use INDIA, US, UK, or EU.", 400);
    }

    if (value) {
      const converted = convertRingSize(from, to, value);
      if (!converted) return jsonError("Size not found in conversion table", 404);
      const row = getRingSizeRow(from, value);
      return jsonOk({ from, to, value, converted, row });
    }

    return jsonOk({ table: RING_SIZE_TABLE, systems: SYSTEMS });
  } catch (error) {
    return handleApiError(error, "tools/ring-size GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, recommendSchema);
    const indiaSize = recommendIndiaSize(body.circumferenceMm);

    if (!indiaSize) {
      return jsonError("Invalid circumference", 400);
    }

    const row = getRingSizeRow("INDIA", indiaSize);

    return jsonOk({
      circumferenceMm: body.circumferenceMm,
      recommendedIndiaSize: indiaSize,
      row,
      conversions: {
        us: convertRingSize("INDIA", "US", indiaSize),
        uk: convertRingSize("INDIA", "UK", indiaSize),
        eu: convertRingSize("INDIA", "EU", indiaSize),
      },
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "tools/ring-size POST");
  }
}
