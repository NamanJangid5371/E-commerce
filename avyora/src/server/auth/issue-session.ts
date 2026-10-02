import { prisma } from "@/server/db";
import {
  createAccessToken,
  createRefreshToken,
} from "@/server/auth/session";

const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export async function issueSessionTokens(input: {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
}): Promise<{ access: string; refresh: string }> {
  const access = await createAccessToken({
    userId: input.userId,
    email: input.email,
    role: input.role,
    permissions: input.permissions,
  });
  const refresh = await createRefreshToken({ userId: input.userId });

  await prisma.refreshToken.create({
    data: {
      token: refresh,
      userId: input.userId,
      expiresAt: new Date(Date.now() + REFRESH_MS),
    },
  });

  return { access, refresh };
}
