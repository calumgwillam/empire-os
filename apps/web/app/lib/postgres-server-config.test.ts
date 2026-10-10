import { describe, expect, it } from "vitest";
import { parseServerPostgresConfig, SERVER_POSTGRES_ENV } from "./postgres-server-config";

const validEnvironment = {
  [SERVER_POSTGRES_ENV.host]: "db.internal",
  [SERVER_POSTGRES_ENV.port]: "5432",
  [SERVER_POSTGRES_ENV.database]: "empire_os",
  [SERVER_POSTGRES_ENV.user]: "empire_os_app",
  [SERVER_POSTGRES_ENV.password]: "configured-test-value",
};

describe("server-only PostgreSQL configuration", () => {
  it("does not infer server credentials from public or generic PostgreSQL environment names", () => {
    expect(parseServerPostgresConfig({
      NEXT_PUBLIC_DATABASE_URL: "untrusted",
      DATABASE_URL: "untrusted",
      PGHOST: "untrusted",
      PGDATABASE: "untrusted",
    })).toEqual({ status: "unconfigured" });
  });

  it("fails closed on partial configuration", () => {
    expect(parseServerPostgresConfig({
      [SERVER_POSTGRES_ENV.host]: "db.internal",
      [SERVER_POSTGRES_ENV.port]: "5432",
    })).toMatchObject({ status: "invalid", missing: expect.arrayContaining([
      SERVER_POSTGRES_ENV.database,
      SERVER_POSTGRES_ENV.user,
      SERVER_POSTGRES_ENV.password,
    ]) });
  });

  it("distinguishes an absent port from an explicitly invalid empty port", () => {
    expect(parseServerPostgresConfig({ ...validEnvironment, [SERVER_POSTGRES_ENV.port]: undefined }))
      .toEqual({ status: "invalid", missing: [SERVER_POSTGRES_ENV.port] });
    expect(parseServerPostgresConfig({ ...validEnvironment, [SERVER_POSTGRES_ENV.port]: "" }))
      .toEqual({ status: "invalid", missing: [], reason: "invalid-port" });
  });

  it.each(["host", "database", "user", "password"] as const)("rejects explicitly empty %s configuration", (field) => {
    expect(parseServerPostgresConfig({ ...validEnvironment, [SERVER_POSTGRES_ENV[field]]: "" }))
      .toEqual({ status: "invalid", missing: [], reason: "invalid-value" });
  });

  it("rejects entirely empty supplied configuration rather than treating it as absent", () => {
    expect(parseServerPostgresConfig(Object.fromEntries(Object.values(SERVER_POSTGRES_ENV).map((name) => [name, ""]))))
      .toEqual({ status: "invalid", missing: [], reason: "invalid-value" });
  });

  it.each(["", "0", "-1", "5432x", "65536", "999999"])("rejects invalid ports: %s", (port) => {
    expect(parseServerPostgresConfig({ ...validEnvironment, [SERVER_POSTGRES_ENV.port]: port }))
      .toMatchObject({ status: "invalid", reason: "invalid-port" });
  });

  it("returns private connection settings with verified TLS required", () => {
    const result = parseServerPostgresConfig(validEnvironment);
    expect(result.status).toBe("configured");
    if (result.status !== "configured") throw new Error("Expected complete server configuration.");
    expect(result.config).toMatchObject({
      host: "db.internal",
      port: 5432,
      database: "empire_os",
      user: "empire_os_app",
      ssl: { rejectUnauthorized: true },
    });
    expect(Object.isFrozen(result.config)).toBe(true);
  });
});
