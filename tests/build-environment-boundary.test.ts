import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalSessionSecret = process.env.SESSION_SECRET;

function restore(name: 'DATABASE_URL' | 'SESSION_SECRET', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('DATABASE_URL', originalDatabaseUrl);
  restore('SESSION_SECRET', originalSessionSecret);
  vi.resetModules();
});

describe('Railway image-build environment boundary', () => {
  it('imports the database module without reading runtime credentials', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    vi.resetModules();

    const databaseModule = await import('../src/lib/db');
    expect(databaseModule.db).toBeDefined();
    expect(() => databaseModule.getDatabase()).toThrow(/DATABASE_URL/);
  });

  it('keeps the deployed health check strict when runtime credentials are missing', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    vi.resetModules();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { GET } = await import('../src/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'unhealthy',
      configuration: 'invalid-or-unreachable',
    });
    expect(log).toHaveBeenCalledWith(
      '[health] Runtime configuration or database check failed',
      expect.objectContaining({ error: expect.stringMatching(/DATABASE_URL|SESSION_SECRET/) })
    );
    log.mockRestore();
  });
});
