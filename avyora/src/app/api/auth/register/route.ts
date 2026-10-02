import { z } from "zod";
import { hashPassword } from "@/server/auth/password";
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

const registerSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .regex(/[A-Za-z]/, "Password must include a letter.")
    .regex(/[0-9]/, "Password must include a number."),
});

async function findDefaultGroupId(): Promise<string | undefined> {
  const group = await prisma.customerGroup.findFirst({
    where: {
      OR: [
        { name: { equals: "Regular", mode: "insensitive" } },
        { discountPercent: 0 },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  return group?.id;
}

async function registerJsonFallback(body: z.infer<typeof registerSchema>) {
  const { CommerceMutationAbort, mutateCommerce } = await import("@/server/commerce-db");
  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const id = `cust-${Date.now()}`;
  try {
    await mutateCommerce((commerce) => {
      if (commerce.ops.adminUsers.some((u) => u.email.toLowerCase() === email)) {
        throw new CommerceMutationAbort(
          "This email is reserved for atelier staff. Use a different email.",
          400,
        );
      }
      if (commerce.customers.some((c) => c.email.toLowerCase() === email)) {
        throw new CommerceMutationAbort(
          "An account already exists for this email. Sign in instead.",
          400,
        );
      }
      return {
        ...commerce,
        customers: [
          ...commerce.customers,
          {
            id,
            name,
            email,
            password,
            createdAt: new Date().toISOString(),
            status: "active" as const,
            groupId: "g-regular",
            addresses: [],
            emailVerified: false,
          },
        ],
      };
    });
  } catch (error) {
    if (error instanceof CommerceMutationAbort) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
  logger.warn("auth.register.json_fallback", { email });
  return jsonOk({ user: { id, name, email }, customer: { id, groupId: "g-regular" } }, 201);
}

export async function POST(request: Request) {
  let body: z.infer<typeof registerSchema>;
  try {
    body = await parseJson(request, registerSchema);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return jsonError("Invalid request body.", 400);
  }

  const email = body.email.toLowerCase();
  const name = body.name.trim();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === "ADMIN") {
        return jsonError(
          "This email is reserved for atelier staff. Use a different email.",
          400,
        );
      }
      return jsonError(
        "An account already exists for this email. Sign in instead.",
        400,
      );
    }

    const passwordHash = await hashPassword(body.password);
    const groupId = await findDefaultGroupId();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: "CUSTOMER",
        },
      });

      const customer = await tx.customer.create({
        data: {
          userId: user.id,
          groupId,
        },
      });

      return { user, customer };
    });

    const { mirrorCustomerToCommerce } = await import("@/server/customers/load-customers");
    await mirrorCustomerToCommerce({
      id: result.customer.id,
      name: result.user.name,
      email: result.user.email,
      groupId: result.customer.groupId,
      createdAt: result.customer.createdAt,
    });

    return jsonOk(
      {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
        },
        customer: {
          id: result.customer.id,
          groupId: result.customer.groupId,
        },
      },
      201,
    );
  } catch (error) {
    if (isDbUnavailable(error) || !process.env.DATABASE_URL) {
      try {
        return await registerJsonFallback(body);
      } catch {
        logger.error("auth.register.db_unavailable", { error: String(error) });
        return dbUnavailableError();
      }
    }
    logger.error("auth.register.failed", { error: String(error) });
    return jsonError("Could not create account.", 500);
  }
}
