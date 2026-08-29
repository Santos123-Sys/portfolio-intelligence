import { createRailwayContext, project, type ServiceNode } from 'railway/iac';
import { describe, expect, it } from 'vitest';
import railwayDefinition from '../.railway/railway';

async function productionServices(): Promise<ServiceNode[]> {
  const definition = await railwayDefinition(
    createRailwayContext({ environment: 'production' }),
    project
  );
  return (definition.resources ?? []).flat().filter(
    (resource): resource is ServiceNode => resource.type === 'service'
  );
}

describe('Railway infrastructure definition', () => {
  it('defines the dashboard, private agentic API and private agentic worker', async () => {
    const services = await productionServices();

    expect(services.map(({ name }) => name).sort()).toEqual([
      'agentic-api',
      'agentic-worker',
      'portfolio-intelligence',
    ]);
    expect(services.find(({ name }) => name === 'agentic-api')?.networking).toBeUndefined();
    expect(services.find(({ name }) => name === 'agentic-worker')?.networking).toBeUndefined();
  });

  it('runs migrations and the conditional owner bootstrap before dashboard deploys', async () => {
    const dashboard = (await productionServices()).find(
      ({ name }) => name === 'portfolio-intelligence'
    );

    expect(dashboard?.build?.builder).toBe('RAILPACK');
    expect(dashboard?.deploy?.preDeployCommand).toEqual([
      'npm run db:migrate && npm run admin:create:if-configured',
    ]);
    expect(dashboard?.deploy?.healthcheckPath).toBe('/api/health');
  });

  it('uses generated, preserved or cross-resource secret values rather than literals', async () => {
    const services = await productionServices();
    const dashboard = services.find(({ name }) => name === 'portfolio-intelligence');
    const api = services.find(({ name }) => name === 'agentic-api');
    const worker = services.find(({ name }) => name === 'agentic-worker');

    expect(dashboard?.variables?.SESSION_SECRET).toEqual({ type: 'preserve' });
    expect(dashboard?.variables?.MFA_ENCRYPTION_KEY).toEqual({ type: 'preserve' });
    expect(api?.variables?.AGENTIC_SYSTEM_API_KEY).toEqual({
      type: 'raw',
      value: { generator: 'secret(48)', isSealed: true },
    });
    expect(worker?.variables?.OPENAI_API_KEY).toMatchObject({
      type: 'sharedReference',
      name: 'OPENAI_API_KEY',
    });
    expect(dashboard?.variables?.MARKET_DATA_PROVIDER).toMatchObject({
      type: 'literal',
      value: 'eodhd',
    });
    expect(dashboard?.variables?.MARKET_DATA_API_KEY).toMatchObject({
      type: 'sharedReference',
      name: 'MARKET_DATA_API_KEY',
    });
    expect(worker?.variables?.AGENTIC_SYSTEM_API_KEY).toMatchObject({
      type: 'reference',
      resource: 'service.agentic-api',
      output: 'AGENTIC_SYSTEM_API_KEY',
    });
  });
});
