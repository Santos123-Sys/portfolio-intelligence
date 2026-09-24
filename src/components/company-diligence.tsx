'use client';

import { useLanguage, type Language } from '@/lib/i18n';

type Framework = {
  marketContext: string[];
  sectorDrivers: string[];
  companyDrivers: string[];
};

const copy = {
  en: {
    title: 'Company diligence: what is still needed?',
    intro: 'A research checklist after discovery. Context is a lead, not a verified financial or sector conclusion.',
    context: 'Context available', missing: 'Evidence needed',
    demand: 'Demand and operating capacity',
    demandContext: 'Market and company context is recorded. Verify orders, volume, backlog, utilization and customer concentration against dated company disclosures.',
    demandGap: 'Find dated company disclosures for demand, volume, capacity and utilization; record what is unavailable.',
    financial: 'Historical financial performance',
    financialContext: 'Structured fundamentals are supplied. Compare consistent annual periods for revenue, margins, cash flow and leverage; check restatements and units.',
    financialGap: 'Structured statements are not supplied to this research run. Obtain dated annual filings before claiming historical trends or financial strength.',
    benchmark: 'Sector index comparison',
    benchmarkGap: 'No verified sector-index return series is supplied. Select a documented benchmark for the same market, currency, dates and dividend treatment before comparing performance.',
    chain: 'Value chain and pricing power',
    chainContext: 'Company activities are described. Verify key suppliers, customers, dependencies, substitutes and pricing power in primary disclosures.',
    chainGap: 'Map the company’s products, suppliers, customers and economic dependencies from primary disclosures.',
    sources: 'Discovery sources to inspect', sourceCaveat: 'These links support the initial shortlist; check each source and date before using it for a diligence conclusion.',
  },
  pt: {
    title: 'Análise da empresa: o que falta?', intro: 'Lista de verificação após a descoberta. O contexto é uma pista, não uma conclusão financeira ou setorial comprovada.',
    context: 'Contexto disponível', missing: 'Faltam evidências', demand: 'Demanda e capacidade operacional',
    demandContext: 'Há contexto de mercado e da empresa. Confira pedidos, volumes, carteira de encomendas, utilização da capacidade e concentração de clientes em documentos datados.',
    demandGap: 'Busque documentos datados sobre demanda, volumes, capacidade e utilização; registre dados indisponíveis.',
    financial: 'Histórico financeiro', financialContext: 'Há dados financeiros estruturados. Compare períodos anuais consistentes para receita, margens, caixa e dívida; confira revisões e unidades.',
    financialGap: 'Esta pesquisa não recebeu demonstrações financeiras estruturadas. Consulte balanços anuais antes de afirmar tendências ou solidez financeira.',
    benchmark: 'Comparação com índice setorial', benchmarkGap: 'Não há série verificada de retorno de índice setorial. Escolha um índice documentado com mercado, moeda, datas e tratamento de dividendos compatíveis.',
    chain: 'Cadeia de valor e poder de precificação', chainContext: 'As atividades da empresa foram descritas. Verifique fornecedores, clientes, dependências, substitutos e poder de precificação em fontes primárias.',
    chainGap: 'Mapeie produtos, fornecedores, clientes e dependências econômicas com base em documentos primários.',
    sources: 'Fontes da descoberta para consulta', sourceCaveat: 'Estas fontes embasaram a lista inicial; confira a fonte e sua data antes de usá-la em uma conclusão.',
  },
  es: {
    title: 'Análisis de la empresa: ¿qué falta?', intro: 'Lista de verificación tras el descubrimiento. El contexto es una pista, no una conclusión financiera o sectorial comprobada.',
    context: 'Contexto disponible', missing: 'Falta evidencia', demand: 'Demanda y capacidad operativa',
    demandContext: 'Hay contexto del mercado y la empresa. Comprueba pedidos, volúmenes, cartera, utilización y concentración de clientes en documentos fechados.',
    demandGap: 'Busca documentos fechados sobre demanda, volúmenes, capacidad y utilización; registra los datos ausentes.',
    financial: 'Historial financiero', financialContext: 'Hay datos financieros estructurados. Compara ejercicios consistentes de ingresos, márgenes, caja y deuda; verifica revisiones y unidades.',
    financialGap: 'Esta investigación no recibió estados financieros estructurados. Consulta informes anuales antes de afirmar tendencias o solidez financiera.',
    benchmark: 'Comparación con índice sectorial', benchmarkGap: 'No hay una serie verificada de rentabilidad sectorial. Elige un índice documentado con mercado, moneda, fechas y tratamiento de dividendos compatibles.',
    chain: 'Cadena de valor y poder de fijación de precios', chainContext: 'Se describen las actividades de la empresa. Verifica proveedores, clientes, dependencias, sustitutos y poder de fijación de precios en fuentes primarias.',
    chainGap: 'Identifica productos, proveedores, clientes y dependencias económicas con documentos primarios.',
    sources: 'Fuentes iniciales para consultar', sourceCaveat: 'Estas fuentes respaldan la selección inicial; comprueba cada fuente y fecha antes de concluir.',
  },
  de: {
    title: 'Unternehmensprüfung: Was fehlt noch?', intro: 'Checkliste nach der Suche. Kontext ist ein Ansatz, kein bestätigter Finanz- oder Branchenbefund.',
    context: 'Kontext vorhanden', missing: 'Belege fehlen', demand: 'Nachfrage und Produktionskapazität',
    demandContext: 'Markt- und Unternehmenskontext ist erfasst. Prüfen Sie Aufträge, Mengen, Auftragsbestand, Auslastung und Kundenkonzentration anhand datierter Berichte.',
    demandGap: 'Suchen Sie datierte Berichte zu Nachfrage, Mengen, Kapazität und Auslastung; halten Sie fehlende Daten fest.',
    financial: 'Historische Finanzentwicklung', financialContext: 'Strukturierte Finanzdaten liegen vor. Vergleichen Sie einheitliche Geschäftsjahre für Umsatz, Margen, Cashflow und Verschuldung; prüfen Sie Korrekturen und Einheiten.',
    financialGap: 'Für diesen Lauf liegen keine strukturierten Abschlüsse vor. Prüfen Sie Jahresberichte, bevor Sie Trends oder Finanzstärke behaupten.',
    benchmark: 'Vergleich mit Branchenindex', benchmarkGap: 'Eine verifizierte Branchenindexreihe liegt nicht vor. Wählen Sie einen dokumentierten Index mit passendem Markt, Währung, Zeitraum und Dividendenbehandlung.',
    chain: 'Wertschöpfungskette und Preissetzungsmacht', chainContext: 'Die Geschäftstätigkeit ist beschrieben. Prüfen Sie Lieferanten, Kunden, Abhängigkeiten, Ersatzprodukte und Preissetzungsmacht anhand von Primärquellen.',
    chainGap: 'Erfassen Sie Produkte, Lieferanten, Kunden und wirtschaftliche Abhängigkeiten anhand von Primärquellen.',
    sources: 'Quellen der ersten Suche', sourceCaveat: 'Diese Quellen stützen die Vorauswahl. Prüfen Sie Quelle und Datum, bevor Sie daraus Schlüsse ziehen.',
  },
} satisfies Record<Language, Record<string, string>>;

