import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';
import * as coreSchema from './schema';
import * as agenticSchema from './agentic-schema';
import * as workflowSchema from './workflow-schema';

/**
 * For production (Vercel/Neon), use neon-http.
 * For local development, use postgres-js TCP driver.
 */
const queryClient = postgres(getEnv().DATABASE_URL);
const schema = { ...coreSchema, ...agenticSchema, ...workflowSchema };
export const db = drizzle(queryClient, { schema });
export { schema };
