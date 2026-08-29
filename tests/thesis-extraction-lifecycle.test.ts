import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canDismissThesisExtraction } from '../src/lib/thesis-extraction-lifecycle';

describe('thesis extraction lifecycle', () => {
  it.each(['queued', 'running', 'completed', 'failed'])('allows %s extractions to be dismissed', (status) => {
    expect(canDismissThesisExtraction(status)).toBe(true);
  });

  it('rejects unknown states by default', () => {
    expect(canDismissThesisExtraction('cancelled')).toBe(false);
  });

  it('backfills previously dismissed extractions into excluded thesis versions', () => {
    const migration = readFileSync(
      new URL('../drizzle/0005_sleepy_obadiah_stane.sql', import.meta.url),
      'utf8'
    );
    expect(migration).toContain('"extraction"."confirmed_thesis_version_id" = "version"."id"');
    expect(migration).toContain('"excluded_at" = "extraction"."dismissed_at"');
    expect(migration).toContain('SET "result_json" = NULL, "error_message" = NULL');
    expect(migration).toContain('"latest_remaining"');
  });
});
