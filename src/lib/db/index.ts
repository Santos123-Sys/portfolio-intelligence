import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { getEnv } from '../env';
import * as schema from './schema';

/**
 * Neon's HTTP driver rather than a TCP pool. Serverless functions create and
 * destroy connections constantly; a traditional pool exhausts Postgres
 * max_connections under even light concurrency. HTTP is stateless and sidesteps
 * that entirely, at the cost of no transactions across requests.
 */
const sql = neon(getEnv().DATABASE_URL);
export const db = drizzle(sql, { schema });
export { schema };
