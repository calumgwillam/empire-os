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
