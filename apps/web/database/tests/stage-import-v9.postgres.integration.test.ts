import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, QueryResult, QueryResultRow } from "pg";
import type { AuthorizationPostgresConnection, AuthorizationPostgresSource } from "../../app/lib/postgres-authorization-store";
import { createPostgresAuthorizationStore } from "../../app/lib/postgres-authorization-store";
import { createTransactionalAuthorizationExecutor, authorizationRequestContent } from "../../app/lib/authorization-transaction";
import type { TransactionAuthorizationRequest } from "../../app/lib/authorization-transaction-contract";
import { createDurableServerPersistenceAuthority } from "../../app/lib/durable-dataset-repository";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, DEFAULT_SAVED_VIEW_STORAGE_KEY, STORAGE_KEY } from "../../app/lib/backup";
import { decodeRawStoreValue, encodeRawStoreValue, importSourceSha256, prepareServerImport } from "../../app/lib/server-import-preparation";
import type { StageImportRequest, WriteBatch } from "../../app/lib/server-persistence-contract";
import { stageImportV9DisposableConfig } from "./stage-import-v9-disposable-config";
import { connectStageImportV9Disposable, migrateEmptyStageImportV9, seedEmptyDataset } from "./stage-import-v9-harness";
import { testPrincipal } from "./authorization-fixtures";
import type { DisposableConfig } from "./disposable-config";

const configuration = stageImportV9DisposableConfig(process.env);
if (configuration.status === "skip") console.warn(configuration.reason);

type Login = Readonly<{ role: string; password: string }>;
type Fixture = Readonly<{ tenantId: string; datasetId: string; otherDatasetId: string }>;
type ConnectionFault = Readonly<{ kind: "lost-commit-ack" | "mid-import-failure"; failAtKey?: string }>;

const SAFE_ROLE_SUFFIX = () => randomUUID().replaceAll("-", "");

