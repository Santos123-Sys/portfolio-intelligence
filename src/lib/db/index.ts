import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';
import * as coreSchema from './schema';
import * as workflowSchema from './workflow-schema';

/**
 * Railway Postgres and local Postgres both expose standard TCP connections.
 * Keep a conservative pool per dashboard replica so scaling the web service
 * does not exhaust the database connection limit.
 */
const queryClient = postgres(getEnv().DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 15 });
const schema = { ...coreSchema, ...workflowSchema };
export const db = drizzle(queryClient, { schema });
export { schema };
