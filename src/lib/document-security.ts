import {
  MAX_THESIS_BASE64_CHARACTERS,
  MAX_THESIS_PDF_BYTES,
  MAX_THESIS_TEXT_BYTES,
} from '@portfolio-intelligence/agentic-contract';

export const MAX_PDF_BYTES = MAX_THESIS_PDF_BYTES;
export const MAX_TEXT_BYTES = MAX_THESIS_TEXT_BYTES;
export const MAX_ENCODED_DOCUMENT_CHARACTERS = MAX_THESIS_BASE64_CHARACTERS;

export type ThesisDocumentMimeType = 'application/pdf' | 'text/plain' | 'text/markdown';

export class DocumentValidationError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

function validateFileName(fileName: string): string {
  const normalized = fileName.trim().normalize('NFKC');
  if (!normalized || normalized.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(normalized)) {
    throw new DocumentValidationError('Document filename is invalid');
  }
  return normalized;
}

function decodeStrictBase64(value: string): Buffer {
  if (!value || value.length > MAX_ENCODED_DOCUMENT_CHARACTERS) {
    throw new DocumentValidationError('Thesis document exceeds the 10 MB limit', 413);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new DocumentValidationError('Document encoding is invalid');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) {
    throw new DocumentValidationError('Document encoding is invalid');
  }
  return bytes;
}

function validatePdf(bytes: Buffer): void {
  if (bytes.length > MAX_PDF_BYTES) {
    throw new DocumentValidationError('PDF documents must not exceed 10 MB', 413);
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new DocumentValidationError('Uploaded PDF does not have a valid PDF signature');
  }
  const trailer = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
  if (!trailer.includes('%%EOF')) {
    throw new DocumentValidationError('Uploaded PDF is incomplete');
  }
  const source = bytes.toString('latin1');
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|Encrypt)\b/i.test(source)) {
    throw new DocumentValidationError('Encrypted PDFs and PDFs containing active or embedded content are not accepted');
  }
}

function validateText(bytes: Buffer): void {
  if (bytes.length > MAX_TEXT_BYTES) {
    throw new DocumentValidationError('Text documents must not exceed 2 MB', 413);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentValidationError('Text documents must use valid UTF-8');
  }
  if (!text.trim() || text.includes('\u0000')) {
    throw new DocumentValidationError('Text document is empty or contains invalid null bytes');
  }
}

export function validateThesisDocument(input: {
  fileName: string;
  mimeType: ThesisDocumentMimeType;
  contentBase64: string;
}): { fileName: string; mimeType: ThesisDocumentMimeType; contentBase64: string; byteLength: number } {
  const fileName = validateFileName(input.fileName);
  const bytes = decodeStrictBase64(input.contentBase64);
  if (input.mimeType === 'application/pdf') validatePdf(bytes);
  else validateText(bytes);
  return {
    fileName,
    mimeType: input.mimeType,
    contentBase64: bytes.toString('base64'),
    byteLength: bytes.length,
  };
}
