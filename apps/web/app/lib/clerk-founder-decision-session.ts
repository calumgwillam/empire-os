import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAuthorityIdentifier } from "./authorization-policy";
import { IDENTITY_REAUTHENTICATION_WINDOW_MS } from "./contribution-identity-authority";
import { isAuthorizedFounder } from "./founder-access";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { isCounter, type PersistenceProblem } from "./server-persistence-contract";

export type FounderDecisionSession = Readonly<{
  principal: AuthenticatedPrincipal;
  identityIssuer: string;
  sessionId: string;
  authenticatedAtMs: number;
  checkedAtMs: number;
  validUntilMs: number;
}>;

const sessions = new WeakSet<object>();
const forbidden = (): PersistenceProblem => ({ status: "unauthorized", reason: "forbidden" });
const unavailable = (): PersistenceProblem => ({
  status: "unavailable", outcome: "not-submitted", message: "Founder session verification is unavailable.",
});

// Only Clerk's verified request context and live Backend API are consulted.
// The supplied Request, browser headers and JSON never establish identity or age.
export async function resolveClerkFounderDecisionSession(request: Request): Promise<FounderDecisionSession | PersistenceProblem> {
  try {
    const context = await auth();
    if (!context.userId) return { status: "unauthorized", reason: "authentication-required" };
    if (!isAuthorizedFounder(context.userId, process.env.EMPIRE_OS_FOUNDER_CLERK_USER_ID)
      || context.actor || context.sessionClaims?.act
      || (context.sessionStatus !== null && context.sessionStatus !== "active")
      || !/^sess_[A-Za-z0-9_]+$/.test(context.sessionId) || context.sessionId.length > 512) return forbidden();
    const claims = context.sessionClaims;
    const ages = context.factorVerificationAge;
    if (!isAuthorityIdentifier(claims.iss) || !claims.iss.startsWith("https://")
      || claims.sub !== context.userId || claims.sid !== context.sessionId
      || !isCounter(claims.iat) || !isCounter(claims.exp) || !isCounter(claims.nbf)
      || !Array.isArray(ages) || ages.length !== 2 || !isCounter(ages[0])) return forbidden();

    // fva is rounded to minutes. Use the OLDEST possible verification time,
    // anchored to the signed token's iat, never lastActiveAt or request time.
    const authenticatedAtMs = claims.iat * 1000 - (ages[0] + 1) * 60_000;
    const client = await clerkClient();
    const live = await client.sessions.getSession(context.sessionId);
    const checkedAtMs = Date.now();
    const validUntilMs = Math.min(authenticatedAtMs + IDENTITY_REAUTHENTICATION_WINDOW_MS,
      claims.exp * 1000, live.expireAt, live.abandonAt);
    if (!isAuthorizedFounder(context.userId, process.env.EMPIRE_OS_FOUNDER_CLERK_USER_ID)
      || live.id !== context.sessionId || live.userId !== context.userId || live.status !== "active" || live.actor !== null
      || ![authenticatedAtMs, checkedAtMs, validUntilMs, live.expireAt, live.abandonAt,
        claims.iat * 1000, claims.nbf * 1000].every(isCounter)
      || claims.iat * 1000 > checkedAtMs || claims.nbf * 1000 > checkedAtMs
      || authenticatedAtMs > checkedAtMs || checkedAtMs >= validUntilMs) return forbidden();
    const principal = await createServerPrincipalResolver(async () => ({
      status: "authenticated", subject: context.userId,
    }))(request);
    if (!isAuthenticatedPrincipal(principal)) return principal;
    const session = Object.freeze({
      principal, identityIssuer: claims.iss, sessionId: context.sessionId, authenticatedAtMs, checkedAtMs, validUntilMs,
    });
    sessions.add(session);
    return session;
  } catch {
    return unavailable();
  }
}

export function isFounderDecisionSession(value: unknown): value is FounderDecisionSession {
  return typeof value === "object" && value !== null && sessions.has(value);
}

export async function recheckClerkFounderDecisionSession(
  request: Request, session: FounderDecisionSession,
): Promise<FounderDecisionSession | PersistenceProblem> {
  if (!isFounderDecisionSession(session)) return forbidden();
  const current = await resolveClerkFounderDecisionSession(request);
  if (!isFounderDecisionSession(current)) return current;
  if (current.principal.subject !== session.principal.subject || current.sessionId !== session.sessionId
    || current.identityIssuer !== session.identityIssuer
    || current.checkedAtMs < session.checkedAtMs || current.checkedAtMs >= session.validUntilMs) return forbidden();
  return current;
}
