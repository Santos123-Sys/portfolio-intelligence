import { describe, expect, it } from 'vitest';
import { getApiConfig, getWorkerConfig } from '../src/config.js';

const common = {
  NODE_ENV: 'test',
  AGENTIC_DATABASE_URL: 'postgresql://agentic:agentic@localhost:5432/agentic',
  AGENTIC_SYSTEM_API_KEY: '12345678901234567890123456789012',
};

describe('Railway environment validation', () => {
  it('accepts API configuration and rejects a partial bucket', () => {
    expect(getApiConfig(common).PORT).toBe(3001);
    expect(() => getApiConfig({ ...common, AGENTIC_BUCKET_NAME: 'reports' }))
      .toThrow(/configured together/);
  });

  it('maps Railway bucket variables for the worker', () => {
    const config = getWorkerConfig({
      ...common,
      OPENAI_API_KEY: 'openai-test-key',
      DASHBOARD_IMPORT_URL: 'http://dashboard.railway.internal:3000/api/integrations/agentic/import',
      BUCKET: 'reports',
      ENDPOINT: 'https://bucket.railway.app',
      REGION: 'auto',
      ACCESS_KEY_ID: 'access',
      SECRET_ACCESS_KEY: 'secret',
    });
    expect(config.AGENTIC_BUCKET_NAME).toBe('reports');
    expect(config.OPENAI_MODEL).toBe('gpt-5.6');
  });
});
