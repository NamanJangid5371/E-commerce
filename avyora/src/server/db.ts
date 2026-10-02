import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export class DbUnavailableError extends Error {
  status = 503;

  constructor(message = "Database unavailable") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function ensureDb(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new DbUnavailableError();
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new DbUnavailableError();
  }
}
