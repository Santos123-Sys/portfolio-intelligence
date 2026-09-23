'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'pt' | 'es' | 'de';

const translations = {
  en: {
    'nav.howItWorks': 'How it works',
    'nav.thesis': '1. Thesis',
    'nav.discover': '2. Discover',
    'nav.portfolio': '3. Portfolio',
    'nav.researchHistory': 'Research history',
    'nav.aiFeed': 'AI Feed',
    'nav.decisionLog': 'Decision Log',
    'nav.candidateRecords': 'Candidate records',
    'nav.portfolioReview': 'Portfolio Review',
    'nav.investmentReview': 'Investment Review',
    'nav.settings': 'Settings',
    'nav.agentSettings': 'Agent settings',
    'nav.securities': 'Securities',
    'nav.accountSecurity': 'Account Security',
    'nav.more': 'More',
    'actions.toggleTheme': 'Toggle theme',
    'actions.dark': 'Dark',
    'actions.light': 'Light',
    'actions.signingOut': 'Signing out…',
    'actions.retrySignOut': 'Retry sign out',
    'actions.signOut': 'Sign out',
    'account.activeClient': 'Active client account',
    'language.label': 'Language',
    'portfolio.viewing': 'Viewing',
    'portfolio.noneSelected': 'No portfolio selected',
    'brand.tagline': 'Thesis-driven investment management',
    'actions.menu': 'Menu',
    'actions.close': 'Close',
  },
  pt: {
    'nav.howItWorks': 'Como funciona',
    'nav.thesis': '1. Tese',
    'nav.discover': '2. Descobrir',
    'nav.portfolio': '3. Portfólio',
    'nav.researchHistory': 'Histórico de pesquisas',
    'nav.aiFeed': 'Feed de IA',
    'nav.decisionLog': 'Registro de decisões',
    'nav.candidateRecords': 'Ativos candidatos',
    'nav.portfolioReview': 'Revisão do portfólio',
    'nav.investmentReview': 'Revisão de investimentos',
    'nav.settings': 'Configurações',
    'nav.agentSettings': 'Configurações dos agentes',
    'nav.securities': 'Ativos',
    'nav.accountSecurity': 'Segurança da conta',
    'nav.more': 'Mais',
    'actions.toggleTheme': 'Alternar tema',
    'actions.dark': 'Escuro',
    'actions.light': 'Claro',
    'actions.signingOut': 'Saindo…',
    'actions.retrySignOut': 'Tentar sair novamente',
    'actions.signOut': 'Sair',
    'account.activeClient': 'Conta de cliente ativa',
    'language.label': 'Idioma',
    'portfolio.viewing': 'Visualizando',
    'portfolio.noneSelected': 'Nenhum portfólio selecionado',
    'brand.tagline': 'Gestão de investimentos orientada por tese',
    'actions.menu': 'Menu',
    'actions.close': 'Fechar',
  },
  es: {
    'nav.howItWorks': 'Cómo funciona',
    'nav.thesis': '1. Tesis',
    'nav.discover': '2. Descubrir',
    'nav.portfolio': '3. Cartera',
    'nav.researchHistory': 'Historial de análisis',
    'nav.aiFeed': 'Feed de IA',
    'nav.decisionLog': 'Registro de decisiones',
    'nav.candidateRecords': 'Activos candidatos',
    'nav.portfolioReview': 'Revisión de la cartera',
    'nav.investmentReview': 'Revisión de inversiones',
    'nav.settings': 'Configuración',
    'nav.agentSettings': 'Configuración de agentes',
    'nav.securities': 'Valores',
    'nav.accountSecurity': 'Seguridad de la cuenta',
    'nav.more': 'Más',
    'actions.toggleTheme': 'Cambiar tema',
    'actions.dark': 'Oscuro',
    'actions.light': 'Claro',
    'actions.signingOut': 'Cerrando sesión…',
    'actions.retrySignOut': 'Reintentar cierre',
    'actions.signOut': 'Cerrar sesión',
    'account.activeClient': 'Cuenta de cliente activa',
    'language.label': 'Idioma',
    'portfolio.viewing': 'Viendo',
    'portfolio.noneSelected': 'Ninguna cartera seleccionada',
    'brand.tagline': 'Gestión de inversiones basada en tesis',
    'actions.menu': 'Menú',
    'actions.close': 'Cerrar',
  },
  de: {
    'nav.howItWorks': 'So funktioniert es',
    'nav.thesis': '1. These',
    'nav.discover': '2. Entdecken',
    'nav.portfolio': '3. Portfolio',
    'nav.researchHistory': 'Research-Verlauf',
    'nav.aiFeed': 'KI-Feed',
    'nav.decisionLog': 'Entscheidungsprotokoll',
    'nav.candidateRecords': 'Anlagekandidaten',
    'nav.portfolioReview': 'Portfolioüberprüfung',
    'nav.investmentReview': 'Anlageprüfung',
    'nav.settings': 'Einstellungen',
    'nav.agentSettings': 'Agenten-Einstellungen',
    'nav.securities': 'Wertpapiere',
    'nav.accountSecurity': 'Kontosicherheit',
    'nav.more': 'Mehr',
    'actions.toggleTheme': 'Darstellung wechseln',
    'actions.dark': 'Dunkel',
    'actions.light': 'Hell',
    'actions.signingOut': 'Abmeldung läuft…',
    'actions.retrySignOut': 'Abmeldung wiederholen',
    'actions.signOut': 'Abmelden',
    'account.activeClient': 'Aktives Kundenkonto',
    'language.label': 'Sprache',
    'portfolio.viewing': 'Ansicht',
    'portfolio.noneSelected': 'Kein Portfolio ausgewählt',
    'brand.tagline': 'Thesenbasierte Vermögensverwaltung',
    'actions.menu': 'Menü',
    'actions.close': 'Schließen',
  },
} as const;



