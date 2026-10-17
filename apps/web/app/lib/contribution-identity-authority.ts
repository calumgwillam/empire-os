import "server-only";
import {
  createServerPrincipalResolver,
  isAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
  type ServerSessionResolution,
} from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isObject } from "./server-persistence-contract";

export const IDENTITY_REAUTHENTICATION_WINDOW_MS = 5 * 60 * 1000;

export const IDENTITY_ADMIN_CAPABILITIES = [
  "bind",
  "revoke",
  "reassign",
  "delegate",
  "approve-reassignment",
  "recover-founder",
] as const;
export type IdentityAdminCapability = (typeof IDENTITY_ADMIN_CAPABILITIES)[number];

type EventBase = Readonly<{
  sequence: number;
  eventId: string;
  previousEventId: string | null;
  operationId: string;
  tenantId: string;
  actorSubject: string;
  recordedAtMs: number;
}>;

export type ContributionIdentityEvent = EventBase & (
  | Readonly<{
    kind: "subject-bound";
    bindingId: string;
    subject: string;
    personId: string;
    verificationId: string;
    verifiedAtMs: number;
  }>
  | Readonly<{
    kind: "binding-revoked";
    bindingId: string;
    subject: string;
    personId: string;
    justification: string;
    revokedAdministratorGrantIds: readonly string[];
    approvedBySubject: string | null;
    approvedAtMs: number | null;
    approvedAuthenticatedAtMs: number | null;
  }>
  | Readonly<{
    kind: "binding-reassigned";
    previousBindingId: string;
    previousSubject: string;
    previousPersonId: string;
    bindingId: string;
    subject: string;
    personId: string;
    verificationId: string;
    verifiedAtMs: number;
    justification: string;
    revokedAdministratorGrantIds: readonly string[];
    approvedBySubject: string;
    approvedAtMs: number;
    approvedAuthenticatedAtMs: number;
  }>
  | Readonly<{
    kind: "administrator-granted";
    grantId: string;
    subject: string;
    capabilities: readonly IdentityAdminCapability[];
    source: "bootstrap" | "delegated";
  }>
  | Readonly<{
    kind: "administrator-revoked";
    grantId: string;
    subject: string;
    justification: string;
  }>
);

export type ContributionIdentityRegistry = Readonly<{
  version: 1;
  revision: number;
  bindingRevision: number;
  policyRevision: number;
  events: readonly ContributionIdentityEvent[];
}>;

export type IdentityMembership = Readonly<{
  tenantId: string;
  subject: string;
  revision: number;
  status: "active" | "revoked";
}>;

export type IdentityPerson = Readonly<{
  tenantId: string;
  personId: string;
  status: "active" | "inactive";
  kind: "founder" | "system-owner" | "other";
}>;

export type IdentityAuthorityObservation = Readonly<{
  tenantId: string;
  tenantStatus: "active" | "revoked";
  policyRevision: number;
  tenantPolicyRevisions: readonly Readonly<{ tenantId: string; revision: number }>[];
  checkedAtMs: number;
  validUntilMs: number;
  allMembershipsObserved: boolean;
  memberships: readonly IdentityMembership[];
  people: readonly IdentityPerson[];
  recentAuthentications: readonly Readonly<{ subject: string; authenticatedAtMs: number }>[];
}>;

export type IdentityClaimRequest = Readonly<{
  tenantId: string;
  subject: string;
  personId: string;
}>;

const verifiedIdentityClaimBrand: unique symbol = Symbol("verified-identity-claim");

export type VerifiedIdentityClaim = Readonly<{
  tenantId: string;
  subject: string;
  personId: string;
  verificationId: string;
  verifiedAtMs: number;
  readonly [verifiedIdentityClaimBrand]: true;
}>;

const verifiedClaims = new WeakSet<object>();

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function authenticationTime(observation: IdentityAuthorityObservation, subject: string): number | null {
  return observation.recentAuthentications.find((entry) => entry.subject === subject)?.authenticatedAtMs ?? null;
}

function isClerkSubject(value: unknown): value is string {
  return typeof value === "string" && /^user_[A-Za-z0-9_]+$/.test(value) && value.length <= 512;
}

function isCapability(value: unknown): value is IdentityAdminCapability {
  return IDENTITY_ADMIN_CAPABILITIES.some((capability) => capability === value);
}

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value) || !hasOnlyFields(value, fields) || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function denseList<T>(value: unknown, isEntry: (entry: unknown) => entry is T): value is T[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !isEntry(descriptor.value)) return false;
  }
  return true;
}

function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeValue);
    Object.freeze(value);
  }
  return value;
}