export function CompanyDiligence({ framework, analysisMode, sourceUrls }: {
  framework: Framework;
  analysisMode: 'full_fundamentals' | 'limited_research_risk' | null;
  sourceUrls: string[];
}) {
  const { language } = useLanguage();
  const t = copy[language];
  const hasDemandContext = framework.marketContext.length > 0 || framework.sectorDrivers.length > 0;
  const hasCompanyContext = framework.companyDrivers.length > 0;
  const topics = [
    { title: t.demand, context: hasDemandContext && hasCompanyContext, detail: hasDemandContext && hasCompanyContext ? t.demandContext : t.demandGap },
    { title: t.financial, context: analysisMode === 'full_fundamentals', detail: analysisMode === 'full_fundamentals' ? t.financialContext : t.financialGap },
    { title: t.benchmark, context: false, detail: t.benchmarkGap },
    { title: t.chain, context: hasCompanyContext, detail: hasCompanyContext ? t.chainContext : t.chainGap },
  ];

  return <section className="research-framework company-diligence" aria-label={t.title}>
    <h4>{t.title}</h4>
    <p className="note">{t.intro}</p>
    <div className="research-framework-grid">
      {topics.map((topic) => <div key={topic.title}>
        <strong>{topic.title}</strong> <span className={`badge ${topic.context ? 'watch' : 'breach'}`}>{topic.context ? t.context : t.missing}</span>
        <p>{topic.detail}</p>
      </div>)}
    </div>
    {sourceUrls.length > 0 && <p className="note"><strong>{t.sources}:</strong> {sourceUrls.filter((url) => /^https?:\/\//.test(url)).map((url, index) => <span key={url}>{index ? ' · ' : ' '}<a href={url} target="_blank" rel="noreferrer">{index + 1}</a></span>)}. {t.sourceCaveat}</p>}
  </section>;
}
