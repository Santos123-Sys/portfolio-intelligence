import { describe, expect, it } from 'vitest';
import { canDismissThesisExtraction } from '../src/lib/thesis-extraction-lifecycle';

describe('thesis extraction lifecycle', () => {
  it.each(['queued', 'running', 'completed', 'failed'])('allows %s extractions to be dismissed', (status) => {
    expect(canDismissThesisExtraction(status)).toBe(true);
  });

  it('rejects unknown states by default', () => {
    expect(canDismissThesisExtraction('cancelled')).toBe(false);
  });
});