/**
 * Static page copy predates the language selector.  Keeping this dictionary at
 * the app shell means pages can be translated while their server/client data
 * and calculations remain untouched.  Values not in the dictionary are left
 * unchanged deliberately: company names, identifiers, evidence and user data
 * must never be machine-rewritten by a UI locale switch.
 */
const pageTranslations: Record<Language, Record<string, string>> = {
  en: {},
  de: {
    'How Portfolio Intelligence works': 'So funktioniert Portfolio Intelligence',
    'A human-led investment research workflow. The system organizes evidence and calculations; it does not make investment decisions for you.': 'Ein von Menschen geführter Investment-Research-Workflow. Das System ordnet Belege und Berechnungen; Anlageentscheidungen treffen Sie selbst.',
    'Investment thesis': 'Anlagethese', 'Market research': 'Marktrecherche', 'Research and risk': 'Research und Risiko', 'DCF and comparables': 'DCF und Vergleichsunternehmen', 'Portfolio': 'Portfolio',
    'Open thesis': 'These öffnen', 'Open discovery': 'Entdeckung öffnen', 'Open research history': 'Research-Verlauf öffnen', 'Open valuation workspace': 'Bewertungsbereich öffnen', 'Open positions': 'Positionen öffnen',
    'Define': 'Definieren', 'Discover': 'Entdecken', 'Analyze': 'Analysieren', 'Value': 'Bewerten', 'Own and monitor': 'Halten und überwachen',
    'Upload or create the mandate, then confirm the extracted criteria. The thesis determines what the research system is allowed to screen for.': 'Laden Sie das Mandat hoch oder erstellen Sie es und bestätigen Sie dann die extrahierten Kriterien. Die These bestimmt, wonach das Research-System suchen darf.',
    'Build a provider-backed universe, apply mandate filters, and review only the candidates returned by that specific run. Approving a candidate starts research; it does not add a holding.': 'Erstellen Sie ein datenquellengestütztes Anlageuniversum, wenden Sie Mandatsfilter an und prüfen Sie nur Kandidaten dieses Laufs. Die Freigabe startet Research; sie fügt keine Position hinzu.',
    'Review catalysts, risks, information gaps, price-risk metrics, and the professional research report. Evidence gaps remain visible rather than becoming assumptions.': 'Prüfen Sie Katalysatoren, Risiken, Informationslücken, Preisrisikokennzahlen und den Research-Bericht. Beleglücken bleiben sichtbar und werden nicht zu Annahmen.',
    'Retrieve primary-source financials, confirm DCF scenario inputs, and compare a reviewed peer group. Comparable data is sourced where available; peer selection remains your responsibility.': 'Rufen Sie Primärquellen-Finanzdaten ab, bestätigen Sie DCF-Szenarioannahmen und vergleichen Sie eine geprüfte Peer-Gruppe. Vergleichsdaten werden, soweit verfügbar, belegt; die Peer-Auswahl bleibt Ihre Verantwortung.',
    'Add positions only after your decision. Portfolio risk appears once holdings and sufficient market history exist; it is separate from candidate-level research risk.': 'Fügen Sie Positionen erst nach Ihrer Entscheidung hinzu. Portfoliorisiko erscheint, sobald Positionen und ausreichende Markthistorie vorliegen; es ist vom Research-Risiko einzelner Kandidaten getrennt.',
    'Loading…': 'Wird geladen…', 'Loading...': 'Wird geladen…', 'Save': 'Speichern', 'Cancel': 'Abbrechen', 'Close': 'Schließen', 'Back': 'Zurück', 'Continue': 'Weiter', 'Retry': 'Erneut versuchen', 'Refresh': 'Aktualisieren', 'Delete': 'Löschen', 'Edit': 'Bearbeiten', 'Create': 'Erstellen', 'Download': 'Herunterladen', 'Print': 'Drucken', 'Search': 'Suchen', 'Filter': 'Filtern', 'All': 'Alle', 'None': 'Keine', 'Status': 'Status', 'Actions': 'Aktionen', 'Details': 'Details', 'Source': 'Quelle', 'Sources': 'Quellen', 'Error': 'Fehler', 'Success': 'Erfolgreich', 'No data available.': 'Keine Daten verfügbar.',
    'Investment Review': 'Anlageprüfung', 'Decision Log': 'Entscheidungsprotokoll', 'Candidate records': 'Anlagekandidaten', 'Agent Settings': 'Agenten-Einstellungen', 'Account Security': 'Kontosicherheit', 'Research history': 'Research-Verlauf', 'AI Feed': 'KI-Feed', 'Securities': 'Wertpapiere',
    'Generate': 'Erstellen', 'Generate PDF': 'PDF erstellen', 'Upload': 'Hochladen', 'Choose file': 'Datei auswählen', 'Submit': 'Absenden', 'Confirm': 'Bestätigen', 'Approve': 'Freigeben', 'Reject': 'Ablehnen', 'Add position': 'Position hinzufügen', 'Portfolio setup': 'Portfolioeinrichtung', 'Risk': 'Risiko', 'Allocation': 'Allokation', 'Governance': 'Governance',
  },
  pt: {
    'How Portfolio Intelligence works': 'Como o Portfolio Intelligence funciona',
    'A human-led investment research workflow. The system organizes evidence and calculations; it does not make investment decisions for you.': 'Um fluxo de pesquisa de investimentos conduzido por pessoas. O sistema organiza evidências e cálculos; ele não toma decisões de investimento por você.',
    'Investment thesis': 'Tese de investimento', 'Market research': 'Pesquisa de mercado', 'Research and risk': 'Pesquisa e risco', 'DCF and comparables': 'DCF e comparáveis', 'Portfolio': 'Portfólio',
    'Open thesis': 'Abrir tese', 'Open discovery': 'Abrir descoberta', 'Open research history': 'Abrir histórico de pesquisas', 'Open valuation workspace': 'Abrir área de avaliação', 'Open positions': 'Abrir posições',
    'Define': 'Definir', 'Discover': 'Descobrir', 'Analyze': 'Analisar', 'Value': 'Avaliar', 'Own and monitor': 'Manter e monitorar',
    'Loading…': 'Carregando…', 'Loading...': 'Carregando…', 'Save': 'Salvar', 'Cancel': 'Cancelar', 'Close': 'Fechar', 'Back': 'Voltar', 'Continue': 'Continuar', 'Retry': 'Tentar novamente', 'Refresh': 'Atualizar', 'Delete': 'Excluir', 'Edit': 'Editar', 'Create': 'Criar', 'Download': 'Baixar', 'Print': 'Imprimir', 'Search': 'Pesquisar', 'Filter': 'Filtrar', 'All': 'Todos', 'None': 'Nenhum', 'Status': 'Status', 'Actions': 'Ações', 'Details': 'Detalhes', 'Source': 'Fonte', 'Sources': 'Fontes', 'Error': 'Erro', 'Success': 'Sucesso', 'No data available.': 'Não há dados disponíveis.',
    'Investment Review': 'Revisão de investimentos', 'Decision Log': 'Registro de decisões', 'Candidate records': 'Ativos candidatos', 'Agent Settings': 'Configurações dos agentes', 'Account Security': 'Segurança da conta', 'Research history': 'Histórico de pesquisas', 'AI Feed': 'Feed de IA', 'Securities': 'Ativos',
    'Generate': 'Gerar', 'Generate PDF': 'Gerar PDF', 'Upload': 'Enviar', 'Choose file': 'Escolher arquivo', 'Submit': 'Enviar', 'Confirm': 'Confirmar', 'Approve': 'Aprovar', 'Reject': 'Rejeitar', 'Add position': 'Adicionar posição', 'Portfolio setup': 'Configuração do portfólio', 'Risk': 'Risco', 'Allocation': 'Alocação', 'Governance': 'Governança',
  },
  es: {
    'How Portfolio Intelligence works': 'Cómo funciona Portfolio Intelligence',
    'A human-led investment research workflow. The system organizes evidence and calculations; it does not make investment decisions for you.': 'Un flujo de investigación de inversiones dirigido por personas. El sistema organiza evidencia y cálculos; no toma decisiones de inversión por usted.',
    'Investment thesis': 'Tesis de inversión', 'Market research': 'Investigación de mercado', 'Research and risk': 'Investigación y riesgo', 'DCF and comparables': 'DCF y comparables', 'Portfolio': 'Cartera',
    'Open thesis': 'Abrir tesis', 'Open discovery': 'Abrir descubrimiento', 'Open research history': 'Abrir historial de análisis', 'Open valuation workspace': 'Abrir área de valoración', 'Open positions': 'Abrir posiciones',
    'Define': 'Definir', 'Discover': 'Descubrir', 'Analyze': 'Analizar', 'Value': 'Valorar', 'Own and monitor': 'Mantener y supervisar',
    'Loading…': 'Cargando…', 'Loading...': 'Cargando…', 'Save': 'Guardar', 'Cancel': 'Cancelar', 'Close': 'Cerrar', 'Back': 'Volver', 'Continue': 'Continuar', 'Retry': 'Reintentar', 'Refresh': 'Actualizar', 'Delete': 'Eliminar', 'Edit': 'Editar', 'Create': 'Crear', 'Download': 'Descargar', 'Print': 'Imprimir', 'Search': 'Buscar', 'Filter': 'Filtrar', 'All': 'Todos', 'None': 'Ninguno', 'Status': 'Estado', 'Actions': 'Acciones', 'Details': 'Detalles', 'Source': 'Fuente', 'Sources': 'Fuentes', 'Error': 'Error', 'Success': 'Correcto', 'No data available.': 'No hay datos disponibles.',
    'Investment Review': 'Revisión de inversiones', 'Decision Log': 'Registro de decisiones', 'Candidate records': 'Activos candidatos', 'Agent Settings': 'Configuración de agentes', 'Account Security': 'Seguridad de la cuenta', 'Research history': 'Historial de análisis', 'AI Feed': 'Feed de IA', 'Securities': 'Valores',
    'Generate': 'Generar', 'Generate PDF': 'Generar PDF', 'Upload': 'Subir', 'Choose file': 'Elegir archivo', 'Submit': 'Enviar', 'Confirm': 'Confirmar', 'Approve': 'Aprobar', 'Reject': 'Rechazar', 'Add position': 'Añadir posición', 'Portfolio setup': 'Configuración de cartera', 'Risk': 'Riesgo', 'Allocation': 'Asignación', 'Governance': 'Gobernanza',
  },
};