function isIdentityEvent(value: unknown): value is ContributionIdentityEvent {
  if (!isObject(value)) return false;
  const base = ["sequence", "eventId", "previousEventId", "operationId", "tenantId", "actorSubject", "recordedAtMs"];
  if (!isCounter(value.sequence) || value.sequence === 0 || !isIdentifier(value.eventId)
    || !(value.previousEventId === null || isIdentifier(value.previousEventId))
    || !isIdentifier(value.operationId) || !isIdentifier(value.tenantId)
    || !(value.actorSubject === "system:bootstrap" || isClerkSubject(value.actorSubject))
    || !isCounter(value.recordedAtMs) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "subject-bound":
      return exactObject(value, [...base, "kind", "bindingId", "subject", "personId", "verificationId", "verifiedAtMs"])
        && isIdentifier(value.bindingId) && isClerkSubject(value.subject) && isIdentifier(value.personId)
        && isIdentifier(value.verificationId) && isCounter(value.verifiedAtMs) && value.verifiedAtMs <= value.recordedAtMs
        && value.actorSubject !== "system:bootstrap";
    case "binding-revoked":
      return exactObject(value, [...base, "kind", "bindingId", "subject", "personId", "justification",
        "revokedAdministratorGrantIds", "approvedBySubject", "approvedAtMs", "approvedAuthenticatedAtMs"])
        && isIdentifier(value.bindingId) && isClerkSubject(value.subject) && isIdentifier(value.personId)
        && isIdentifier(value.justification) && value.actorSubject !== "system:bootstrap"
        && denseList(value.revokedAdministratorGrantIds, isIdentifier)
        && new Set(value.revokedAdministratorGrantIds).size === value.revokedAdministratorGrantIds.length
        && ((value.approvedBySubject === null && value.approvedAtMs === null && value.approvedAuthenticatedAtMs === null)
          || (isClerkSubject(value.approvedBySubject) && value.approvedBySubject !== value.actorSubject
            && isCounter(value.approvedAtMs) && isCounter(value.approvedAuthenticatedAtMs)
            && value.approvedAuthenticatedAtMs <= value.approvedAtMs && value.approvedAtMs <= value.recordedAtMs));
    case "binding-reassigned":
      return exactObject(value, [...base, "kind", "previousBindingId", "previousSubject", "previousPersonId",
        "bindingId", "subject", "personId", "verificationId", "verifiedAtMs", "justification",
        "revokedAdministratorGrantIds", "approvedBySubject", "approvedAtMs", "approvedAuthenticatedAtMs"])
        && isIdentifier(value.previousBindingId) && isClerkSubject(value.previousSubject)
        && isIdentifier(value.previousPersonId) && isIdentifier(value.bindingId)
        && isClerkSubject(value.subject) && isIdentifier(value.personId) && isIdentifier(value.verificationId)
        && isCounter(value.verifiedAtMs) && value.verifiedAtMs <= value.recordedAtMs
        && isIdentifier(value.justification) && isClerkSubject(value.approvedBySubject)
        && denseList(value.revokedAdministratorGrantIds, isIdentifier)
        && new Set(value.revokedAdministratorGrantIds).size === value.revokedAdministratorGrantIds.length
        && value.approvedBySubject !== value.actorSubject && isCounter(value.approvedAtMs)
        && isCounter(value.approvedAuthenticatedAtMs) && value.approvedAuthenticatedAtMs <= value.approvedAtMs
        && value.approvedAtMs <= value.recordedAtMs && value.actorSubject !== "system:bootstrap";
    case "administrator-granted":
      return exactObject(value, [...base, "kind", "grantId", "subject", "capabilities", "source"])
        && isIdentifier(value.grantId) && isClerkSubject(value.subject) && Array.isArray(value.capabilities)
        && value.capabilities.length > 0 && denseList(value.capabilities, isCapability)
        && new Set(value.capabilities).size === value.capabilities.length
        && (value.source === "bootstrap"
          ? value.actorSubject === "system:bootstrap"
          : value.source === "delegated" && value.actorSubject !== "system:bootstrap");
    case "administrator-revoked":
      return exactObject(value, [...base, "kind", "grantId", "subject", "justification"])
        && isIdentifier(value.grantId) && isClerkSubject(value.subject) && isIdentifier(value.justification)
        && value.actorSubject !== "system:bootstrap";
    default:
      return false;
  }
}

type ActiveBinding = Readonly<{
  bindingId: string;
  subject: string;
  personId: string;
  bindingRevision: number;
}>;
type ActiveAdministrator = Readonly<{
  grantId: string;
  tenantId: string;
  subject: string;
  capabilities: readonly IdentityAdminCapability[];
  source: "bootstrap" | "delegated";
}>;

function projectRegistry(registry: ContributionIdentityRegistry): {
  bindings: Map<string, ActiveBinding>;
  administrators: Map<string, ActiveAdministrator>;
} | null {
  const bindings = new Map<string, ActiveBinding>();
  const bindingsByPerson = new Map<string, string>();
  const administrators = new Map<string, ActiveAdministrator>();
  const allGrantIds = new Set<string>();
  const allBindingIds = new Set<string>();
  let bindingRevision = 0;
  let policyRevision = 0;
  for (const event of registry.events) {
    switch (event.kind) {
      case "subject-bound": {
        if (bindings.has(event.subject) || bindingsByPerson.has(event.personId)
          || allBindingIds.has(event.bindingId)) return null;
        allBindingIds.add(event.bindingId);
        bindingRevision += 1;
        bindings.set(event.subject, { bindingId: event.bindingId, subject: event.subject, personId: event.personId, bindingRevision });
        bindingsByPerson.set(event.personId, event.subject);
        break;
      }
      case "binding-revoked": {
        const previous = bindings.get(event.subject);
        const activeGrantIds = [...administrators.values()].filter((grant) => grant.subject === event.subject)
          .map((grant) => grant.grantId).sort();
        if (!previous || previous.bindingId !== event.bindingId || previous.personId !== event.personId) return null;
        if (JSON.stringify(event.revokedAdministratorGrantIds) !== JSON.stringify(activeGrantIds)) return null;
        bindingRevision += 1;
        bindings.delete(event.subject);
        bindingsByPerson.delete(event.personId);
        for (const grantId of event.revokedAdministratorGrantIds) {
          if (administrators.get(grantId)?.subject !== event.subject) return null;
          administrators.delete(grantId);
          policyRevision += 1;
        }
        break;
      }
      case "binding-reassigned": {
        const previous = bindings.get(event.previousSubject);
        const activeGrantIds = [...administrators.values()].filter((grant) => grant.subject === event.previousSubject)
          .map((grant) => grant.grantId).sort();
        if (!previous || previous.bindingId !== event.previousBindingId || previous.personId !== event.previousPersonId
          || bindings.has(event.subject) || allBindingIds.has(event.bindingId)
          || (bindingsByPerson.has(event.personId) && event.personId !== event.previousPersonId)) return null;
        if (JSON.stringify(event.revokedAdministratorGrantIds) !== JSON.stringify(activeGrantIds)) return null;
        allBindingIds.add(event.bindingId);
        bindingRevision += 1;
        bindings.delete(event.previousSubject);
        bindingsByPerson.delete(event.previousPersonId);
        bindings.set(event.subject, { bindingId: event.bindingId, subject: event.subject, personId: event.personId, bindingRevision });
        bindingsByPerson.set(event.personId, event.subject);
        for (const grantId of event.revokedAdministratorGrantIds) {
          if (administrators.get(grantId)?.subject !== event.previousSubject) return null;
          administrators.delete(grantId);
          policyRevision += 1;
        }
        break;
      }
      case "administrator-granted": {
        if (event.source === "delegated" && !bindings.has(event.subject)) return null;
        if (allGrantIds.has(event.grantId)
          || [...administrators.values()].some((grant) => grant.tenantId === event.tenantId && grant.subject === event.subject)) return null;
        allGrantIds.add(event.grantId);
        policyRevision += 1;
        administrators.set(event.grantId, {
          grantId: event.grantId, tenantId: event.tenantId, subject: event.subject,
          capabilities: event.capabilities, source: event.source,
        });
        break;
      }
      case "administrator-revoked": {
        const grant = administrators.get(event.grantId);
        if (!grant || grant.subject !== event.subject || grant.source === "bootstrap") return null;
        policyRevision += 1;
        administrators.delete(event.grantId);
        break;
      }
    }
  }
  if (bindingRevision !== registry.bindingRevision || policyRevision !== registry.policyRevision) return null;
  return { bindings, administrators };
}

