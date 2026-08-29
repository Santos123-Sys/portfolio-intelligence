import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AgentKind, AgentTool } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { allowedToolsFor, getActiveAgentCustomization, validateAgentTools } from '@/lib/agent-config';
import { db } from '@/lib/db';
import { agentConfigurations } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';

const updateSchema = z.object({
  agentKind: AgentKind,
  name: z.string().trim().min(1).max(120),
  scope: z.string().trim().min(1).max(2_000),
  promptAddendum: z.string().trim().max(4_000),
  enabledTools: z.array(AgentTool).max(4),
}).strict();

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const kinds = AgentKind.options;
  const configurations = await Promise.all(kinds.map(async (kind) => ({
    ...(await getActiveAgentCustomization(session.auth.userId, kind)),
    allowedTools: allowedToolsFor(kind),
  })));
  return NextResponse.json({
    configurations,
    immutablePolicy: 'Owner instructions are appended below service safety rules. Grounding, calculation, ownership and no-trading rules cannot be disabled.',
  });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    validateAgentTools(parsed.data.agentKind, parsed.data.enabledTools);
    const saved = await db.transaction(async (tx) => {
      const [latest] = await tx.select({ versionNumber: agentConfigurations.versionNumber })
        .from(agentConfigurations)
        .where(and(
          eq(agentConfigurations.ownerId, session.auth.userId),
          eq(agentConfigurations.agentKind, parsed.data.agentKind)
        ))
        .orderBy(desc(agentConfigurations.versionNumber))
        .limit(1);
      await tx.update(agentConfigurations).set({ active: false }).where(and(
        eq(agentConfigurations.ownerId, session.auth.userId),
        eq(agentConfigurations.agentKind, parsed.data.agentKind),
        eq(agentConfigurations.active, true)
      ));
      const [row] = await tx.insert(agentConfigurations).values({
        ownerId: session.auth.userId,
        agentKind: parsed.data.agentKind,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        name: parsed.data.name,
        scope: parsed.data.scope,
        promptAddendum: parsed.data.promptAddendum,
        enabledTools: parsed.data.enabledTools,
        active: true,
      }).returning();
      return row;
    });
    return NextResponse.json({ configuration: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
