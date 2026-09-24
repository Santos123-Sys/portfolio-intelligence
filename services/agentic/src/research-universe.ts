import { researchCompany, type WebResearchConfig, type WebResearchEvidence } from './web-research.js';

type Company = { companyName: string; ticker: string; exchange: string };
type Search = typeof researchCompany;
const cache = new Map<string, { evidence: WebResearchEvidence; expiresAt: number }>();
const MAX_CACHE = 500;
const TTL_MS = 24 * 60 * 60 * 1_000;

/** At most two searches in flight, with starts spaced to respect small provider plans. */
export async function researchUniverse(
  companies: Company[], config: WebResearchConfig,
  onProgress: (completed: number, total: number) => Promise<void> = async () => {},
  search: Search = researchCompany,
  spacingMs = 750
): Promise<Map<string, WebResearchEvidence>> {
  const result = new Map<string, WebResearchEvidence>();
  let next = 0;
  let completed = 0;
  let nextStart = Date.now();
  let sequence = Promise.resolve();
  let progressChain = Promise.resolve();
  const reserve = () => {
    const ticket = sequence.then(async () => {
      const start = Math.max(Date.now(), nextStart);
      nextStart = start + spacingMs;
      if (start > Date.now()) await new Promise((resolve) => setTimeout(resolve, start - Date.now()));
    });
    sequence = ticket;
    return ticket;
  };
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const id = `${company.exchange}:${company.ticker}`;
      const key = `${config.provider}:${id}:${company.companyName}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        result.set(id, cached.evidence);
      } else {
        await reserve();
        const evidence = await search(company.companyName, company.ticker, config);
        result.set(id, evidence);
        if (config.provider !== 'none') {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, { evidence, expiresAt: Date.now() + TTL_MS });
        }
      }
      const count = ++completed;
      progressChain = progressChain.then(() => onProgress(count, companies.length));
      await progressChain;
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, companies.length) }, worker));
  return result;
}
