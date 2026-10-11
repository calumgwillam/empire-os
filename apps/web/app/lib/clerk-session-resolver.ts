import { auth } from "@clerk/nextjs/server";
import type { ServerSessionResolution } from "./server-persistence-authority";

type VerifiedIdentityProvider = () => Promise<{ userId: unknown }>;

export async function resolveVerifiedIdentity(
  provider: VerifiedIdentityProvider,
): Promise<ServerSessionResolution> {
  let userId: unknown;

  try {
    ({ userId } = await provider());
  } catch {
    return { status: "unauthenticated" };
  }

  if (userId === null) {
    return { status: "unauthenticated" };
  }

  if (
    typeof userId !== "string" ||
    !/^user_[a-zA-Z0-9_]+$/.test(userId) ||
    userId.length > 512
  ) {
    throw new Error("Invalid Clerk identity");
  }

  return { status: "authenticated", subject: userId };
}

export async function resolveClerkSession(
  _request: Request,
): Promise<ServerSessionResolution> {
  return resolveVerifiedIdentity(async () => {
    const session = await auth();
    return { userId: session.userId };
  });
}
