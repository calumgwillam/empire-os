import { env, versions } from "node:process";

if (!versions.node) throw new Error("PostgreSQL configuration is available only in the Node.js runtime.");

export const SERVER_POSTGRES_ENV = Object.freeze({
  host: "EMPIRE_OS_SERVER_PG_HOST",
  port: "EMPIRE_OS_SERVER_PG_PORT",
  database: "EMPIRE_OS_SERVER_PG_DATABASE",
  user: "EMPIRE_OS_SERVER_PG_USER",
  password: "EMPIRE_OS_SERVER_PG_PASSWORD",
} as const);

export type ServerPostgresConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: Readonly<{ rejectUnauthorized: true }>;
}>;

export type ServerPostgresConfigResult =
  | Readonly<{ status: "configured"; config: ServerPostgresConfig }>
  | Readonly<{ status: "unconfigured" }>
  | Readonly<{ status: "invalid"; missing: readonly string[]; reason?: "invalid-port" | "invalid-value" }>;

export function parseServerPostgresConfig(
  source: Readonly<Record<string, string | undefined>>,
): ServerPostgresConfigResult {
  const missing = Object.values(SERVER_POSTGRES_ENV).filter((name) => source[name] === undefined);
  if (missing.length === Object.keys(SERVER_POSTGRES_ENV).length) return { status: "unconfigured" };
  if (missing.length > 0) return { status: "invalid", missing: Object.freeze(missing) };

  const host = source[SERVER_POSTGRES_ENV.host]!;
  const rawPort = source[SERVER_POSTGRES_ENV.port]!;
  const database = source[SERVER_POSTGRES_ENV.database]!;
  const user = source[SERVER_POSTGRES_ENV.user]!;
  const password = source[SERVER_POSTGRES_ENV.password]!;
  if (![host, database, user, password].every((value) => value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value))) {
    return { status: "invalid", missing: Object.freeze([]), reason: "invalid-value" };
  }
  if (!/^[0-9]{1,5}$/.test(rawPort)) {
    return { status: "invalid", missing: Object.freeze([]), reason: "invalid-port" };
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return { status: "invalid", missing: Object.freeze([]), reason: "invalid-port" };
  }

  return {
    status: "configured",
    config: Object.freeze({
      host, port, database, user, password,
      ssl: Object.freeze({ rejectUnauthorized: true as const }),
    }),
  };
}

export function readServerPostgresConfig(): ServerPostgresConfigResult {
  return parseServerPostgresConfig(env);
}