describe.skipIf(configuration.status === "skip")(
  "REAL PostgreSQL 16 candidate 006 durable import staging on fixed NEW v9 database",
  () => {
    let admin: Client;
    let importer: Login;
    let observer: Login;
    let owner: Login;
    const clients: Client[] = [];
    const endingClients: Promise<void>[] = [];

    beforeAll(async () => {
      if (configuration.status !== "configured") throw new Error("Dedicated stage-import v9 database configuration is required.");
      admin = await connectStageImportV9Disposable(configuration.config);
      const identity = await admin.query<{ superuser: boolean; version: string }>(`
        SELECT r.rolsuper AS superuser,current_setting('server_version_num') AS version
        FROM pg_roles r WHERE r.rolname=current_user`);
      if (!identity.rows[0]?.superuser || Math.floor(Number(identity.rows[0].version) / 10000) !== 16) {
        throw new Error("Candidate migrations and test fixture creation require a PostgreSQL 16 disposable-instance superuser.");
      }
      await migrateEmptyStageImportV9(admin);
      importer = await createRestrictedLogin("importer");
      observer = await createRestrictedLogin("observer");
      owner = await createRestrictedLogin("owner");
    }, 30000);

    afterAll(async () => {
      await Promise.all(endingClients);
      for (const client of clients) {
        try { await client.end(); } catch { /* Preserve the original test failure. */ }
      }
      if (admin) await admin.end();
    });

    function databaseConfig(login?: Login): DisposableConfig {
      if (configuration.status !== "configured") throw new Error("Missing dedicated v9 database configuration.");
      return login
        ? { ...configuration.config, user: login.role, password: login.password }
        : configuration.config;
    }

    async function createRestrictedLogin(label: string): Promise<Login> {
      const role = `empire_os_stage_v9_${label}_${SAFE_ROLE_SUFFIX()}`;
      const password = `${SAFE_ROLE_SUFFIX()}${SAFE_ROLE_SUFFIX()}`;
      const database = databaseConfig().database;
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
      await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization,empire_os_preparation TO "${role}"`);
      await admin.query(`GRANT SELECT ON empire_os_authorization.tenants,
        empire_os_authorization.datasets,empire_os_authorization.role_tenants TO "${role}"`);
      await admin.query(`GRANT SELECT(tenant_id,dataset_id,store_key,revision)
        ON empire_os_authorization.preparation_writes TO "${role}"`);
      await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.lock_authority(text),
        empire_os_authorization.lookup_operation(text,text),
        empire_os_authorization.read_dataset_snapshot(text,uuid),
        empire_os_authorization.stage_import(text,jsonb) TO "${role}"`);
      if (label !== "observer") {
        await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.apply_operation(text,jsonb,jsonb)
          TO "${role}"`);
      }
      return { role, password };
    }

    function identityFor(subject: string): Login {
      if (subject === "importer") return importer;
      if (subject === "observer") return observer;
      if (subject === "owner") return owner;
      throw new Error("No test-only login is bound to this subject.");
    }

    function source(login: Login, fault?: ConnectionFault): AuthorizationPostgresSource {
      let lostCommitAcknowledgementDelivered = false;
      return Object.freeze({
        async connect() {
          if (configuration.status !== "configured") throw new Error("Missing dedicated v9 database configuration.");
          const client = await connectStageImportV9Disposable(databaseConfig(login));
          clients.push(client);
          function closeClient() {
            const index = clients.indexOf(client);
            if (index >= 0) clients.splice(index, 1);
            endingClients.push(client.end());
          }
          const identity = await client.query<{ session_user: string; current_user: string; unsafe: boolean }>(`
            SELECT session_user,current_user,
              (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication) AS unsafe
            FROM pg_roles r WHERE r.rolname=session_user`);
          const boundIdentity = identity.rows[0];
          if (identity.rows.length !== 1 || !boundIdentity || boundIdentity.session_user !== login.role
            || boundIdentity.current_user !== login.role || boundIdentity.unsafe) {
            closeClient();
            await endingClients[endingClients.length - 1];
            throw new Error("Import adapter connection did not authenticate as its restricted, actor-bound LOGIN.");
          }

          async function query<R extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<R>> {
            const result = await client.query<R>(sql, values);
            if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED" && fault?.kind === "mid-import-failure") {
              await client.query("SELECT set_config('empire_os_stage_v9.fail_store_key',$1,true)", [fault.failAtKey]);
            }
            if (sql === "COMMIT" && fault?.kind === "lost-commit-ack" && !lostCommitAcknowledgementDelivered) {
              lostCommitAcknowledgementDelivered = true;
              throw new Error("SIMULATED lost COMMIT acknowledgement after PostgreSQL confirmed COMMIT.");
            }
            return result;
          }

          return {
            query: query as AuthorizationPostgresConnection["query"],
            release() { closeClient(); },
          };
        },
      });
    }

    async function fixture(): Promise<Fixture> {
      const tenantId = `tenant-stage-v9-${SAFE_ROLE_SUFFIX()}`;
      const datasetId = randomUUID();
      const otherDatasetId = randomUUID();
      const authority = {
        schemaVersion: 1,
        snapshot: {
          version: 1, revision: 1,
          tenant: { id: tenantId, status: "active", ownerSubjects: ["owner"] },
          datasets: [datasetId, otherDatasetId].map((id) => ({ tenantId, datasetId: id })),
          memberships: [
            { subject: "owner", tenantId, revision: 1, status: "active", roleIds: [] },
            { subject: "importer", tenantId, revision: 1, status: "active", roleIds: ["importer-role"] },
            { subject: "observer", tenantId, revision: 1, status: "active", roleIds: ["reader-role"] },
          ],
          roles: [{
            id: "importer-role", tenantId, revision: 1, status: "active",
            grants: [datasetId, otherDatasetId].flatMap((id) => [
              { id: `read-${id}`, datasetId: id, capability: "read", delegable: false },
              { id: `import-${id}`, datasetId: id, capability: "import", delegable: false },
              { id: `write-${id}`, datasetId: id, capability: "write", delegable: false },
            ]),
          }, {
            id: "reader-role", tenantId, revision: 1, status: "active",
            grants: [datasetId, otherDatasetId].map((id) =>
              ({ id: `observer-read-${id}`, datasetId: id, capability: "read", delegable: false })),
          }],
          delegations: [],
        },
        revocations: [],
      };

      await admin.query("BEGIN");
      try {
        await seedEmptyDataset(admin, datasetId);
        await seedEmptyDataset(admin, otherDatasetId);
        await admin.query(`INSERT INTO empire_os_authorization.tenants(tenant_id,revision,state)
          VALUES ($1,1,$2::jsonb)`, [tenantId, JSON.stringify(authority)]);
        await admin.query(`INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id)
          VALUES ($1,$2),($1,$3)`, [tenantId, datasetId, otherDatasetId]);
        await admin.query(`INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
          VALUES ($1,$4,'importer'),($2,$4,'observer'),($3,$4,'owner')`,
        [importer.role, observer.role, owner.role, tenantId]);
        await admin.query("COMMIT");
      } catch (error) {
        await admin.query("ROLLBACK");
        throw error;
      }
      return { tenantId, datasetId, otherDatasetId };
    }

    function authority(test: Fixture, subject = "importer", fault?: ConnectionFault) {
      const logins = new Map(["importer", "observer", "owner"].map((actor) => [actor, identityFor(actor)]));
      const sources = new Map([...logins].map(([actor, login]) => [actor, source(login, fault)]));
      return createDurableServerPersistenceAuthority({
        tenantId: test.tenantId,
        resolveSession: async () => ({ status: "authenticated", subject }),
        sourceForPrincipal(principal) {
          const value = sources.get(principal.subject);
          if (!value) throw new Error("No test source for principal.");
          return value;
        },
      });
    }

    async function importRequest(test: Fixture, idempotencyKey = `stage:${SAFE_ROLE_SUFFIX()}`,
      defaultView = "\u0000\ud800|\udfff|\ud83d\ude00|\u00e9|e\u0301"): Promise<StageImportRequest> {
      const storage: Record<string, string | null> = Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, null]));
      storage[STORAGE_KEY] = "[]";
      storage[DEFAULT_SAVED_VIEW_STORAGE_KEY] = defaultView;
      const prepared = await prepareServerImport({ getItem: (key) => storage[key] ?? null });
      if (prepared.status !== "prepared") throw new Error(`Test source failed preparation: ${prepared.status}`);
      return { fence: { datasetId: test.datasetId, protocolVersion: 1, generation: 1, authorityRevision: 0 },
        idempotencyKey, plan: prepared.plan };
    }

    async function databaseRows(datasetId: string) {
      const [writes, audits, legacy] = await Promise.all([
        admin.query<{ store_key: string; raw_value: Buffer | null; revision: string }>(`
          SELECT store_key,raw_value,revision::text AS revision FROM empire_os_authorization.preparation_writes
          WHERE dataset_id=$1 ORDER BY store_key`, [datasetId]),
        admin.query<{ operation_id: string; actor_subject: string; evidence: Record<string, unknown>; applied_request: string }>(`
          SELECT operation_id,actor_subject,evidence,applied_request FROM empire_os_authorization.audit
          WHERE dataset_id=$1 ORDER BY operation_id`, [datasetId]),
        admin.query<{ store_key: string; raw_value: Buffer | null; revision: string }>(`
          SELECT store_key,raw_value,revision::text AS revision FROM empire_os_preparation.store_values
          WHERE dataset_id=$1 AND generation=1 ORDER BY store_key`, [datasetId]),
      ]);
      return { writes: writes.rows, audits: audits.rows, legacy: legacy.rows };
    }

    async function transactionRequest(test: Fixture, request: StageImportRequest): Promise<TransactionAuthorizationRequest> {
      const principal = await testPrincipal("importer", test.datasetId);
      expect(principal.subject).toBe("importer");
      return { operationId: request.idempotencyKey, tenantId: test.tenantId, expectedPolicyRevision: 1,
        command: { kind: "stage-import", request } };
    }

    async function sqlFingerprint(request: TransactionAuthorizationRequest): Promise<string> {
      const encodedRequest = JSON.parse(authorizationRequestContent(request));
      const result = await admin.query<{ source_sha256: string }>(`
        WITH RECURSIVE supplied AS (
          SELECT r.registry_position,r.store_key,convert_to(r.store_key,'UTF8') AS key_bytes,e.entry
          FROM empire_os_preparation.store_registry r
          JOIN LATERAL jsonb_array_elements($1::jsonb #> '{command,request,plan,entries}') e(entry)
            ON e.entry->>'key'=r.store_key
        ), folded(position,content) AS (
          SELECT 0::integer,convert_to('empire-os-import-source-v2','UTF8') || decode('00','hex')
          UNION ALL
          SELECT s.registry_position,
            f.content || int2send(octet_length(s.key_bytes)::smallint) || s.key_bytes ||
            CASE WHEN jsonb_typeof(s.entry->'rawValueHex')='null' THEN decode('00','hex')
              ELSE decode('01','hex') || int8send((octet_length(decode(s.entry->>'rawValueHex','hex'))/2)::bigint)
                || decode(s.entry->>'rawValueHex','hex') END
          FROM folded f JOIN supplied s ON s.registry_position=f.position+1
        )
        SELECT encode(sha256(content),'hex') AS source_sha256 FROM folded WHERE position=21`,
      [JSON.stringify(encodedRequest)]);
      expect(result.rows).toHaveLength(1);
      return result.rows[0].source_sha256;
    }

    it("installs only migrations 001–004 plus candidate 006 and leaves all runtime execution revoked", async () => {
      const migrations = await admin.query<{ routine_name: string }>(`
        SELECT routine_name FROM information_schema.routines
        WHERE routine_schema='empire_os_authorization' AND routine_name='stage_import'`);
      expect(migrations.rows).toHaveLength(1);
      const forbiddenProvisioning = await admin.query<{ routine_name: string }>(`
        SELECT routine_name FROM information_schema.routines
        WHERE routine_schema='empire_os_authorization' AND routine_name='provision_member'`);
      expect(forbiddenProvisioning.rows).toHaveLength(0);
      const publicExecute = await admin.query<{ granted: boolean }>(`
        SELECT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
          WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS granted
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='empire_os_authorization' AND p.proname='stage_import'`);
      expect(publicExecute.rows).toEqual([{ granted: false }]);
      const registry = await admin.query<{ store_key: string }>(`
        SELECT store_key FROM empire_os_preparation.store_registry ORDER BY registry_position`);
      expect(registry.rows.map((row) => row.store_key)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    });

    it("matches the real PostgreSQL v2 digest for all 21 stores and reads back exact UTF-16 values", async () => {
      const test = await fixture();
      const request = await importRequest(test);
      const transaction = await transactionRequest(test, request);
      expect(await importSourceSha256(Object.fromEntries(
        request.plan.entries.map(({ key, rawValue }) => [key, rawValue]),
      ))).toBe(request.plan.sourceSha256);
      expect(await sqlFingerprint(transaction)).toBe(request.plan.sourceSha256);
      const emptyString = await importRequest(test, `empty:${SAFE_ROLE_SUFFIX()}`, "");
      expect(await sqlFingerprint(await transactionRequest(test, emptyString))).toBe(emptyString.plan.sourceSha256);
      const nfc = await importRequest(test, `nfc:${SAFE_ROLE_SUFFIX()}`, "\u00e9");
      const nfd = await importRequest(test, `nfd:${SAFE_ROLE_SUFFIX()}`, "e\u0301");
      expect(nfc.plan.sourceSha256).not.toBe(nfd.plan.sourceSha256);
      expect(await sqlFingerprint(await transactionRequest(test, nfc))).toBe(nfc.plan.sourceSha256);
      expect(await sqlFingerprint(await transactionRequest(test, nfd))).toBe(nfd.plan.sourceSha256);

      const staged = await authority(test).stageImport(new Request("https://empire-os.invalid"), request);
      expect(staged).toMatchObject({ status: "staged", replayed: false,
        receipt: { sourceSha256: request.plan.sourceSha256, commitSequence: 1,
          durability: "database-commit-confirmed", idempotencyKey: request.idempotencyKey } });
      const read = await authority(test).readSnapshot(new Request("https://empire-os.invalid"),
        { datasetId: test.datasetId, protocolVersion: 1 });
      expect(read).toMatchObject({ status: "snapshot" });
      if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
      expect(read.snapshot.values).toEqual(request.plan.entries.map(({ key, rawValue }) => ({ key, rawValue, revision: 1 })));
      const value = read.snapshot.values.find((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.rawValue;
      expect(value).toBe("\u0000\ud800|\udfff|\ud83d\ude00|\u00e9|e\u0301");

      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(21);
      expect(rows.audits).toHaveLength(1);
      expect(rows.audits[0]).toMatchObject({ operation_id: request.idempotencyKey, actor_subject: "importer",
        evidence: { operation: "stage-import", decision: { status: "allowed" } } });
      expect(rows.writes.every((row) => row.revision === "1")).toBe(true);
      expect(Array.from(rows.writes.find((row) => row.store_key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.raw_value ?? []))
        .toEqual(Array.from(encodeRawStoreValue(value ?? null) ?? []));
      expect(rows.legacy).toHaveLength(21);
      expect(rows.legacy.every((row) => row.revision === "0" && row.raw_value === null)).toBe(true);
      const activationState = await admin.query<{ generation: string; commit_sequence: string; authority_mode: string }>(`
        SELECT generation::text,commit_sequence::text,authority_mode FROM empire_os_preparation.datasets
        WHERE dataset_id=$1`, [test.datasetId]);
      expect(activationState.rows).toEqual([{ generation: "1", commit_sequence: "0", authority_mode: "denied" }]);
      expect(EMPIRE_OS_BACKUP_STORAGE_KEYS).toHaveLength(21);
      expect(decodeRawStoreValue(rows.writes.find((row) => row.store_key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.raw_value ?? null))
        .toBe(value);
    });

    it("replays only the exact operation and rejects changed source under the committed idempotency key", async () => {
      const test = await fixture();
      const request = await importRequest(test, `replay:${SAFE_ROLE_SUFFIX()}`);
      const boundary = authority(test);
      expect((await boundary.stageImport(new Request("https://empire-os.invalid"), request)).status).toBe("staged");
      expect(await boundary.stageImport(new Request("https://empire-os.invalid"), request))
        .toMatchObject({ status: "staged", replayed: true });
      const changed = await importRequest(test, request.idempotencyKey, "different\u0000source");
      expect(await boundary.stageImport(new Request("https://empire-os.invalid"), changed))
        .toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(21);
      expect(rows.audits).toHaveLength(1);
    });

    it("persists empty bytea separately from SQL NULL absence", async () => {
      const test = await fixture();
      const request = await importRequest(test, `empty-value:${SAFE_ROLE_SUFFIX()}`, "");
      const result = await authority(test).stageImport(new Request("https://empire-os.invalid"), request);
      expect(result.status).toBe("staged");
      const read = await authority(test).readSnapshot(new Request("https://empire-os.invalid"),
        { datasetId: test.datasetId, protocolVersion: 1 });
      if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
      expect(read.snapshot.values.find((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY))
        .toMatchObject({ rawValue: "", revision: 1 });
      expect(read.snapshot.values.find((entry) => entry.key === STORAGE_KEY))
        .toMatchObject({ rawValue: "[]", revision: 1 });
      const rows = await databaseRows(test.datasetId);
      expect(Array.from(rows.writes.find((entry) => entry.store_key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.raw_value ?? []))
        .toEqual([]);
      expect(Array.from(rows.writes.find((entry) => entry.store_key === STORAGE_KEY)?.raw_value ?? []))
        .toEqual(Array.from(encodeRawStoreValue("[]") ?? []));
      expect(rows.writes.filter((entry) => entry.store_key !== DEFAULT_SAVED_VIEW_STORAGE_KEY
        && entry.store_key !== STORAGE_KEY).every((entry) => entry.raw_value === null)).toBe(true);
    });

    it("refuses values already present in the legacy store_values schema", async () => {
      const test = await fixture();
      await admin.query(`UPDATE empire_os_preparation.store_values SET raw_value=$1,revision=revision+1
        WHERE dataset_id=$2 AND generation=1 AND store_key=$3`,
      [encodeRawStoreValue("legacy-value"), test.datasetId, DEFAULT_SAVED_VIEW_STORAGE_KEY]);
      const request = await importRequest(test);
      expect(await authority(test).stageImport(new Request("https://empire-os.invalid"), request))
        .toMatchObject({ status: "failed", outcome: "rolled-back" });
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(0);
      expect(rows.audits).toHaveLength(0);
      const legacyValue = rows.legacy.find((row) => row.store_key === DEFAULT_SAVED_VIEW_STORAGE_KEY);
      expect(legacyValue?.revision).toBe("1");
      expect(Array.from(legacyValue?.raw_value ?? [])).toEqual(Array.from(encodeRawStoreValue("legacy-value") ?? []));
    });

    it("refuses pre-existing preparation_writes without changing the prior committed data", async () => {
      const test = await fixture();
      const batch: WriteBatch = {
        fence: { datasetId: test.datasetId, protocolVersion: 1, generation: 1, authorityRevision: 0 },
        idempotencyKey: `existing-write:${SAFE_ROLE_SUFFIX()}`, reads: [],
        writes: [{ key: STORAGE_KEY, expectedRevision: 0, rawValue: "[]" }],
      };
      expect((await authority(test).writeBatch(new Request("https://empire-os.invalid"), batch)).status).toBe("committed");
      expect(await authority(test).stageImport(new Request("https://empire-os.invalid"), await importRequest(test)))
        .toMatchObject({ status: "conflict", reason: "import-source" });
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(1);
      expect(rows.writes[0]).toMatchObject({ store_key: STORAGE_KEY, revision: "1" });
      expect(Array.from(rows.writes[0].raw_value ?? [])).toEqual(Array.from(encodeRawStoreValue("[]") ?? []));
      expect(rows.audits).toHaveLength(1);
    });

    it("rejects incomplete and malformed byte requests in candidate SQL without recording evidence", async () => {
      const test = await fixture();
      const request = await importRequest(test);
      const transaction = await transactionRequest(test, request);
      const validBound = JSON.parse(authorizationRequestContent(transaction));
      const malformedRequests = [
        { ...structuredClone(validBound), command: { ...validBound.command, request: {
          ...validBound.command.request, plan: { ...validBound.command.request.plan,
            entries: validBound.command.request.plan.entries.slice(1) },
        } } },
        { ...structuredClone(validBound), command: { ...validBound.command, request: {
          ...validBound.command.request, plan: { ...validBound.command.request.plan, entries:
            validBound.command.request.plan.entries.map((entry: Record<string, unknown>, index: number) =>
              index === 0 ? { ...entry, rawValueHex: "0z" } : entry) },
        } } },
        { ...structuredClone(validBound), command: { ...validBound.command, request: {
          ...validBound.command.request, plan: { ...validBound.command.request.plan, sourceSha256: "0".repeat(64) },
        } } },
      ];
      const direct = await connectStageImportV9Disposable(databaseConfig(importer));
      clients.push(direct);
      for (const malformed of malformedRequests) {
        await expect(direct.query("SELECT empire_os_authorization.stage_import($1::text,$2::jsonb)",
          [JSON.stringify(malformed), "{}"])).rejects.toMatchObject({ code: "23514" });
      }
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(0);
      expect(rows.audits).toHaveLength(0);
    });

    it("denies actor, tenant, dataset and capability mismatches, regardless of forged tenant GUCs", async () => {
      const test = await fixture();
      const request = await importRequest({ ...test, datasetId: test.otherDatasetId });
      const observerAuthority = authority(test, "observer");
      expect(await observerAuthority.readSnapshot(new Request("https://empire-os.invalid"),
        { datasetId: test.otherDatasetId, protocolVersion: 1 })).toMatchObject({ status: "snapshot" });
      expect(await observerAuthority.stageImport(new Request("https://empire-os.invalid"), request))
        .toMatchObject({ status: "unauthorized" });
      const boundRequest = await transactionRequest(test, request);
      const observerConnection = await connectStageImportV9Disposable(databaseConfig(observer));
      clients.push(observerConnection);
      await expect(observerConnection.query("SELECT empire_os_authorization.stage_import($1::text,$2::jsonb)",
        [authorizationRequestContent(boundRequest), "{}"])).rejects.toMatchObject({ code: "42501" });

      const mismapped = { ...request, fence: { ...request.fence, datasetId: randomUUID() } };
      expect(await authority(test).stageImport(new Request("https://empire-os.invalid"), mismapped))
        .toMatchObject({ status: "unauthorized" });

      const transaction = await transactionRequest(test, request);
      const bound = JSON.parse(authorizationRequestContent(transaction));
      bound.tenantId = `tenant-unbound-${SAFE_ROLE_SUFFIX()}`;
      const direct = await connectStageImportV9Disposable(databaseConfig(importer));
      clients.push(direct);
      await direct.query("SELECT set_config('empire_os.tenant_id',$1,false)", [`tenant-forged-${SAFE_ROLE_SUFFIX()}`]);
      await expect(direct.query("SELECT empire_os_authorization.stage_import($1::text,$2::jsonb)",
        [JSON.stringify(bound), "{}"])).rejects.toMatchObject({ code: "42501" });
      expect((await databaseRows(test.datasetId)).writes).toHaveLength(0);
    });

    it("enforces membership revocation before a later import", async () => {
      const test = await fixture();
      const ownerPrincipal = await testPrincipal("owner", test.datasetId);
      const ownerSource = source(owner);
      const revoke: TransactionAuthorizationRequest = {
        operationId: `revoke-importer:${SAFE_ROLE_SUFFIX()}`, tenantId: test.tenantId,
        expectedPolicyRevision: 1,
        command: { kind: "revoke", datasetId: test.datasetId, target: { kind: "membership", id: "importer" } },
      };
      expect(await createTransactionalAuthorizationExecutor(createPostgresAuthorizationStore(ownerSource))
        .execute(ownerPrincipal, revoke)).toMatchObject({ status: "executed", durability: "transaction-commit-confirmed" });
      expect(await authority(test).stageImport(new Request("https://empire-os.invalid"), await importRequest(test)))
        .toMatchObject({ status: "unauthorized" });
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(0);
      expect(rows.audits).toHaveLength(1);
      expect(rows.audits[0].evidence.operation).toBe("revoke");
    });

    it("rolls back audit and earlier inserted stores after a real mid-import trigger failure", async () => {
      const test = await fixture();
      const failAtKey = EMPIRE_OS_BACKUP_STORAGE_KEYS[10];
      await admin.query(`CREATE SCHEMA stage_import_v9_fault_support`);
      await admin.query(`CREATE FUNCTION stage_import_v9_fault_support.fail_selected_store()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF current_setting('empire_os_stage_v9.fail_store_key',true)=NEW.store_key THEN
            RAISE EXCEPTION 'Injected stage-import row failure' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END; $$`);
      await admin.query(`CREATE TRIGGER fail_selected_store BEFORE INSERT
        ON empire_os_authorization.preparation_writes
        FOR EACH ROW EXECUTE FUNCTION stage_import_v9_fault_support.fail_selected_store()`);
      try {
        const result = await authority(test, "importer", { kind: "mid-import-failure", failAtKey })
          .stageImport(new Request("https://empire-os.invalid"), await importRequest(test));
        expect(result).toMatchObject({ status: "failed", outcome: "rolled-back" });
        const rows = await databaseRows(test.datasetId);
        expect(rows.writes).toHaveLength(0);
        expect(rows.audits).toHaveLength(0);
      } finally {
        await admin.query("DROP TRIGGER IF EXISTS fail_selected_store ON empire_os_authorization.preparation_writes");
        await admin.query("DROP FUNCTION IF EXISTS stage_import_v9_fault_support.fail_selected_store()");
        await admin.query("DROP SCHEMA IF EXISTS stage_import_v9_fault_support");
      }
    });

    it("reconciles a simulated lost COMMIT acknowledgement from immutable evidence without duplicate writes", async () => {
      const test = await fixture();
      const request = await importRequest(test);
      const boundary = authority(test, "importer", { kind: "lost-commit-ack" });
      expect(await boundary.stageImport(new Request("https://empire-os.invalid"), request))
        .toMatchObject({ status: "staged", replayed: true,
          receipt: { durability: "database-commit-confirmed", idempotencyKey: request.idempotencyKey } });
      const read = await boundary.readSnapshot(new Request("https://empire-os.invalid"),
        { datasetId: test.datasetId, protocolVersion: 1 });
      expect(read).toMatchObject({ status: "snapshot" });
      if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
      expect(read.snapshot.values.map(({ key, rawValue }) => ({ key, rawValue })))
        .toEqual(request.plan.entries.map(({ key, rawValue }) => ({ key, rawValue })));
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(21);
      expect(rows.audits).toHaveLength(1);
    });

    it("serializes concurrent competing imports so no more than one source is staged", async () => {
      const test = await fixture();
      const first = await importRequest(test, `concurrent-a:${SAFE_ROLE_SUFFIX()}`, "first source");
      const second = await importRequest(test, `concurrent-b:${SAFE_ROLE_SUFFIX()}`, "second source");
      const boundary = authority(test);
      const results = await Promise.all([
        boundary.stageImport(new Request("https://empire-os.invalid"), first),
        boundary.stageImport(new Request("https://empire-os.invalid"), second),
      ]);
      expect(results.filter((result) => result.status === "staged")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      const rows = await databaseRows(test.datasetId);
      expect(rows.writes).toHaveLength(21);
      expect(rows.audits.filter((audit) => audit.evidence.operation === "stage-import")).toHaveLength(1);
    });

    it("blocks runtime privilege escalation, direct evidence access and direct table mutation", async () => {
      const test = await fixture();
      const runtime = await connectStageImportV9Disposable(databaseConfig(importer));
      clients.push(runtime);
      const role = await runtime.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean;
        rolcreaterole: boolean; rolreplication: boolean }>(`
          SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
          FROM pg_roles WHERE rolname=session_user`);
      expect(role.rows).toEqual([{
        rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
      }]);
      await expect(runtime.query("SELECT raw_value FROM empire_os_authorization.preparation_writes"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query("SELECT * FROM empire_os_authorization.audit"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query(`INSERT INTO empire_os_authorization.preparation_writes
        (tenant_id,dataset_id,transaction_id,store_key,revision,raw_value)
        VALUES ($1,$2,$3,$4,1,NULL)`, [test.tenantId, test.datasetId, randomUUID(), STORAGE_KEY]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query(`SET ROLE "${configuration.status === "configured" ? configuration.config.user : "missing"}"`))
        .rejects.toMatchObject({ code: "42501" });
      expect((await databaseRows(test.datasetId)).writes).toHaveLength(0);
    });
  },
);
