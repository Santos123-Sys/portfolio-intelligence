import {
  bucket,
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  ref,
  service,
} from 'railway/iac';

const repository = 'Santos123-Sys/portfolio-intelligence';
const productionBranch = 'main';

export default defineRailway((context) => {
  const dashboardDatabase = postgres('dashboard-postgres');
  const agenticDatabase = postgres('agentic-postgres');
  const agenticArtifacts = bucket('agentic-artifacts');

  const agenticApi = service('agentic-api', {
    source: github(repository, { branch: productionBranch }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'npm run build:agentic',
    },
    preDeploy: 'npm run agentic:migrate',
    start: 'npm run agentic:api',
    healthcheck: '/health',
    healthcheckTimeout: 300,
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: 'production',
      AGENTIC_DATABASE_URL: agenticDatabase.env.DATABASE_URL,
      AGENTIC_SYSTEM_API_KEY: { generator: 'secret(48)', isSealed: true },
      AGENTIC_INTERNAL_BASE_URL:
        'http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}',
      AGENTIC_BUCKET_NAME: ref(agenticArtifacts, 'BUCKET'),
      AGENTIC_BUCKET_ENDPOINT: ref(agenticArtifacts, 'ENDPOINT'),
      AGENTIC_BUCKET_REGION: ref(agenticArtifacts, 'REGION'),
      AGENTIC_BUCKET_ACCESS_KEY_ID: ref(agenticArtifacts, 'ACCESS_KEY_ID'),
      AGENTIC_BUCKET_SECRET_ACCESS_KEY: ref(agenticArtifacts, 'SECRET_ACCESS_KEY'),
    },
  });

  const dashboard = service('portfolio-intelligence', {
    source: github(repository, { branch: productionBranch }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'npm run build',
    },
    preDeploy: 'npm run db:migrate && npm run admin:create:if-configured',
    start: 'npm run start:standalone',
    healthcheck: '/api/health',
    healthcheckTimeout: 300,
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: dashboardDatabase.env.DATABASE_URL,
      SESSION_SECRET: preserve(),
      MFA_ENCRYPTION_KEY: preserve(),
      PUBLIC_APP_URL: 'https://portfolio-intelligence-production-d042.up.railway.app',
      INITIAL_ADMIN_EMAIL: preserve(),
      INITIAL_ADMIN_NAME: preserve(),
      INITIAL_ADMIN_PASSWORD: preserve(),
      MARKET_DATA_PROVIDER: 'eodhd',
      MARKET_DATA_API_KEY: context.shared.MARKET_DATA_API_KEY,
      WEB_SEARCH_PROVIDER: 'none',
      AGENTIC_SYSTEM_API_KEY: agenticApi.env.AGENTIC_SYSTEM_API_KEY,
      AGENTIC_SYSTEM_BASE_URL:
        'http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}',
    },
  });

  const agenticWorker = service('agentic-worker', {
    source: github(repository, { branch: productionBranch }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'npm run build:agentic',
    },
    preDeploy: 'npm run agentic:migrate',
    start: 'npm run agentic:worker',
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: 'production',
      AGENTIC_DATABASE_URL: agenticDatabase.env.DATABASE_URL,
      AGENTIC_SYSTEM_API_KEY: agenticApi.env.AGENTIC_SYSTEM_API_KEY,
      OPENAI_API_KEY: context.shared.OPENAI_API_KEY,
      OPENAI_MODEL: 'gpt-5.6',
      OPENAI_REASONING_EFFORT: 'medium',
      DASHBOARD_IMPORT_URL:
        'http://${{portfolio-intelligence.RAILWAY_PRIVATE_DOMAIN}}:${{portfolio-intelligence.PORT}}/api/integrations/agentic/import',
      AGENTIC_INTERNAL_BASE_URL:
        'http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}',
      AGENTIC_WORKER_POLL_MS: '1000',
      AGENTIC_JOB_LEASE_SECONDS: '300',
      AGENTIC_CALLBACK_MAX_ATTEMPTS: '8',
      AGENTIC_BUCKET_NAME: ref(agenticArtifacts, 'BUCKET'),
      AGENTIC_BUCKET_ENDPOINT: ref(agenticArtifacts, 'ENDPOINT'),
      AGENTIC_BUCKET_REGION: ref(agenticArtifacts, 'REGION'),
      AGENTIC_BUCKET_ACCESS_KEY_ID: ref(agenticArtifacts, 'ACCESS_KEY_ID'),
      AGENTIC_BUCKET_SECRET_ACCESS_KEY: ref(agenticArtifacts, 'SECRET_ACCESS_KEY'),
    },
  });

  return project('portfolio-intelligence', {
    resources: [
      dashboardDatabase,
      agenticDatabase,
      agenticArtifacts,
      dashboard,
      agenticApi,
      agenticWorker,
    ],
  });
});
