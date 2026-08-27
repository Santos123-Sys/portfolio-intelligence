import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getApiConfig } from './config.js';

export async function migrate(connectionString = getApiConfig().AGENTIC_DATABASE_URL): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
  try {
    await sql`select pg_advisory_lock(hashtext('portfolio_intelligence_agentic_migrations'))`;
    await sql`
      create table if not exists agentic_schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const filenames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
    for (const filename of filenames) {
      const [existing] = await sql`select filename from agentic_schema_migrations where filename = ${filename}`;
      if (existing) continue;
      const source = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
      await sql.begin(async (transaction) => {
        await transaction.unsafe(source);
        await transaction`insert into agentic_schema_migrations (filename) values (${filename})`;
      });
      process.stdout.write(`Applied ${filename}\n`);
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext('portfolio_intelligence_agentic_migrations'))`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  migrate().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
