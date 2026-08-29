import { startDiscoveryRunForOwner } from './discovery-workflow';

export type ThesisDiscoveryTransition =
  | { status: 'started' | 'existing'; runId: string; runStatus: string }
  | { status: 'blocked'; errorMessage: string };

type DiscoveryStarter = (input: {
  ownerId: string;
  thesisVersionId: string;
  maxCandidatesPerPortfolio: number;
  reuseExistingForThesis: boolean;
}) => Promise<{ run: { id: string; status: string }; reused: boolean }>;

/**
 * Crosses the human-confirmation gate into market research. Confirmation is
 * already durable when this runs, so a provider/configuration failure is
 * returned as an explicit recoverable state rather than undoing the thesis.
 */
export async function startDiscoveryAfterThesisConfirmation(
  input: { ownerId: string; thesisVersionId: string },
  start: DiscoveryStarter = startDiscoveryRunForOwner
): Promise<ThesisDiscoveryTransition> {
  try {
    const started = await start({
      ownerId: input.ownerId,
      thesisVersionId: input.thesisVersionId,
      maxCandidatesPerPortfolio: 8,
      reuseExistingForThesis: true,
    });
    return {
      status: started.reused ? 'existing' : 'started',
      runId: started.run.id,
      runStatus: started.run.status,
    };
  } catch (error) {
    return {
      status: 'blocked',
      errorMessage: error instanceof Error ? error.message : 'Market research could not be started',
    };
  }
}
