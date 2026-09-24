import { describe, expect, it } from 'vitest';
import { discoveryDate, discoveryText } from '../src/lib/discovery-translations';

describe('discovery workspace localization', () => {
  it('provides distinct action and evidence labels in each selected language', () => {
    expect(['en', 'pt', 'es', 'de'].map((language) =>
      discoveryText(language as 'en' | 'pt' | 'es' | 'de', 'approve')
    )).toEqual(['Approve & analyze', 'Aprovar e analisar', 'Aprobar y analizar', 'Freigeben und analysieren']);
    expect(discoveryText('pt', 'developing')).toContain('lacunas');
  });

  it('formats run timestamps in the selected locale', () => {
    expect(discoveryDate('de', '2026-09-23T11:00:00.000Z')).not.toBe(discoveryDate('en', '2026-09-23T11:00:00.000Z'));
  });
});
