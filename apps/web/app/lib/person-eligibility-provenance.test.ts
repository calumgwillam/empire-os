import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline provenance tests cannot connect."); }),
}));

import { Pool } from "pg";
import { resolveClerkSession } from "./clerk-session-resolver";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { memberAuthorityRelease } from "./member-authority-release";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { trustedPersonAuthoritySourceProblem, type PersonEligibilityEvent } from "./trusted-person-authority-source";
import {
  ELIGIBILITY_PROVENANCE_MISSING_DEPENDENCIES, inspectEligibilityProvenanceReadiness,
  validateCandidateEligibilityProvenance,
  type CandidateEligibilityProvenance, type EligibilityProvenanceCheckpoint,
} from "./person-eligibility-provenance";

const FOUNDER = "user_founder123456789";
const NOW = 100_000;
const request = () => new Request("https://empire.invalid/internal", {
  headers: { "x-user-id": FOUNDER, "x-role": "founder" },
});
const denied = { status: "unauthorized", reason: "forbidden" };
function event(): PersonEligibilityEvent {
  return {
    tenantId: "tenant-a", personId: "person-staff", revision: 2, status: "active", kind: "other",
    operationId: "eligibility:staff:2", issuerSubject: FOUNDER, sourceReference: "source:staff:2",
    evidenceSha256: "a".repeat(64), recordedAtMs: NOW - 20,
  };
}
function checkpoint(): EligibilityProvenanceCheckpoint {
  return { tenantId: "tenant-a", personId: "person-staff", personRevision: 2, issuerRevision: 3, nowMs: NOW };
}
function provenance(): CandidateEligibilityProvenance {
  return {
    event: event(), issuer: { subject: FOUNDER, revision: 3, status: "active" }, verifiedAtMs: NOW - 10,
  };
}
async function principal(subject = FOUNDER) {
  const value = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(request());
  if (!isAuthenticatedPrincipal(value)) throw new Error("Missing synthetic authenticated principal.");
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", FOUNDER);
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: FOUNDER });
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(Pool).not.toHaveBeenCalled();
});

