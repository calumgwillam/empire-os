# Trusted employee provisioning — implementation contract

Status: design only; not activated.

1. Add a new migration; never edit applied migrations.
2. Keep existing apply_operation behaviour unchanged.
3. Use the existing tenant-wide authority lock.
4. Verify founder identity through the database runtime binding.
5. Independently derive exactly one new active membership.
6. Accept only existing active roles; never create grants.
7. Reject duplicate identities and revoked membership tombstones.
8. Preserve owner, dataset, role and delegation records.
9. Increment the policy revision exactly once.
10. Commit the matching audit and authority change atomically.
11. Fail closed on stale revisions and uncertain commit results.
12. Provision database-role tenant bindings through a separate
    least-privilege trusted administration procedure.
13. Do not enable invites or runtime access before integration tests.
14. Test only against a newly created disposable database.

## Migration 005 atomic upgrade requirements

- Wrap the entire migration in BEGIN and COMMIT.
- Verify the expected existing schema and audit constraint.
- Replace the audit operation constraint without weakening it.
- Extend the authority revision uniqueness index.
- Update both audit-revision and deferred authority-audit checks.
- Install the independently enforced founder-only mutation.
- Revoke function execution from PUBLIC.
- Grant execution only to explicitly authorised runtime identities.
- Abort the entire migration if any required step fails.
- Run only on a newly verified disposable test database.
- Do not activate employee invitations until integration tests pass.