const translatedToSource = new Map<string, string>();
for (const entries of Object.values(pageTranslations)) {
  for (const [source, translated] of Object.entries(entries)) translatedToSource.set(translated, source);
}

function translatedPageText(language: Language, value: string): string {
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  if (!match) return value;
  const [, leading, raw, trailing] = match;
  const source = translatedToSource.get(raw) ?? raw;
  return `${leading}${pageTranslations[language][source] ?? source}${trailing}`;
}

/** Applies locale copy to static UI nodes outside components that have not yet adopted `t()`. */
export function LocalizedPageContent() {
  const { language } = useLanguage();

  useEffect(() => {
    const root = document.querySelector('.content');
    if (!root) return;
    const apply = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
        const next = translatedPageText(language, node.nodeValue ?? '');
        if (next !== node.nodeValue) node.nodeValue = next;
      }
      for (const element of root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]')) {
        for (const attribute of ['placeholder', 'title', 'aria-label']) {
          const value = element.getAttribute(attribute);
          if (value) element.setAttribute(attribute, translatedPageText(language, value));
        }
      }
    };
    apply();
    const observer = new MutationObserver(() => window.requestAnimationFrame(apply));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);
  return null;
}

export type TranslationKey = keyof typeof translations.en;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = 'portfolio-intelligence-language';

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'pt' || value === 'es' || value === 'de';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const browserLanguage = window.navigator.language.slice(0, 2);
    const initial = isLanguage(stored) ? stored : isLanguage(browserLanguage) ? browserLanguage : 'en';
    setLanguageState(initial);
    document.documentElement.lang = initial;
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    document.documentElement.lang = next;
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key) => translations[language][key],
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
