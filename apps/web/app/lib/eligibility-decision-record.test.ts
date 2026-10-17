import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline ledger tests must not open PostgreSQL."); }),
}));
import { Pool } from "pg";
import {
  isEligibilityDecisionRecord, validateCandidateEligibilityDecisionRecord,
  verifyStoredEligibilityDecision, storedEligibilityProvenanceProblem,
  type EligibilityDecisionRecord,
} from "./person-eligibility-provenance";
import { memberAuthorityRelease } from "./member-authority-release";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { trustedPersonAuthoritySourceProblem } from "./trusted-person-authority-source";

const denied = { status: "unauthorized", reason: "forbidden" };
function record(): EligibilityDecisionRecord {
  return {
    version: 1, subject: "user_staff", bindingId: "binding-staff", issuerBindingId: "binding-founder",
    issuerPersonId: "person-founder", issuerPersonRevision: 1,
    registryRevision: 4, bindingRevision: 3, policyRevision: 2,
    issuerMembershipRevision: 1, subjectMembershipRevision: 2,
    authenticatedAtMs: 100_000, validUntilMs: 400_000,
    authenticationReference: "authentication:verified-server-record",
    issuerAuthorityReference: "issuer:verified-server-record", decision: "issue",
    event: {
      tenantId: "tenant-a", personId: "person-staff", revision: 1, status: "active", kind: "other",
      operationId: "eligibility:staff:1", issuerSubject: "user_founder123456789",
      sourceReference: "person:source:staff", evidenceSha256: "a".repeat(64), recordedAtMs: 100_010,
    },
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { expect(Pool).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });

describe("candidate durable eligibility decision shape and exact reconciliation", () => {
  it("recognises only a record shape, not authenticated issuance or a commit receipt", () => {
    const expected = record();
    const stored = structuredClone(expected);
    expect(isEligibilityDecisionRecord(stored)).toBe(true);
    expect(validateCandidateEligibilityDecisionRecord(expected, stored)).toEqual({ status: "consistent" });
    expect(stored).toEqual(expected);
    expect(verifyStoredEligibilityDecision(stored)).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
    });
  });
  it.each([
    { version: 2 }, { subject: "user_other" }, { bindingId: "replacement-binding" },
    { issuerBindingId: "replacement-founder" }, { issuerPersonId: "other-founder" },
    { issuerPersonRevision: 2 }, { registryRevision: 5 }, { bindingRevision: 4 },
    { policyRevision: 3 }, { issuerMembershipRevision: 2 }, { subjectMembershipRevision: 3 },
    { authenticatedAtMs: 99_999, validUntilMs: 399_999 },
    { authenticationReference: "authentication:other" }, { issuerAuthorityReference: "issuer:other" },
    { approved: true }, { verified: true },
  ])("rejects altered records and simulated concurrent changes: %j", change => {
    expect(validateCandidateEligibilityDecisionRecord(record(), { ...record(), ...change })).toEqual(denied);
  });
  it.each([
    { tenantId: "tenant-b" }, { personId: "person-other" }, { revision: 2 },
    { issuerSubject: "user_other" }, { operationId: "operation:other" },
    { sourceReference: "source:other" }, { evidenceSha256: "b".repeat(64) },
    { recordedAtMs: 100_011 }, { status: "inactive" }, { kind: "founder" },
  ])("rejects exact-event substitution, including unchanged operation IDs: %j", change => {
    expect(validateCandidateEligibilityDecisionRecord(record(), {
      ...record(), event: { ...record().event, ...change },
    })).toEqual(denied);
  });
  it.each([
    { issuerPersonRevision: 0 }, { registryRevision: 0 }, { bindingRevision: 5 },
    { policyRevision: -1 }, { issuerMembershipRevision: "1" }, { subjectMembershipRevision: 0 },
    { authenticatedAtMs: 100_011 }, { validUntilMs: 100_010 }, { validUntilMs: 400_001 },
    { authenticationReference: "" }, { issuerAuthorityReference: "" },
    { bindingId: "binding-founder" }, { issuerPersonId: "person-staff" },
    { subject: "user_founder123456789" }, { decision: "recover-founder" },
  ])("rejects invalid evidence, self-approval and expiry bounds: %j", change => {
    expect(isEligibilityDecisionRecord({ ...record(), ...change })).toBe(false);
  });
  it("preserves revocation as another immutable event, not an edit of original issuance", () => {
    const issued = record();
    const revoked: EligibilityDecisionRecord = {
      ...issued, decision: "revoke",
      event: { ...issued.event, revision: 2, status: "inactive", operationId: "eligibility:staff:2" },
    };
    expect(isEligibilityDecisionRecord(revoked)).toBe(true);
    expect(validateCandidateEligibilityDecisionRecord(issued, revoked)).toEqual(denied);
    expect(validateCandidateEligibilityDecisionRecord(revoked, structuredClone(revoked))).toEqual({ status: "consistent" });
    expect(verifyStoredEligibilityDecision(revoked)).toMatchObject({ status: "unavailable" });
    expect(issued.event.status).toBe("active");
  });
  it("does not reconcile a replay by matching operation ID when binding or evidence differs", () => {
    const replay = { ...record(), bindingId: "new-binding", authenticationReference: "new-session" };
    expect(replay.event.operationId).toBe(record().event.operationId);
    expect(validateCandidateEligibilityDecisionRecord(record(), replay)).toEqual(denied);
  });
  it("ignores property order but never refreshes recorded timestamps during reconciliation", () => {
    const stored = { ...record(), event: Object.fromEntries(Object.entries(record().event).reverse()) };
    expect(validateCandidateEligibilityDecisionRecord(record(), stored)).toEqual({ status: "consistent" });
    expect(validateCandidateEligibilityDecisionRecord(record(), {
      ...stored, event: { ...stored.event, recordedAtMs: 100_012 },
    })).toEqual(denied);
  });
  it.each([undefined, null, {}, { authenticationReference: "claims-only" }])(
    "fails closed on missing durable evidence: %j", value => {
      expect(verifyStoredEligibilityDecision(value)).toEqual(denied);
      expect(validateCandidateEligibilityDecisionRecord(record(), value)).toEqual(denied);
    },
  );
  it("rejects inherited or accessor evidence and extra signatures without invoking getters", () => {
    const getter = vi.fn(() => "approved");
    const accessor = Object.defineProperty({ ...record() }, "authenticationReference", { enumerable: true, get: getter });
    for (const value of [Object.create(record()), accessor, { ...record(), signature: "caller-signed" },
      { ...record(), [Symbol("verified")]: true }]) {
      expect(verifyStoredEligibilityDecision(value)).toEqual(denied);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("does not accept revoked/expired issuer claims as an independent authority source", () => {
    for (const issuer of [{ status: "revoked" }, { status: "active" }, { authenticated: true }]) {
      expect(verifyStoredEligibilityDecision({ ...record(), issuer })).toEqual(denied);
    }
    // Removing the claim still cannot establish issuer authority.
    expect(verifyStoredEligibilityDecision(record())).toMatchObject({ status: "unavailable" });
  });
  it("never approves forged matching evidence, even with current founder configuration", () => {
    vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", record().event.issuerSubject);
    const forged = {
      ...record(), authenticationReference: "fabricated", issuerAuthorityReference: "fabricated",
      event: { ...record().event, sourceReference: "fabricated", evidenceSha256: "f".repeat(64) },
    };
    expect(validateCandidateEligibilityDecisionRecord(forged, structuredClone(forged))).toEqual({ status: "consistent" });
    expect(verifyStoredEligibilityDecision(forged)).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(storedEligibilityProvenanceProblem(forged.event)).toMatchObject({ status: "unavailable" });
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable" });
    expect(memberAuthorityRelease().status).toBe("disabled");
    expect(employeeProvisioningRelease().status).toBe("disabled");
  });
});
