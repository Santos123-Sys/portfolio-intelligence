import { describe, expect, it } from 'vitest';
import { readInitialAdminConfig } from '../src/lib/initial-admin-config';

describe('initial administrator configuration', () => {
  it('normalizes a complete owner configuration', () => {
    expect(readInitialAdminConfig({
      INITIAL_ADMIN_EMAIL: '  Owner@Example.COM ',
      INITIAL_ADMIN_PASSWORD: 'a sufficiently long password',
      INITIAL_ADMIN_NAME: '  Portfolio Owner  ',
    })).toEqual({
      email: 'owner@example.com',
      password: 'a sufficiently long password',
      displayName: 'Portfolio Owner',
    });
  });

  it('skips an unconfigured optional bootstrap', () => {
    expect(readInitialAdminConfig({}, { optional: true })).toBeNull();
  });

  it('rejects a partially configured bootstrap', () => {
    expect(() => readInitialAdminConfig({ INITIAL_ADMIN_EMAIL: 'owner@example.com' }, { optional: true }))
      .toThrow('Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD');
  });

  it('rejects an invalid owner email before connecting to the database', () => {
    expect(() => readInitialAdminConfig({
      INITIAL_ADMIN_EMAIL: 'not-an-email',
      INITIAL_ADMIN_PASSWORD: 'a sufficiently long password',
    })).toThrow('INITIAL_ADMIN_EMAIL must be a valid email address');
  });

  it('keeps the explicit command strict when variables are absent', () => {
    expect(() => readInitialAdminConfig({})).toThrow(
      'Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD'
    );
  });
});
