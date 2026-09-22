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
  },
} as const;

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