export function isContributionIdentityRegistry(value: unknown): value is ContributionIdentityRegistry {
  if (!exactObject(value, ["version", "revision", "bindingRevision", "policyRevision", "events"])
    || value.version !== 1 || !isCounter(value.revision) || !isCounter(value.bindingRevision)
    || !isCounter(value.policyRevision) || !denseList(value.events, isIdentityEvent)
    || value.revision !== value.events.length) return false;
  const registry: ContributionIdentityRegistry = {
    version: value.version,
    revision: value.revision,
    bindingRevision: value.bindingRevision,
    policyRevision: value.policyRevision,
    events: value.events,
  };
  const eventIds = new Set<string>();
  const operationIds = new Set<string>();
  let bootstrapPrefix = true;
  for (let index = 0; index < registry.events.length; index += 1) {
    const event = registry.events[index];
    if (event.sequence !== index + 1 || event.previousEventId !== (index === 0 ? null : registry.events[index - 1].eventId)
      || eventIds.has(event.eventId) || operationIds.has(event.operationId)) return false;
    if (event.kind === "administrator-granted" && event.source === "bootstrap"
      && !bootstrapPrefix) return false;
    if (event.kind !== "administrator-granted" || event.source !== "bootstrap") bootstrapPrefix = false;
    eventIds.add(event.eventId);
    operationIds.add(event.operationId);
  }
  return projectRegistry(registry) !== null;
}

export function resolveContributionIdentityBinding(value: unknown, subject: string): ActiveBinding | null {
  if (!isClerkSubject(subject) || !isContributionIdentityRegistry(value)) return null;
  const binding = projectRegistry(value)?.bindings.get(subject);
  return binding ? Object.freeze({ ...binding }) : null;
}

function isMembership(value: unknown): value is IdentityMembership {
  return exactObject(value, ["tenantId", "subject", "revision", "status"])
    && isIdentifier(value.tenantId) && isClerkSubject(value.subject) && isCounter(value.revision)
    && (value.status === "active" || value.status === "revoked");
}

export function isIdentityPerson(value: unknown): value is IdentityPerson {
  return exactObject(value, ["tenantId", "personId", "status", "kind"])
    && isIdentifier(value.tenantId) && isIdentifier(value.personId)
    && (value.status === "active" || value.status === "inactive")
    && (value.kind === "founder" || value.kind === "system-owner" || value.kind === "other");
}

function isAuthorityObservation(value: unknown): value is IdentityAuthorityObservation {
  if (!exactObject(value, ["tenantId", "tenantStatus", "policyRevision", "tenantPolicyRevisions", "checkedAtMs", "validUntilMs",
    "allMembershipsObserved", "memberships", "people", "recentAuthentications"])
    || !isIdentifier(value.tenantId) || (value.tenantStatus !== "active" && value.tenantStatus !== "revoked")
    || !isCounter(value.policyRevision) || !isCounter(value.checkedAtMs) || !isCounter(value.validUntilMs)
    || typeof value.allMembershipsObserved !== "boolean"
    || !denseList(value.memberships, isMembership)) return false;
  const memberships = value.memberships;
  if (!denseList(value.people, isIdentityPerson)) return false;
  const people = value.people;
  const tenantPolicyRevisions = value.tenantPolicyRevisions;
  if (!denseList(tenantPolicyRevisions, (entry): entry is IdentityAuthorityObservation["tenantPolicyRevisions"][number] =>
    exactObject(entry, ["tenantId", "revision"]) && isIdentifier(entry.tenantId) && isCounter(entry.revision))) return false;
  const recentAuthentications = value.recentAuthentications;
  if (!denseList(recentAuthentications, (entry): entry is IdentityAuthorityObservation["recentAuthentications"][number] =>
    exactObject(entry, ["subject", "authenticatedAtMs"]) && isClerkSubject(entry.subject) && isCounter(entry.authenticatedAtMs))) return false;
  return new Set(memberships.map((entry) => `${entry.tenantId}\u0000${entry.subject}`)).size === memberships.length
    && new Set(people.map((entry) => `${entry.tenantId}\u0000${entry.personId}`)).size === people.length
    && new Set(tenantPolicyRevisions.map((entry) => entry.tenantId)).size === tenantPolicyRevisions.length
    && new Set(recentAuthentications.map((entry) => entry.subject)).size === recentAuthentications.length
    && tenantPolicyRevisions.some((entry) => entry.tenantId === value.tenantId && entry.revision === value.policyRevision);
}

