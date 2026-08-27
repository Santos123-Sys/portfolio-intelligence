import { getApiConfig } from './config.js';
import { createAgenticHttpServer } from './http-server.js';
import { PostgresJobRepository } from './postgres-repository.js';
import { ReportStorage } from './storage.js';

const config = getApiConfig();
const repository = new PostgresJobRepository(config.AGENTIC_DATABASE_URL);
const storage = new ReportStorage(config);
const server = createAgenticHttpServer({
  repository,
  storage,
  apiKey: config.AGENTIC_SYSTEM_API_KEY,
  internalBaseUrl: config.AGENTIC_INTERNAL_BASE_URL,
});

await repository.ping();
server.listen(config.PORT, '0.0.0.0', () => {
  process.stdout.write(`Agentic API listening on 0.0.0.0:${config.PORT}\n`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await repository.close();
      process.exit(0);
    });
  });
}
