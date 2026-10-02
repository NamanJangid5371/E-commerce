import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthError } from "@/server/auth/rbac";
import { DbUnavailableError } from "@/server/db";

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

export function jsonError(
  message: string,
  status = 400,
  details?: unknown,
): Response {
  return Response.json(
    {
      ok: false,
      error: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export async function parseJson<T>(
  request: Request,
  schema?: z.ZodType<T>,
): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new HttpParseError("Invalid JSON body");
  }

  if (!schema) {
    return body as T;
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpParseError("Validation failed", parsed.error.flatten());
  }

  return parsed.data;
}

export class HttpParseError extends Error {
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "HttpParseError";
    this.details = details;
  }
}

export function handleApiError(error: unknown, label: string): Response {
  if (error instanceof DbUnavailableError) {
    return jsonError(error.message, 503);
  }
  // Duck-type AuthError — Turbopack can break `instanceof` across bundles.
  if (
    error instanceof AuthError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "AuthError" &&
      typeof (error as { status?: unknown }).status === "number")
  ) {
    const auth = error as AuthError;
    return jsonError(auth.message || "Authentication required", auth.status || 401);
  }
  if (error instanceof HttpParseError) {
    return jsonError(error.message, 400, error.details);
  }
  console.error(`[${label}]`, error);
  return jsonError("Internal server error", 500);
}

export function isDbUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1017", "P2024"].includes(error.code);
  }
  return false;
}

export function dbUnavailableError(): Response {
  return jsonError(
    "Database is temporarily unavailable. Please try again later.",
    503,
  );
}
