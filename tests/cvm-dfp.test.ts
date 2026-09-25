import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { extractCvmDfpArchive } from '../src/lib/cvm-dfp';

const header = 'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA';
const row = (code: string, value: string, version = 2, cnpj = '12.345.678/0001-90') => [cnpj, '2025-12-31', version, 'EMPRESA EXEMPLO S.A.', '123456', 'DF Consolidado - Demonstração do Resultado', 'REAL', 'MIL', 'ÚLTIMO', '2025-12-31', code, 'Conta', value, 'S'].join(';');
const csv = (rows: string[]) => new Uint8Array(Buffer.from([header, ...rows].join('\n'), 'latin1'));
const archive = zipSync({ 'dfp_cia_aberta_DRE_con_2025.csv': csv([row('3.01', '100,5', 1), row('3.01', '120,5'), row('3.05', '24'), row('3.11', '12')]) });

describe('CVM DFP consolidated import', () => {
  it('requires exact CNPJ, issuer and latest revision, converting thousands to BRL', () => {
    const filing = extractCvmDfpArchive(archive, 2025, '12345678000190', 'Empresa Exemplo SA');
    expect(filing?.fundamentals).toMatchObject({ revenue: 120500, operating_income: 24000, net_income: 12000 });
    expect(filing?.periodEnd).toBe('2025-12-31');
    expect(filing?.currency).toBe('BRL');
  });
  it('rejects another issuer CNPJ and absent consolidated evidence', () => {
    expect(extractCvmDfpArchive(archive, 2025, '00000000000191', 'Empresa Exemplo SA')).toBeNull();
    expect(extractCvmDfpArchive(archive, 2025, '12345678000190', 'Outra Companhia')).toBeNull();
  });
});
