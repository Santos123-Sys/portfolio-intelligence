const DISMISSIBLE_EXTRACTION_STATUSES = new Set(['queued', 'running', 'completed', 'failed']);

export function canDismissThesisExtraction(status: string): boolean {
  return DISMISSIBLE_EXTRACTION_STATUSES.has(status);
}
