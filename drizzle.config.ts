import type { Config } from 'drizzle-kit';
export default {
  schema: [
    './src/lib/db/schema.ts',
    './src/lib/db/agentic-schema.ts',
    './src/lib/db/workflow-schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