export function createVerifiedIdentityClaimResolver(
  verifyIndependently: (
    principal: AuthenticatedPrincipal,
    request: IdentityClaimRequest,
  ) => Promise<unknown>,
) {
  return async function verifyIdentityClaim(
    principal: AuthenticatedPrincipal,
    request: unknown,
    nowMs: number,
  ): Promise<VerifiedIdentityClaim> {
    if (!isAuthenticatedPrincipal(principal) || !isCounter(nowMs)
      || !exactObject(request, ["tenantId", "subject", "personId"])
      || !isIdentifier(request.tenantId) || !isClerkSubject(request.subject) || !isIdentifier(request.personId)) {
      throw new Error("Invalid identity verification request.");
    }
    const claimRequest = {
      tenantId: request.tenantId, subject: request.subject, personId: request.personId,
    };
    const result = await verifyIndependently(principal, claimRequest);
    if (!exactObject(result, ["tenantId", "subject", "personId", "verificationId", "verifiedAtMs"])
      || result.tenantId !== request.tenantId || result.subject !== request.subject || result.personId !== request.personId
      || !isIdentifier(result.verificationId) || !isCounter(result.verifiedAtMs)
      || result.verifiedAtMs > nowMs || nowMs - result.verifiedAtMs > IDENTITY_REAUTHENTICATION_WINDOW_MS) {
      throw new Error("Independent verification did not establish the requested identity.");
    }
    const claim = Object.freeze({
      tenantId: result.tenantId,
      subject: result.subject,
      personId: result.personId,
      verificationId: result.verificationId,
      verifiedAtMs: result.verifiedAtMs,
      [verifiedIdentityClaimBrand]: true as const,
    });
    verifiedClaims.add(claim);
    return claim;
  };
}

type RequestBase = Readonly<{
  operationId: string;
  eventId: string;
  tenantId: string;
  expectedRegistryRevision: number;
  expectedBindingRevision: number;
  expectedIdentityPolicyRevision: number;
  expectedTenantPolicyRevision: number;
}>;
type IdentityEventDetails =
  | Omit<Extract<ContributionIdentityEvent, { kind: "subject-bound" }>, keyof EventBase>
  | Omit<Extract<ContributionIdentityEvent, { kind: "binding-revoked" }>, keyof EventBase>
  | Omit<Extract<ContributionIdentityEvent, { kind: "binding-reassigned" }>, keyof EventBase>
  | Omit<Extract<ContributionIdentityEvent, { kind: "administrator-granted" }>, keyof EventBase>
  | Omit<Extract<ContributionIdentityEvent, { kind: "administrator-revoked" }>, keyof EventBase>;

export type ContributionIdentityRequest = RequestBase & (
  | Readonly<{ kind: "bind"; subject: string; personId: string }>
  | Readonly<{ kind: "revoke"; subject: string; justification: string }>
  | Readonly<{
    kind: "reassign";
    previousSubject: string;
    previousPersonId: string;
    subject: string;
    personId: string;
    justification: string;
  }>
  | Readonly<{ kind: "grant-administrator"; grantId: string; subject: string; capabilities: readonly IdentityAdminCapability[] }>
  | Readonly<{ kind: "revoke-administrator"; grantId: string; justification: string }>
);

