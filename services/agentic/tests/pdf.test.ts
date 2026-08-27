import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderReportPdf } from '../src/pdf.js';
import { manifest } from './fixtures.js';

describe('human-facing PDF report', () => {
  it('renders genuine, non-trivial PDF bytes from the validated manifest', async () => {
    const pdf = await renderReportPdf(manifest, 'agent-run-pdf-test');
    if (process.env.PDF_TEST_OUTPUT) {
      await mkdir(dirname(process.env.PDF_TEST_OUTPUT), { recursive: true });
      await writeFile(process.env.PDF_TEST_OUTPUT, pdf);
    }
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(pdf.subarray(-20).toString('latin1')).toContain('%%EOF');
  });
});
