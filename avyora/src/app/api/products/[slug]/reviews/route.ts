import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  HttpParseError,
  isDbUnavailable,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10)));
    const skip = (page - 1) * limit;

    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!product) {
      return jsonError("Product not found.", 404);
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { productId: product.id, status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          customer: {
            include: {
              user: { select: { name: true } },
            },
          },
        },
      }),
      prisma.review.count({
        where: { productId: product.id, status: "APPROVED" },
      }),
    ]);

    return jsonOk({
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        verified: review.verified,
        helpfulCount: review.helpfulCount,
        createdAt: review.createdAt.toISOString(),
        author: review.customer.user.name,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("products.reviews.list.failed", { error: String(error) });
    return jsonError("Could not load reviews.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireAuth(request);
    if (!session || session.role !== "CUSTOMER") {
      return jsonError("Customer authentication required.", 401);
    }

    const { slug } = await context.params;
    const body = await parseJson(request, reviewSchema);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) {
      return jsonError("Customer profile not found.", 400);
    }

    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) {
      return jsonError("Product not found.", 404);
    }

    const purchase = await prisma.orderItem.findFirst({
      where: {
        productId: product.id,
        order: {
          customerId: customer.id,
          status: {
            in: [
              "PAYMENT_CONFIRMED",
              "CONFIRMED",
              "PROCESSING",
              "PICKING",
              "PACKED",
              "READY_TO_SHIP",
              "SHIPPED",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ],
          },
        },
      },
      select: { orderId: true },
    });

    if (!purchase) {
      return jsonError("Verified purchase required to review this product.", 403);
    }

    const review = await prisma.review.create({
      data: {
        productId: product.id,
        customerId: customer.id,
        orderId: purchase.orderId,
        rating: body.rating,
        title: body.title,
        body: body.body,
        verified: true,
        status: "PENDING",
      },
    });

    return jsonOk(
      {
        id: review.id,
        status: review.status,
        message: "Review submitted and pending moderation.",
      },
      201,
    );
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("You have already reviewed this product.", 409);
    }
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("products.reviews.create.failed", { error: String(error) });
    return jsonError("Could not submit review.", 500);
  }
}
