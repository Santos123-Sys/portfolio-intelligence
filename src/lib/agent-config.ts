import { and, desc, eq } from 'drizzle-orm';
import {
  AgentCustomization,
  type AgentKind,
  type AgentTool,
} from '@portfolio-intelligence/agentic-contract';
import { db } from './db';
import { agentConfigurations } from './db/workflow-schema';

const DEFAULTS: Record<AgentKind, Omit<AgentCustomization, 'configVersion'>> = {
  thesis_extraction: {
    agentKind: 'thesis_extraction',
    name: 'Thesis extraction',
    scope: 'Extract only the investor-authored goals, portfolio mandates, constraints, exclusions, and explicit thresholds for human confirmation.',
    promptAddendum: '',
    enabledTools: ['thesis_document'],
  },
  market_research: {
    agentKind: 'market_research',
    name: 'Market researcher',
    scope: 'Shortlist listed common stocks from the provider-supplied markets that best align with the confirmed thesis.',
    promptAddendum: '',
    enabledTools: ['structured_universe', 'web_search'],
  },
  security_analysis: {
    agentKind: 'security_analysis',
    name: 'Financial analyst',
    scope: 'Analyze one human-approved security at a time using only the supplied evidence bundle and disclose every material gap.',
    promptAddendum: '',
    enabledTools: ['grounding_bundle'],
  },
  portfolio_synthesis: {
    agentKind: 'portfolio_synthesis',
    name: 'Portfolio synthesizer',
    scope: 'Synthesize validated security conclusions without changing scores, evidence, confidence, or thesis-breaker severity.',
    promptAddendum: '',
    enabledTools: ['grounding_bundle'],
  },
};

const ALLOWED_TOOLS: Record<AgentKind, AgentTool[]> = {
  thesis_extraction: ['thesis_document'],
  market_research: ['structured_universe', 'web_search'],
  security_analysis: ['grounding_bundle'],
  portfolio_synthesis: ['grounding_bundle'],
};

export function defaultAgentCustomization(kind: AgentKind): AgentCustomization {
  return AgentCustomization.parse({ ...DEFAULTS[kind], configVersion: 1 });
}

export function validateAgentTools(kind: AgentKind, tools: AgentTool[]): void {
  const allowed = new Set(ALLOWED_TOOLS[kind]);
  const invalid = tools.filter((tool) => !allowed.has(tool));
  if (invalid.length) throw new Error(`${kind} cannot use these tools: ${invalid.join(', ')}`);
  if (kind === 'market_research' && !tools.includes('structured_universe')) {
    throw new Error('Market research must keep the structured_universe tool enabled');
  }
  if (kind !== 'market_research' && tools.length === 0) {
    throw new Error(`${kind} must keep its grounding tool enabled`);
  }
}

export async function getActiveAgentCustomization(ownerId: string, kind: AgentKind): Promise<AgentCustomization> {
  const [row] = await db.select().from(agentConfigurations).where(and(
    eq(agentConfigurations.ownerId, ownerId),
    eq(agentConfigurations.agentKind, kind),
    eq(agentConfigurations.active, true)
  )).orderBy(desc(agentConfigurations.versionNumber)).limit(1);
  if (!row) return defaultAgentCustomization(kind);
  const parsed = AgentCustomization.parse({
    agentKind: row.agentKind,
    configVersion: row.versionNumber,
    name: row.name,
    scope: row.scope,
    promptAddendum: row.promptAddendum,
    enabledTools: row.enabledTools,
  });
  validateAgentTools(parsed.agentKind, parsed.enabledTools);
  return parsed;
}

export function allowedToolsFor(kind: AgentKind): AgentTool[] {
  return [...ALLOWED_TOOLS[kind]];
}