describe("dormant eligibility provenance consistency contract", () => {
  it("requires a branded session principal as well as the configured founder", async () => {
    const observed = provenance();
    const original = structuredClone(observed);
    const result = validateCandidateEligibilityProvenance(await principal(), checkpoint(), event(), observed);
    expect(result).toEqual({ status: "valid", event: event() });
    if (result.status === "valid") expect(Object.isFrozen(result.event)).toBe(true);
    expect(observed).toEqual(original);
  });
  it.each([null, { subject: FOUNDER }, { status: "authenticated", subject: FOUNDER }, { founderSubject: FOUNDER }])(
    "does not authenticate a matching founder string: %j", issuer => {
      expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), event(), provenance()))
        .toEqual({ status: "unauthorized", reason: "authentication-required" });
    },
  );
  it("rejects a serialized authenticated principal", async () => {
    const issuer = JSON.parse(JSON.stringify(await principal()));
    expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), event(), provenance()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
  });
  it("does not promote authenticated staff or generic administrator claims", async () => {
    const issuer = await principal("user_staff");
    expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), {
      ...event(), issuerSubject: issuer.subject,
    }, { ...provenance(), issuer: { subject: issuer.subject, revision: 3, status: "active" } })).toEqual(denied);
    expect(validateCandidateEligibilityProvenance({ ...issuer, capabilities: ["recover-founder", "bind"] },
      checkpoint(), event(), provenance())).toEqual({ status: "unauthorized", reason: "authentication-required" });
  });
  it.each([undefined, "", "placeholder", "user_rotated_founder123456"])(
    "fails closed on missing, invalid or rotated founder configuration: %j", async configured => {
      const issuer = await principal();
      vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", configured);
      expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), event(), provenance())).toEqual(denied);
    },
  );
  it.each([
    { status: "revoked" }, { subject: "user_other" }, { revision: 2 }, { revision: 4 },
    { revision: "3" }, { revision: 0 }, { status: "delegated" }, { approved: true },
  ])("rejects revoked, stale or conflicting issuer observations: %j", async change => {
    const observed = provenance();
    expect(validateCandidateEligibilityProvenance(await principal(), checkpoint(), event(), {
      ...observed, issuer: { ...observed.issuer, ...change },
    })).toEqual(denied);
  });
  it.each([
    { tenantId: "tenant-b" }, { personId: "person-other" }, { revision: 1 }, { revision: 3 },
    { operationId: "eligibility:other" }, { issuerSubject: "user_other" },
    { sourceReference: "source:other" }, { evidenceSha256: "b".repeat(64) },
    { recordedAtMs: NOW - 21 }, { status: "inactive" }, { kind: "founder" }, { approved: true },
  ])("rejects any conflict in the exact immutable event: %j", async change => {
    expect(validateCandidateEligibilityProvenance(await principal(), checkpoint(), event(), {
      ...provenance(), event: { ...event(), ...change },
    })).toEqual(denied);
  });
  it.each([
    { tenantId: "tenant-b" }, { personId: "person-other" }, { personRevision: 1 }, { personRevision: 3 },
    { personRevision: 0 }, { issuerRevision: 2 }, { issuerRevision: 0 }, { nowMs: NOW - 30 },
    { nowMs: -1 }, { founderSubject: FOUNDER },
  ])("rejects wrong scope and stale checkpoints: %j", async change => {
    expect(validateCandidateEligibilityProvenance(await principal(), { ...checkpoint(), ...change }, event(), provenance()))
      .toEqual(denied);
  });
  it.each([null, {}, undefined])("requires explicit provenance and checkpoints: %j", async missing => {
    const issuer = await principal();
    expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), event(), missing)).toEqual(denied);
    expect(validateCandidateEligibilityProvenance(issuer, missing, event(), provenance())).toEqual(denied);
  });
  it("rejects inherited, accessor, hidden and symbol event fields rather than dropping audit evidence", async () => {
    const issuer = await principal();
    const getter = vi.fn(() => "source:staff:2");
    const accessor = Object.defineProperty({ ...event() }, "sourceReference", { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ ...event() }, "sourceReference", { enumerable: false });
    const extra = { ...event(), [Symbol("authority")]: "founder" };
    for (const candidate of [Object.create(event()), accessor, hidden, extra]) {
      expect(validateCandidateEligibilityProvenance(issuer, checkpoint(), candidate, {
        ...provenance(), event: candidate,
      })).toEqual(denied);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([NOW + 1, NOW - 21, -1, "99990"])("rejects future or pre-event verification time: %j", async verifiedAtMs => {
    expect(validateCandidateEligibilityProvenance(await principal(), checkpoint(), event(), {
      ...provenance(), verifiedAtMs,
    })).toEqual(denied);
  });
  it("supports exact inactivation-event reconciliation without treating it as member eligibility", async () => {
    const inactive = { ...event(), status: "inactive" as const };
    expect(validateCandidateEligibilityProvenance(await principal(), checkpoint(), inactive, {
      ...provenance(), event: inactive,
    })).toEqual({ status: "valid", event: inactive });
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });
  it("cannot approve fabricated matching evidence even for an authenticated founder", async () => {
    const fabricated = { ...event(), sourceReference: "fabricated", evidenceSha256: "f".repeat(64) };
    expect(validateCandidateEligibilityProvenance(await principal(), checkpoint(), fabricated, {
      ...provenance(), event: fabricated,
    }).status).toBe("valid");
    // Matching strings/hash/revisions are not evidence of real source verification.
    expect(await inspectEligibilityProvenanceReadiness(request())).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
    });
  });
});

describe("real provenance readiness refusal", () => {
  it("returns explicit independent-source dependencies even for the Clerk-authenticated founder", async () => {
    const result = await inspectEligibilityProvenanceReadiness(request());
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    if (result.status === "unavailable") {
      for (const dependency of ELIGIBILITY_PROVENANCE_MISSING_DEPENDENCIES) expect(result.message).toContain(dependency);
    }
    expect(resolveClerkSession).toHaveBeenCalledWith(expect.any(Request));
  });
  it("ignores spoofed founder headers for an unauthenticated request", async () => {
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    expect(await inspectEligibilityProvenanceReadiness(request()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
  });
  it("refuses an authenticated non-founder", async () => {
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: "user_other" });
    expect(await inspectEligibilityProvenanceReadiness(request())).toEqual(denied);
  });
  it("surfaces authentication-service failure without leaking backend details", async () => {
    vi.mocked(resolveClerkSession).mockRejectedValue(new Error("Private authentication backend details"));
    expect(await inspectEligibilityProvenanceReadiness(request())).toEqual({
      status: "unavailable", outcome: "not-submitted", message: "Authentication service is unavailable.",
    });
  });
  it("preserves member, provisioning and business-execution refusal", () => {
    expect(memberAuthorityRelease().status).toBe("disabled");
    expect(employeeProvisioningRelease().status).toBe("disabled");
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(Object.isFrozen(ELIGIBILITY_PROVENANCE_MISSING_DEPENDENCIES)).toBe(true);
  });
});
