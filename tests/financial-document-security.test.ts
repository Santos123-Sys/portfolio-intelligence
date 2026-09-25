import { describe, expect, it } from 'vitest';
import { validateFinancialPdfDocument } from '../src/lib/document-security';
const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`).toString('base64');
describe('Swiss financial PDF admission', () => {
  it('accepts ordinary annual-report hyperlinks while retaining the original bytes', () => {
    const contentBase64 = pdf('/URI (https://issuer.example/investors)');
    expect(validateFinancialPdfDocument({ fileName: 'annual-report.pdf', contentBase64 }).contentBase64).toBe(contentBase64);
  });
  it('rejects executable PDF actions', () => {
    expect(() => validateFinancialPdfDocument({ fileName: 'bad.pdf', contentBase64: pdf('/JavaScript (alert(1))') })).toThrow(/Active/);
  });
});
