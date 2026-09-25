import { unzipSync } from 'fflate';
import type { InvestorRelationsFundamentals } from './investor-relations';

const METRIC_CODES: Record<string, Record<string, string>> = {
  DRE: { '3.01': 'revenue', '3.03': 'gross_profit', '3.05': 'operating_income', '3.11': 'net_income' },
  DFC_MI: { '6.01': 'operating_cash_flow' },
  DFC_MD: { '6.01': 'operating_cash_flow' },
  BPA: { '1.01.01': 'cash_and_equivalents' },
  BPP: { '2.03': 'total_equity' },
};
const FILES = ['DRE', 'DFC_MI', 'DFC_MD', 'BPA', 'BPP'] as const;
const archiveUrl = (year: number) => `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_${year}.zip`;

function splitCsv(line: string): string[] {
  const output: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ';' && !quoted) { output.push(value); value = ''; }
    else value += char;
  }
  output.push(value);
  return output;
}
function normalized(value: string) { return value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function sameIssuer(expected: string, filed: string) {
  const words = normalized(expected).split(' ').filter((word) => word.length >= 4 && !['HOLDING', 'HOLDINGS', 'COMPANHIA', 'GROUP', 'BRASIL'].includes(word));
  return words.some((word) => normalized(filed).split(' ').includes(word));
}
function rowsForCnpj(bytes: Uint8Array, cnpj: string) {
  const lines = new TextDecoder('latin1').decode(bytes).split(/\r?\n/);
  const headers = splitCsv(lines.shift() ?? '').map((item) => item.replace(/^\uFEFF/, '').trim());
  const indexes = Object.fromEntries(headers.map((key, index) => [key, index]));
  if (!['CNPJ_CIA', 'DENOM_CIA', 'DT_REFER', 'DT_FIM_EXERC', 'VERSAO', 'GRUPO_DFP', 'MOEDA', 'ESCALA_MOEDA', 'ORDEM_EXERC', 'CD_CONTA', 'VL_CONTA'].every((key) => key in indexes)) return [];
  const candidates = lines.filter((line) => line.includes(cnpj) || line.replace(/\D/g, '').includes(cnpj));
  return candidates.map((line) => {
    const cells = splitCsv(line);
    return Object.fromEntries(headers.map((key) => [key, cells[indexes[key]] ?? ''])) as Record<string, string>;
  }).filter((row) => row.CNPJ_CIA.replace(/\D/g, '') === cnpj);
}

/** Annual consolidated DFP facts only; no guesswork for issuer, account, scale or revision. */
export function extractCvmDfpArchive(archive: Uint8Array, year: number, cnpj: string, companyName: string): InvestorRelationsFundamentals | null {
  const digits = cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(digits) || year < 2020 || year > new Date().getUTCFullYear()) return null;
  const files = unzipSync(archive, { filter: (file) => FILES.some((kind) =>
    file.name.toUpperCase().endsWith(`_${kind}_CON_${year}.CSV`) && file.originalSize <= 35_000_000) });
  const candidates: Array<{ metric: string; value: number; end: string; version: number; issuer: string }> = [];
  for (const [name, bytes] of Object.entries(files)) {
    const kind = FILES.find((item) => name.toUpperCase().endsWith(`_${item}_CON_${year}.CSV`));
    if (!kind) continue;
    for (const row of rowsForCnpj(bytes, digits)) {
      const metric = METRIC_CODES[kind][row.CD_CONTA];
      const end = row.DT_FIM_EXERC;
      if (!metric || !sameIssuer(companyName, row.DENOM_CIA) || !/^DF CONSOLIDADO/i.test(normalized(row.GRUPO_DFP))
        || normalized(row.ORDEM_EXERC) !== 'ULTIMO' || normalized(row.MOEDA) !== 'REAL'
        || row.DT_REFER !== end || !end.startsWith(String(year))) continue;
      const scale = normalized(row.ESCALA_MOEDA) === 'MIL' ? 1000 : normalized(row.ESCALA_MOEDA) === 'UNIDADE' ? 1 : null;
      const raw = Number(row.VL_CONTA.replace(',', '.'));
      const version = Number(row.VERSAO);
      if (scale == null || !Number.isFinite(raw) || !Number.isSafeInteger(raw * scale) || !Number.isSafeInteger(version)) continue;
      candidates.push({ metric, value: raw * scale, end, version, issuer: row.DENOM_CIA });
    }
  }
  const end = [...new Set(candidates.map((item) => item.end))].sort().at(-1);
  if (!end) return null;
  const selected = candidates.filter((item) => item.end === end);
  const version = Math.max(...selected.map((item) => item.version));
  const facts = selected.filter((item) => item.version === version);
  const fundamentals: Record<string, number> = {};
  const conflicts = new Set<string>();
  for (const item of facts) {
    if (fundamentals[item.metric] != null && fundamentals[item.metric] !== item.value) conflicts.add(item.metric);
    else fundamentals[item.metric] = item.value;
  }
  for (const metric of conflicts) delete fundamentals[metric];
  if (!Object.keys(fundamentals).length) return null;
  return { fundamentals, currency: 'BRL', periodEnd: end, sourceUrl: archiveUrl(year),
    sourceName: `CVM DFP · ${facts[0].issuer} · version ${version}`,
    evidenceSnippet: `Consolidated CVM annual DFP for CNPJ ${digits}, fiscal period ${end}, filing revision ${version}; amounts converted from the reported scale to BRL. Confirm account meanings before valuation.`,
  };
}

export async function retrieveCvmDfp(companyName: string, cnpj: string, year: number) {
  if (year < 2020 || year > new Date().getUTCFullYear()) throw new Error('Unsupported DFP year');
  const response = await fetch(archiveUrl(year), { signal: AbortSignal.timeout(25_000), redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`CVM DFP returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 20_000_000) throw new Error('CVM archive exceeds 20 MB');
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.byteLength > 20_000_000) throw new Error('CVM archive exceeds 20 MB');
  return extractCvmDfpArchive(archive, year, cnpj, companyName);
}
