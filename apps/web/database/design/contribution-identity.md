# Contribution Intelligence — Phase 5 identity and access foundation

## Status: inactive, preview-only foundation

This phase adds a server-only identity authority model, a durable-schema candidate,
and explicit contribution-view purposes. It does **not** install a Clerk linking
flow, identity writer, API route, Server Action, PostgreSQL adapter, runtime grant,
or active contribution disclosure. The candidate SQL is not a numbered migration
and must not be applied. No current bindings or business records are changed.

The contribution identity and collection plans remain previews. They are not write
receipts or proof of database durability. Runtime activation remains prohibited until
a trusted identity verifier, PostgreSQL transaction adapter, complete People source,
recovery procedure and isolated-database integration tests exist.

## Identity authority

[contribution-identity-authority.ts](../../app/lib/contribution-identity-authority.ts)
accepts only principals minted by the existing server session boundary. The global
registry has append-only bind, revoke, reassign and administrator-grant events.
Projection rejects malformed histories and duplicate active subject or Person
bindings. Names, email addresses, role labels, client actor fields and founder status
are never used to create administrator authority.

The initial Founder / System Owner authority is represented by an explicit
`bootstrap` administrator grant in trusted registry state. A bootstrap grant is
effective only when the subject has an active, freshly authenticated tenant
membership and an active binding to a trusted `founder` or `system-owner` Person
record. Department heads, managers, co-founders and employees receive no implicit
identity capability. Future administrators receive explicit per-tenant capability
grants; delegation is limited to capabilities the delegator already holds, excludes
self-granting, is revocable, and retains grant history.

Binding requires an opaque server-minted verification claim tied to the exact
tenant, Clerk subject and Person ID. The claim resolver delegates independent
verification to an injected trusted server provider; client-supplied identifiers or
role claims cannot mint a claim. The verifier itself is intentionally not installed.
Claims and administrator authentication must be fresh (no older than five minutes)
when a preview is evaluated.

Identity bindings are global while organisation memberships and administrator grants
remain tenant-scoped. Changes that affect a subject with memberships in multiple
organisations require authority and a fresh tenant-policy revision in every affected
organisation. A binding revocation or reassignment preview includes all active
membership revisions to revoke and requires session invalidation. Existing role
grants are never copied to the replacement subject; administrator grants attached to
the obsolete subject are explicitly revoked and cannot become effective again if that
subject is later rebound.

Every reassignment requires explicit justification, exact source binding/revision,
fresh target proof, and a different freshly authenticated approver with
`approve-reassignment` authority in every affected organisation. Founder,
System Owner and administrator identities additionally require
`recover-founder` authority. Revoking a Founder, System Owner or administrator
identity also requires independent approval. No eligible approver means denial;
there is no recovery bypass. Recovery therefore depends on separately delegated,
revocable recovery authority and an independently verified replacement identity.

An identity event never rewrites contribution events, evidence, actor attribution,
or historical Person ownership. It records both old and new identity provenance.
The model requires one global identity-registry lock followed by sorted tenant locks,
checks registry/binding/identity-policy/tenant-policy/membership revisions, and
rejects stale previews rather than rebasing.

## Contribution-specific access

Phase 4's submit, review, correction, dispute, corroboration and disclosure purposes
remain explicit grants; founder, department-head or manager labels do not confer
review authority. `view-own-contributions` is constrained to the authenticated
Person. `view-founder-comparative` is a separate explicit grant, not an automatic
consequence of being a founder. Both remain disclosure previews with
`mayDisclose: false`; no report data or evidence is returned by this phase.

Founder self-report remains distinct from independent verification. Review,
corroboration, correction approval and dispute resolution continue to require an
uninterested actor and unrelated non-self-reported evidence under Phase 4 rules.
No permission permits automatic compensation, equity, employment or authority
changes.

## PostgreSQL candidate and activation gate

[contribution-identity-registry-candidate.sql](./sql/contribution-identity-registry-candidate.sql)
defines candidate global active-binding uniqueness, tenant-scoped administrator
grants, verification metadata, append-only audit history, a registry lock row and
forced RLS. It issues no runtime grants and installs no callable mutation API.
It is intentionally outside `database/migrations/`; it has not been executed.

The candidate does not reference a PostgreSQL People table: current People records
do not yet have an authoritative PostgreSQL source. Before activation, the trusted
loader must establish that each Person ID exists in the correct organisation, and a
reviewed transaction API must atomically consume the verified claim, update the
global registry, revoke all affected tenant memberships/admin grants, append the
audit event and return only after confirmed COMMIT. The API must use the same
server-resolved Clerk subject as the existing authentication boundary and must
recheck all fences after taking locks.

The candidate SQL parser checks and identity-policy unit tests are offline. They do
not connect to, create, migrate, reset or inspect any PostgreSQL database. The
documented disposable database restrictions remain unchanged.
