import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getDatabaseUrl } from '../env';
import * as coreSchema from './schema';
import * as workflowSchema from './workflow-schema';

/**
 * Railway Postgres and local Postgres both expose standard TCP connections.
 * Keep a conservative pool per dashboard replica so scaling the web service
 * does not exhaust the database connection limit.
 */
const schema = { ...coreSchema, ...workflowSchema };

function createDatabase() {
  const queryClient = postgres(getDatabaseUrl(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return drizzle(queryClient, { schema });
}

type Database = ReturnType<typeof createDatabase>;
let database: Database | null = null;

export function getDatabase(): Database {
  if (!database) database = createDatabase();
  return database;
}

/**
 * Preserve the existing `db.select()` API while deferring environment reads
 * until the first real query. Next.js can therefore inspect route modules
 * while building a Railway image without build-time access to runtime secrets.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const activeDatabase = getDatabase();
    const value = Reflect.get(activeDatabase, property, activeDatabase);
    return typeof value === 'function' ? value.bind(activeDatabase) : value;
  },
});

export { schema };
