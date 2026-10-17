import "server-only";
import { createHash } from "node:crypto";
import {
  isFounderDecisionSession, resolveClerkFounderDecisionSession, type FounderDecisionSession,
} from "./clerk-founder-decision-session";
import {
  isFounderEligibilityDecisionRequest, type FounderEligibilityDecisionRequest,
} from "./founder-eligibility-decision-contract";
import { isAuthorizedFounder } from "./founder-access";
import { identityPersistenceRequestText } from "./postgres-contribution-identity-store";
import { isCounter, type PersistenceProblem } from "./server-persistence-contract";

export type AuthenticatedFounderEligibilityIntent = Readonly<{
  session: FounderDecisionSession;
  request: FounderEligibilityDecisionRequest;
  requestSha256: string;
}>;
const intents = new WeakSet<object>();
const consumed = new WeakSet<object>();

// This process-local, single-use intent authenticates a CURRENT command, not a
// historical issuance. Its digest is integrity metadata, never independent proof.
export async function prepareFounderEligibilityIntent(
  request: Request, input: unknown,
): Promise<AuthenticatedFounderEligibilityIntent | PersistenceProblem> {
  const snapshot = isFounderEligibilityDecisionRequest(input) ? Object.freeze({ ...input }) : null;
  const session = await resolveClerkFounderDecisionSession(request);
  if (!isFounderDecisionSession(session)) return session;
  if (!snapshot) return { status: "invalid-request", message: "Invalid founder eligibility decision." };
  if (snapshot.subject === session.principal.subject) return { status: "unauthorized", reason: "forbidden" };
  const requestSha256 = createHash("sha256").update(identityPersistenceRequestText({
    issuerSubject: session.principal.subject, identityIssuer: session.identityIssuer, sessionId: session.sessionId,
    authenticatedAtMs: session.authenticatedAtMs, validUntilMs: session.validUntilMs, request: snapshot,
  })).digest("hex");
  const intent = Object.freeze({ session, request: snapshot, requestSha256 });
  intents.add(intent);
  return intent;
}

export function isAuthenticatedFounderEligibilityIntent(value: unknown): value is AuthenticatedFounderEligibilityIntent {
  return typeof value === "object" && value !== null && intents.has(value);
}

export function consumeFounderEligibilityIntent(value: unknown): AuthenticatedFounderEligibilityIntent | PersistenceProblem {
  if (!isAuthenticatedFounderEligibilityIntent(value) || consumed.has(value)) {
    return { status: "unauthorized", reason: "forbidden" };
  }
  // Burn before the first asynchronous operation, including failed attempts.
  consumed.add(value);
  const nowMs = Date.now();
  if (!isCounter(nowMs) || nowMs < value.session.checkedAtMs || nowMs >= value.session.validUntilMs
    || !isAuthorizedFounder(value.session.principal.subject, process.env.EMPIRE_OS_FOUNDER_CLERK_USER_ID)) {
    return { status: "unauthorized", reason: "forbidden" };
  }
  return value;
}