function validJustification(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2000
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function decodeRequest(value: unknown): ContributionIdentityRequest | null {
  if (!isObject(value) || !isIdentifier(value.operationId) || !isIdentifier(value.eventId)
    || !isIdentifier(value.tenantId) || !isCounter(value.expectedRegistryRevision)
    || !isCounter(value.expectedBindingRevision) || !isCounter(value.expectedIdentityPolicyRevision)
    || !isCounter(value.expectedTenantPolicyRevision)
    || typeof value.kind !== "string") return null;
  const base = ["kind", "operationId", "eventId", "tenantId", "expectedRegistryRevision",
    "expectedBindingRevision", "expectedIdentityPolicyRevision", "expectedTenantPolicyRevision"];
  switch (value.kind) {
    case "bind":
      return exactObject(value, [...base, "subject", "personId"]) && isClerkSubject(value.subject) && isIdentifier(value.personId)
        ? {
          kind: "bind", operationId: value.operationId, eventId: value.eventId, tenantId: value.tenantId,
          expectedRegistryRevision: value.expectedRegistryRevision, expectedBindingRevision: value.expectedBindingRevision,
          expectedIdentityPolicyRevision: value.expectedIdentityPolicyRevision,
          expectedTenantPolicyRevision: value.expectedTenantPolicyRevision, subject: value.subject, personId: value.personId,
        } : null;
    case "revoke":
      return exactObject(value, [...base, "subject", "justification"]) && isClerkSubject(value.subject)
        && validJustification(value.justification) ? {
          kind: "revoke", operationId: value.operationId, eventId: value.eventId, tenantId: value.tenantId,
          expectedRegistryRevision: value.expectedRegistryRevision, expectedBindingRevision: value.expectedBindingRevision,
          expectedIdentityPolicyRevision: value.expectedIdentityPolicyRevision,
          expectedTenantPolicyRevision: value.expectedTenantPolicyRevision, subject: value.subject, justification: value.justification,
        } : null;
    case "reassign":
      return exactObject(value, [...base, "previousSubject", "previousPersonId", "subject", "personId", "justification"])
        && isClerkSubject(value.previousSubject) && isIdentifier(value.previousPersonId)
        && isClerkSubject(value.subject) && isIdentifier(value.personId)
        && validJustification(value.justification) ? {
          kind: "reassign", operationId: value.operationId, eventId: value.eventId, tenantId: value.tenantId,
          expectedRegistryRevision: value.expectedRegistryRevision, expectedBindingRevision: value.expectedBindingRevision,
          expectedIdentityPolicyRevision: value.expectedIdentityPolicyRevision,
          expectedTenantPolicyRevision: value.expectedTenantPolicyRevision, previousSubject: value.previousSubject,
          previousPersonId: value.previousPersonId, subject: value.subject, personId: value.personId,
          justification: value.justification,
        } : null;
    case "grant-administrator":
      return exactObject(value, [...base, "grantId", "subject", "capabilities"]) && isIdentifier(value.grantId)
        && isClerkSubject(value.subject) && Array.isArray(value.capabilities) && value.capabilities.length > 0
        && denseList(value.capabilities, isCapability) && new Set(value.capabilities).size === value.capabilities.length
        ? {
          kind: "grant-administrator", operationId: value.operationId, eventId: value.eventId, tenantId: value.tenantId,
          expectedRegistryRevision: value.expectedRegistryRevision, expectedBindingRevision: value.expectedBindingRevision,
          expectedIdentityPolicyRevision: value.expectedIdentityPolicyRevision,
          expectedTenantPolicyRevision: value.expectedTenantPolicyRevision, grantId: value.grantId, subject: value.subject,
          capabilities: [...value.capabilities],
        } : null;
    case "revoke-administrator":
      return exactObject(value, [...base, "grantId", "justification"]) && isIdentifier(value.grantId)
        && validJustification(value.justification) ? {
          kind: "revoke-administrator", operationId: value.operationId, eventId: value.eventId, tenantId: value.tenantId,
          expectedRegistryRevision: value.expectedRegistryRevision, expectedBindingRevision: value.expectedBindingRevision,
          expectedIdentityPolicyRevision: value.expectedIdentityPolicyRevision,
          expectedTenantPolicyRevision: value.expectedTenantPolicyRevision, grantId: value.grantId, justification: value.justification,
        } : null;
    default:
      return null;
  }
}

export type IdentityMembershipRevocation = Readonly<{ tenantId: string; subject: string; expectedMembershipRevision: number }>;
export type ContributionIdentityPlan = Readonly<{
  operationId: string;
  scopeTenantId: string;
  actorSubject: string;
  policyRevision: number;
  identityPolicyRevision: number;
  tenantPolicyRevisions: readonly Readonly<{ tenantId: string; revision: number }>[];
  registryRevision: number;
  bindingRevision: number;
  membershipRevocations: readonly IdentityMembershipRevocation[];
  requiredTenantLocks: readonly string[];
  requiresGlobalIdentityLock: true;
  lockOrder: "global-identity-registry-then-sorted-tenant-locks";
  event: ContributionIdentityEvent;
  historicalContributionAttribution: "unchanged";
  transfersExistingRoleGrants: false;
  requiresSessionRevocation: boolean;
  requiresLockedRevalidation: true;
  durable: false;
  effect: "identity-preview-only";
}>;

export type IdentityDecision =
  | Readonly<{ status: "preview"; plan: ContributionIdentityPlan }>
  | Readonly<{ status: "denied"; reason: string }>;

function membershipFor(observation: IdentityAuthorityObservation, subject: string, tenantId: string) {
  return observation.memberships.find((membership) => membership.subject === subject && membership.tenantId === tenantId);
}

function personFor(observation: IdentityAuthorityObservation, personId: string, tenantId: string) {
  return observation.people.find((person) => person.personId === personId && person.tenantId === tenantId);
}

function membershipScopes(observation: IdentityAuthorityObservation, subjects: readonly string[]): string[] {
  return [...new Set(observation.memberships
    .filter((membership) => membership.status === "active" && subjects.includes(membership.subject))
    .map((membership) => membership.tenantId))].sort();
}

function activeGrant(registry: ContributionIdentityRegistry, tenantId: string, subject: string): ActiveAdministrator | undefined {
  const projection = projectRegistry(registry);
  return projection ? [...projection.administrators.values()]
    .find((grant) => grant.tenantId === tenantId && grant.subject === subject) : undefined;
}

function freshAuthentication(observation: IdentityAuthorityObservation, subject: string, nowMs: number): boolean {
  const authenticatedAtMs = observation.recentAuthentications.find((entry) => entry.subject === subject)?.authenticatedAtMs;
  return authenticatedAtMs !== undefined && authenticatedAtMs <= nowMs
    && nowMs - authenticatedAtMs <= IDENTITY_REAUTHENTICATION_WINDOW_MS;
}

function makeEvent(
  registry: ContributionIdentityRegistry,
  request: ContributionIdentityRequest,
  actorSubject: string,
  nowMs: number,
  details: IdentityEventDetails,
): ContributionIdentityEvent {
  return {
    sequence: registry.revision + 1,
    eventId: request.eventId,
    previousEventId: registry.events.at(-1)?.eventId ?? null,
    operationId: request.operationId,
    tenantId: request.tenantId,
    actorSubject,
    recordedAtMs: nowMs,
    ...details,
  } as ContributionIdentityEvent;
}

function denied(reason: string): IdentityDecision {
  return Object.freeze({ status: "denied", reason });
}

function evaluateContributionIdentityOperation(
  principal: AuthenticatedPrincipal,
  approvalPrincipal: AuthenticatedPrincipal | null,
  registryValue: unknown,
  observationValue: unknown,
  requestValue: unknown,
  claimValue: VerifiedIdentityClaim | null,
  nowMs: number,
): IdentityDecision {
  if (!isAuthenticatedPrincipal(principal)) return denied("authentication-required");
  if (!isContributionIdentityRegistry(registryValue) || !isAuthorityObservation(observationValue) || !isCounter(nowMs)) {
    return denied("invalid-authority");
  }
  const registry = registryValue;
  const observation = observationValue;
  const request = decodeRequest(requestValue);
  if (!request) return denied("invalid-request");
  if (request.tenantId !== observation.tenantId || observation.tenantStatus !== "active"
    || observation.checkedAtMs !== nowMs || observation.validUntilMs <= nowMs || !observation.allMembershipsObserved) {
    return denied("stale-or-incomplete-authority");
  }
  if (request.expectedRegistryRevision !== registry.revision
    || request.expectedBindingRevision !== registry.bindingRevision
    || request.expectedIdentityPolicyRevision !== registry.policyRevision
    || request.expectedTenantPolicyRevision !== observation.policyRevision) return denied("stale-authority");
  if (registry.events.some((event) => event.operationId === request.operationId || event.eventId === request.eventId)) {
    return denied("identity-operation-reused");
  }
  if (!freshAuthentication(observation, principal.subject, nowMs)) return denied("fresh-authentication-required");
  const actorMembership = membershipFor(observation, principal.subject, request.tenantId);
  if (!actorMembership || actorMembership.status !== "active") return denied("active-admin-membership-required");

  const active = projectRegistry(registry);
  if (!active) return denied("invalid-identity-history");
  const scopedAdmin = (capability: IdentityAdminCapability, tenantIds: readonly string[], subject = principal.subject): boolean =>
    tenantIds.length > 0 && tenantIds.every((tenantId) => {
      const grant = activeGrant(registry, tenantId, subject);
      const binding = active.bindings.get(subject);
      const person = binding ? personFor(observation, binding.personId, tenantId) : undefined;
      return observation.tenantPolicyRevisions.some((entry) => entry.tenantId === tenantId)
        && membershipFor(observation, subject, tenantId)?.status === "active"
        && grant?.capabilities.includes(capability) === true
        && person?.status === "active"
        && (grant.source !== "bootstrap" || person.kind === "founder" || person.kind === "system-owner");
    });
  const requireClaim = (subject: string, personId: string): VerifiedIdentityClaim | null => {
    if (!claimValue || !verifiedClaims.has(claimValue) || claimValue.tenantId !== request.tenantId
      || claimValue.subject !== subject || claimValue.personId !== personId
      || claimValue.verifiedAtMs > nowMs || nowMs - claimValue.verifiedAtMs > IDENTITY_REAUTHENTICATION_WINDOW_MS) return null;
    return claimValue;
  };
  const requiredLocks = new Set<string>([request.tenantId]);
  const membershipRevocations: IdentityMembershipRevocation[] = [];
  let eventDetails: IdentityEventDetails;
  let requiresSessionRevocation = false;

  if (request.kind === "bind") {
    const claim = requireClaim(request.subject, request.personId);
    if (!claim) return denied("independently-verified-target-required");
    if (!personFor(observation, request.personId, request.tenantId)
      || personFor(observation, request.personId, request.tenantId)?.status !== "active") return denied("person-not-active-in-organisation");
    if (membershipFor(observation, request.subject, request.tenantId)?.status !== "active") return denied("target-membership-required");
    if (active.bindings.has(request.subject) || [...active.bindings.values()].some((binding) => binding.personId === request.personId)) {
      return denied("active-identity-binding-conflict");
    }
    const scopes = membershipScopes(observation, [request.subject]);
    scopes.forEach((scope) => requiredLocks.add(scope));
    if (!scopedAdmin("bind", [...requiredLocks])) return denied("identity-admin-permission-required");
    eventDetails = {
      kind: "subject-bound", bindingId: request.eventId, subject: request.subject, personId: request.personId,
      verificationId: claim.verificationId, verifiedAtMs: claim.verifiedAtMs,
    };
  } else if (request.kind === "revoke") {
    if (request.subject === principal.subject) return denied("self-revocation");
    const binding = active.bindings.get(request.subject);
    if (!binding) return denied("active-identity-binding-required");
    const scopes = membershipScopes(observation, [request.subject]);
    scopes.forEach((scope) => requiredLocks.add(scope));
    if (!scopedAdmin("revoke", [...requiredLocks])) return denied("identity-admin-permission-required");
    const boundPerson = personFor(observation, binding.personId, request.tenantId);
    if (!boundPerson) return denied("bound-person-unresolved");
    const administratorIdentity = [...active.administrators.values()].some((grant) => grant.subject === request.subject);
    const highRisk = boundPerson.kind === "founder" || boundPerson.kind === "system-owner" || administratorIdentity;
    let approvedBySubject: string | null = null;
    let approvedAtMs: number | null = null;
    let approvedAuthenticatedAtMs: number | null = null;
    if (highRisk) {
      if (!approvalPrincipal || !isAuthenticatedPrincipal(approvalPrincipal) || approvalPrincipal.subject === principal.subject
        || approvalPrincipal.subject === request.subject || !freshAuthentication(observation, approvalPrincipal.subject, nowMs)
        || !scopedAdmin("approve-reassignment", [...requiredLocks], approvalPrincipal.subject)
        || !active.bindings.has(approvalPrincipal.subject)
        || (boundPerson.kind === "founder" || boundPerson.kind === "system-owner" || administratorIdentity)
          && !scopedAdmin("recover-founder", [...requiredLocks])) {
        return denied("independent-fresh-approval-required");
      }
      approvedBySubject = approvalPrincipal.subject;
      approvedAtMs = nowMs;
      approvedAuthenticatedAtMs = authenticationTime(observation, approvalPrincipal.subject);
    }
    scopes.forEach((tenantId) => {
      const membership = membershipFor(observation, request.subject, tenantId);
      if (membership?.status === "active") membershipRevocations.push({
        tenantId, subject: request.subject, expectedMembershipRevision: membership.revision,
      });
    });
    requiresSessionRevocation = true;
    eventDetails = {
      kind: "binding-revoked", bindingId: binding.bindingId, subject: binding.subject,
      personId: binding.personId, justification: request.justification,
      revokedAdministratorGrantIds: [...active.administrators.values()]
        .filter((grant) => grant.subject === request.subject).map((grant) => grant.grantId).sort(),
      approvedBySubject, approvedAtMs, approvedAuthenticatedAtMs,
    };
  } else if (request.kind === "reassign") {
    const previous = active.bindings.get(request.previousSubject);
    const claim = requireClaim(request.subject, request.personId);
    if (!previous || previous.personId !== request.previousPersonId) return denied("stale-source-binding");
    if (!claim) return denied("independently-verified-target-required");
    if (request.previousSubject === request.subject || request.previousSubject === principal.subject
      || request.subject === principal.subject) return denied("self-reassignment");
    if (!personFor(observation, request.personId, request.tenantId)
      || personFor(observation, request.personId, request.tenantId)?.status !== "active") return denied("person-not-active-in-organisation");
    if (membershipFor(observation, request.subject, request.tenantId)?.status !== "active") return denied("target-membership-required");
    if (active.bindings.has(request.subject)
      || ([...active.bindings.values()].some((binding) => binding.personId === request.personId)
        && request.personId !== previous.personId)) return denied("active-identity-binding-conflict");
    const scopes = membershipScopes(observation, [request.previousSubject, request.subject]);
    scopes.forEach((scope) => requiredLocks.add(scope));
    if (!scopedAdmin("reassign", [...requiredLocks])) return denied("identity-admin-permission-required");
    const previousPerson = personFor(observation, request.previousPersonId, request.tenantId);
    if (!previousPerson) return denied("source-person-unresolved");
    const administratorIdentity = [...active.administrators.values()].some((grant) => grant.subject === request.previousSubject);
    const nextPerson = personFor(observation, request.personId, request.tenantId);
    const founderOrAdmin = previousPerson.kind === "founder" || previousPerson.kind === "system-owner" || administratorIdentity
      || nextPerson?.kind === "founder" || nextPerson?.kind === "system-owner";
    const requiredCapability: IdentityAdminCapability = founderOrAdmin ? "recover-founder" : "approve-reassignment";
    if (!approvalPrincipal || !isAuthenticatedPrincipal(approvalPrincipal) || approvalPrincipal.subject === principal.subject
      || approvalPrincipal.subject === request.previousSubject || approvalPrincipal.subject === request.subject
      || !freshAuthentication(observation, approvalPrincipal.subject, nowMs)
      || !scopedAdmin("approve-reassignment", [...requiredLocks], approvalPrincipal.subject)
      || (founderOrAdmin && !scopedAdmin(requiredCapability, [...requiredLocks], principal.subject))) {
      return denied("independent-fresh-approval-required");
    }
    const approverBinding = active.bindings.get(approvalPrincipal.subject);
    if (!approverBinding || approverBinding.personId === request.previousPersonId || approverBinding.personId === request.personId) {
      return denied("independent-approver-identity-required");
    }
    scopes.forEach((tenantId) => {
      const membership = membershipFor(observation, request.previousSubject, tenantId);
      if (membership?.status === "active") membershipRevocations.push({
        tenantId, subject: request.previousSubject, expectedMembershipRevision: membership.revision,
      });
    });
    requiresSessionRevocation = true;
    eventDetails = {
      kind: "binding-reassigned", previousBindingId: previous.bindingId, previousSubject: previous.subject,
      previousPersonId: previous.personId, bindingId: request.eventId, subject: request.subject,
      personId: request.personId, verificationId: claim.verificationId, verifiedAtMs: claim.verifiedAtMs,
      justification: request.justification,
      revokedAdministratorGrantIds: [...active.administrators.values()]
        .filter((grant) => grant.subject === request.previousSubject).map((grant) => grant.grantId).sort(),
      approvedBySubject: approvalPrincipal.subject, approvedAtMs: nowMs,
      approvedAuthenticatedAtMs: authenticationTime(observation, approvalPrincipal.subject) ?? nowMs,
    };
  } else if (request.kind === "grant-administrator") {
    if (request.subject === principal.subject) return denied("self-escalation");
    if (membershipFor(observation, request.subject, request.tenantId)?.status !== "active") return denied("target-membership-required");
    const targetBinding = active.bindings.get(request.subject);
    if (!targetBinding || personFor(observation, targetBinding.personId, request.tenantId)?.status !== "active") {
      return denied("verified-target-identity-required");
    }
    if (!scopedAdmin("delegate", [request.tenantId])) return denied("identity-admin-permission-required");
    const grant = activeGrant(registry, request.tenantId, principal.subject);
    if (!grant || request.capabilities.some((capability) => !grant.capabilities.includes(capability))) {
      return denied("delegation-exceeds-authority");
    }
    if ([...active.administrators.values()].some((entry) => entry.tenantId === request.tenantId && entry.subject === request.subject)) {
      return denied("administrator-already-active");
    }
    eventDetails = {
      kind: "administrator-granted", grantId: request.grantId, subject: request.subject,
      capabilities: [...request.capabilities], source: "delegated",
    };
  } else {
    const grant = active.administrators.get(request.grantId);
    if (!grant || grant.tenantId !== request.tenantId) return denied("active-administrator-grant-required");
    if (grant.source === "bootstrap") return denied("bootstrap-administrator-protected");
    if (grant.subject === principal.subject) return denied("self-revocation");
    if (!scopedAdmin("delegate", [request.tenantId])) return denied("identity-admin-permission-required");
    const remaining = [...active.administrators.values()].filter((entry) => entry.tenantId === request.tenantId
      && entry.grantId !== grant.grantId);
    if (grant.capabilities.some((capability) => !remaining.some((entry) => entry.capabilities.includes(capability)))) {
      return denied("last-authority-grant-protected");
    }
    eventDetails = {
      kind: "administrator-revoked", grantId: grant.grantId, subject: grant.subject,
      justification: request.justification,
    };
    requiresSessionRevocation = true;
  }

  const event = makeEvent(registry, request, principal.subject, nowMs, eventDetails);
  const policyRevisionDelta = event.kind === "administrator-granted" || event.kind === "administrator-revoked"
    ? 1
    : event.kind === "binding-revoked" || event.kind === "binding-reassigned"
      ? event.revokedAdministratorGrantIds.length : 0;
  const nextRegistry: ContributionIdentityRegistry = {
    version: 1,
    revision: registry.revision + 1,
    bindingRevision: registry.bindingRevision + (["subject-bound", "binding-revoked", "binding-reassigned"].includes(event.kind) ? 1 : 0),
    policyRevision: registry.policyRevision + policyRevisionDelta,
    events: [...registry.events, event],
  };
  if (!isContributionIdentityRegistry(nextRegistry)) return denied("invalid-identity-transition");
  return Object.freeze({
    status: "preview",
    plan: Object.freeze({
      operationId: request.operationId,
      scopeTenantId: request.tenantId,
      actorSubject: principal.subject,
      policyRevision: observation.policyRevision,
      identityPolicyRevision: registry.policyRevision,
      tenantPolicyRevisions: Object.freeze([...requiredLocks].sort().flatMap((tenantId) => {
        const policy = observation.tenantPolicyRevisions.find((entry) => entry.tenantId === tenantId);
        return policy ? [{ tenantId, revision: policy.revision }] : [];
      })),
      registryRevision: registry.revision,
      bindingRevision: registry.bindingRevision,
      membershipRevocations: Object.freeze(membershipRevocations.sort((a, b) =>
        a.tenantId.localeCompare(b.tenantId) || a.subject.localeCompare(b.subject))),
      requiredTenantLocks: Object.freeze([...requiredLocks].sort()),
      requiresGlobalIdentityLock: true,
      lockOrder: "global-identity-registry-then-sorted-tenant-locks",
      event: freezeValue(event),
      historicalContributionAttribution: "unchanged",
      transfersExistingRoleGrants: false,
      requiresSessionRevocation,
      requiresLockedRevalidation: true,
      durable: false,
      effect: "identity-preview-only",
    }),
  });
}

export function previewContributionIdentityOperation(
  principal: AuthenticatedPrincipal,
  approvalPrincipal: AuthenticatedPrincipal | null,
  registryValue: unknown,
  observationValue: unknown,
  requestValue: unknown,
  claimValue: VerifiedIdentityClaim | null,
  nowMs: number,
): IdentityDecision {
  try {
    return evaluateContributionIdentityOperation(
      principal, approvalPrincipal, registryValue, observationValue, requestValue, claimValue, nowMs,
    );
  } catch {
    return denied("invalid-authority");
  }
}

export type IdentityRegistryTransactionContract = Readonly<{
  // Lock the global identity registry, then every tenant in sorted order before fresh reads.
  // Revalidate policy, memberships, session freshness, verification, uniqueness and event history
  // while those locks are held. Never move role grants or rewrite historical Person attribution.
  // Commit the registry event, all required membership revocations and audit atomically.
  lockOrder: "global-identity-registry-then-sorted-tenant-locks";
  commitOnlyWithConfirmedDatabaseCommit: true;
  rejectStaleOrConflictingReassignment: true;
  preserveAppendOnlyIdentityEvents: true;
}>;

export type ContributionIdentityAuthorityDependencies = Readonly<{
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  observe(principal: AuthenticatedPrincipal): Promise<Readonly<{
    registry: unknown;
    authority: unknown;
    verifiedClaim: VerifiedIdentityClaim | null;
    nowMs: number;
  }>>;
}>;

export function createContributionIdentityPreviewAuthority(dependencies: ContributionIdentityAuthorityDependencies) {
  const resolvePrincipal = createServerPrincipalResolver(dependencies.resolveSession);
  return Object.freeze({
    async preview(request: Request, approvalPrincipal: AuthenticatedPrincipal | null, input: unknown): Promise<IdentityDecision> {
      const principal = await resolvePrincipal(request);
      if (!isAuthenticatedPrincipal(principal)) return denied("authentication-required");
      try {
        const observed = await dependencies.observe(principal);
        return previewContributionIdentityOperation(
          principal, approvalPrincipal, observed.registry, observed.authority, input, observed.verifiedClaim, observed.nowMs,
        );
      } catch {
        return denied("trusted-identity-authority-unavailable");
      }
    },
  });
}
