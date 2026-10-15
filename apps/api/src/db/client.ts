import * as Tedious from 'tedious';
import * as Tarn from 'tarn';
import {
  CamelCasePlugin,
  Kysely,
  MssqlDialect,
  sql,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type Selectable,
  type RootOperationNode,
  type Transaction,
  type UnknownRow,
} from 'kysely';
import type { Database } from './types';

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;
export type DbOrTx = Kysely<Database>;

// ───────────────────────────── Connection string ─────────────────────────────

export interface SqlServerConfig {
  server: string;
  port?: number;
  instanceName?: string;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

/**
 * Parses an ADO.NET-style connection string, the format SQL Server tools use:
 *   Server=localhost,1433;Database=utsavora;User Id=utsavora_app;Password=...;Encrypt=true;TrustServerCertificate=true
 * Also accepts "Data Source", "Initial Catalog", "UID", "PWD" and a named instance (Server=HOST\SQLEXPRESS).
 */
export function parseConnectionString(cs: string): SqlServerConfig {
  const kv = new Map<string, string>();
  for (const part of cs.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    kv.set(part.slice(0, i).trim().toLowerCase().replace(/\s+/g, ' '), part.slice(i + 1).trim());
  }
  const get = (...keys: string[]) => keys.map((k) => kv.get(k)).find((v) => v !== undefined);
  let server = get('server', 'data source', 'address', 'addr') ?? 'localhost';
  server = server.replace(/^tcp:/i, '');
  let port: number | undefined;
  let instanceName: string | undefined;
  const comma = server.indexOf(',');
  if (comma >= 0) {
    port = Number(server.slice(comma + 1));
    server = server.slice(0, comma);
  }
  const slash = server.indexOf('\\');
  if (slash >= 0) {
    instanceName = server.slice(slash + 1);
    server = server.slice(0, slash);
  }
  if (server === '.' || server.toLowerCase() === '(local)') server = 'localhost';
  const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(true|yes|1|strict)$/i.test(v));
  const database = get('database', 'initial catalog');
  const user = get('user id', 'uid', 'user');
  const password = get('password', 'pwd') ?? '';
  if (!database) throw new Error('DATABASE_URL must include Database=...');
  if (!user) throw new Error('DATABASE_URL must include User Id=... (SQL Server authentication)');
  return {
    server,
    port: port ?? (instanceName ? undefined : 1433),
    instanceName,
    database,
    user,
    password,
    encrypt: bool(get('encrypt'), true),
    trustServerCertificate: bool(get('trustservercertificate', 'trust server certificate'), false),
  };
}

export function tediousConnection(cfg: SqlServerConfig) {
  return new Tedious.Connection({
    server: cfg.server,
    authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
    options: {
      database: cfg.database,
      port: cfg.port,
      instanceName: cfg.instanceName,
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
      lowerCaseGuids: true, // UNIQUEIDENTIFIER values come back as lowercase strings
      useUTC: true,
      connectTimeout: 15_000,
      requestTimeout: 30_000,
    },
  });
}

// ───────────────────────────── Type plugin ─────────────────────────────

const DATE_KEYS = new Set(['eventDate', 'validUntil', 'receivedOn']);
const JSON_KEYS = new Set(['inclusions', 'exclusions', 'snapshot', 'payload', 'metadata']);

/**
 * SQL Server has no array/jsonb types and tedious returns DATE as a JS Date.
 * This plugin turns DATE columns back into 'YYYY-MM-DD' and parses JSON columns,
 * keyed by (camelCase) column name — see DATE_KEYS / JSON_KEYS.
 */
export class SqlServerTypesPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    for (const row of args.result.rows) convertRow(row);
    return args.result;
  }
}

function convertRow(row: Record<string, unknown>) {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (DATE_KEYS.has(key) && v instanceof Date) row[key] = v.toISOString().slice(0, 10);
    else if (JSON_KEYS.has(key) && typeof v === 'string') row[key] = JSON.parse(v);
  }
}

/** Serialises a value for an NVARCHAR(MAX) JSON column. */
export const json = (v: unknown): string => JSON.stringify(v ?? null);
/** Current UTC time on the database server, for updated_at columns. */
export const now = () => sql<Date>`SYSUTCDATETIME()`;

// ───────────────────────────── Factory ─────────────────────────────

export function createDb(connectionString: string, max = 10): Db {
  const cfg = parseConnectionString(connectionString);
  return new Kysely<Database>({
    dialect: new MssqlDialect({
      tarn: { ...Tarn, options: { min: 0, max } },
      tedious: { ...Tedious, connectionFactory: () => tediousConnection(cfg) },
    }),
    plugins: [new CamelCasePlugin(), new SqlServerTypesPlugin()],
  });
}

/**
 * Reads a row with an update lock held until the transaction ends (SQL Server's SELECT … FOR UPDATE).
 * `table` is the camelCase table name, e.g. 'eventRequests'.
 */
export async function lockRow<T extends keyof Database>(trx: Tx, table: T, id: string): Promise<Selectable<Database[T]> | undefined> {
  const r = await sql<Selectable<Database[T]>>`SELECT * FROM ${sql.table(table)} WITH (UPDLOCK, ROWLOCK) WHERE id = ${id}`.execute(trx);
  return r.rows[0];
}

/** Like lockRow, but a shared lock: the row can be read by others but not changed until commit. */
export async function shareLockRow<T extends keyof Database>(trx: Tx, table: T, id: string): Promise<Selectable<Database[T]> | undefined> {
  const r = await sql<Selectable<Database[T]>>`SELECT * FROM ${sql.table(table)} WITH (HOLDLOCK, ROWLOCK) WHERE id = ${id}`.execute(trx);
  return r.rows[0];
}

/**
 * Transaction-scoped application lock (SQL Server's equivalent of a PostgreSQL advisory lock).
 * Released automatically on commit or rollback.
 */
export async function appLock(trx: Tx, resource: string, timeoutMs = 10_000) {
  const r = await sql<{ result: number }>`
    DECLARE @result INT;
    EXEC @result = sp_getapplock @Resource = ${resource.slice(0, 255)}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = ${timeoutMs};
    SELECT @result AS result;`.execute(trx);
  if ((r.rows[0]?.result ?? -1) < 0) throw Object.assign(new Error('Could not acquire lock'), { number: 1222 });
}

export { sql };
