import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

const runId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

test('thesis-matched discovery remains reviewable through approval and report access', async ({ page, context }) => {
  const expiry = Date.now() + 60 * 60_000;
  const payload = `${randomUUID()}.${expiry}.${randomBytes(32).toString('base64url')}`;
  const token = await signSessionPayload(payload, 'browser-test-only-session-secret-at-least-32-characters');
  await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);

  let started = false;
  let approved = false;
  const candidate = () => ({
    id: candidateId, runId, ticker: 'NESN', exchange: 'XSWX', companyName: 'Nestle SA', currency: 'CHF',
    portfolioName: 'Swiss Quality', country: 'Switzerland', sector: 'Consumer', industry: 'Food', classificationSource: 'provider',
    decision: approved ? 'approved' : 'pending', workflowStatus: approved ? 'analysis_ready' : 'pending',
    analysisRunStatus: approved ? 'completed' : null, externalAnalysisRunId: approved ? 'analysis-1' : null,
    analysisRunError: null, analysisErrorMessage: null, reportUrl: approved ? '/api/integrations/agentic/reports?externalRunId=analysis-1' : null,
    analysisMode: 'limited_research_risk', dcfLocked: true, dcfLockReason: 'Statements unavailable',
    latestPrice: null, decisionJournal: null, risk: null, analysis: null, valuation: null,
    evidenceScorecard: { assessment: 'developing', verifiedSourceCount: 1, groundedFactCount: 2, informationGapCount: 2, marketPriceStatus: 'unavailable', summary: 'Initial evidence; gaps remain.' },
    discoveryJson: { thesisAlignmentScore: 81, rationale: 'Matches the quality mandate.', matchedCriteria: ['Swiss listing'], violatedCriteria: [], informationGaps: ['Check cash generation'], groundedIn: ['identity:ticker', 'identity:exchange'], sourceUrls: ['https://example.org/issuer'] },
  });
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
    if (pathname === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
    if (pathname === '/api/discovery/preflight') return json({ preflight: { ready: true, checkedAt: '2026-09-23T11:00:00.000Z', provider: 'finnhub', checks: [
      { label: 'Swiss SIX universe', detail: '25 securities available', status: 'ready' },
      { label: 'Brazilian B3 universe', detail: '25 securities available', status: 'ready' },
    ] } });
    if (pathname === '/api/discovery/runs' && method === 'POST') { started = true; return json({ run: { id: runId } }, 202); }
    if (pathname === '/api/discovery/runs') return json({ runs: started ? [{ id: runId, status: 'completed', requestedAt: '2026-09-23T11:00:00.000Z', candidateCount: 1, portfolioCandidateCounts: [], resultJson: null }] : [] });
    if (pathname === '/api/discovery/candidates' && method === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.decision).toBe('approved');
      expect(body.journal.decisionReason).toContain('durable');
      approved = true;
      return json({ candidate: candidate() });
    }
    if (pathname === '/api/discovery/candidates') return json({ candidates: [candidate()] });
    return json({});
  });

  await page.goto('/how-it-works');
  await page.getByRole('link', { name: 'Open discovery' }).click();
  await expect(page.getByRole('heading', { name: 'Thesis-Driven Stock Discovery' })).toBeVisible();
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await expect(page.getByText('Brazilian B3 universe')).toBeVisible();
  await page.getByRole('button', { name: 'Find thesis-matched stocks' }).click();
  await expect(page.getByRole('button', { name: 'Review latest candidates' })).toBeVisible();
  await page.getByRole('button', { name: 'Review latest candidates' }).click();
  await expect(page.getByRole('heading', { name: /Nestle SA/ })).toBeVisible();
  await page.getByLabel('Why does this fit the thesis?').fill('A durable competitive advantage warrants deeper analysis.');
  await page.getByLabel('Expected holding period').fill('Five years');
  await page.getByLabel('Current valuation view').fill('Test normalized cash flows before investing.');
  await page.getByLabel('Principal risk').fill('Margin compression from input costs.');
  await page.getByLabel('What would invalidate the view?').fill('Sustained loss of pricing power.');
  await page.getByRole('button', { name: 'Approve & analyze' }).click();
  await expect(page.getByRole('link', { name: 'Open PDF report' })).toHaveAttribute('href', /reports\?externalRunId=analysis-1/);
});
