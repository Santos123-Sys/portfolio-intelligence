import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/security.yml', 'utf8');
const lines = workflow.split('\n');

/**
 * Branch protection identifies a required status check by its job name, not by
 * the workflow file. Nothing in GitHub warns you when the two drift: rename the
 * job and the rule either blocks forever on a check that never reports, or stops
 * matching and lets merges through with no gate at all. These assertions exist so
 * that drift fails here, where it is visible, instead of in the repository
 * settings, where it is not.
 */
describe('the merge gate', () => {
  it('keeps the job name that branch protection requires', () => {
    expect(lines).toContain('  verify:');
  });

  it('runs on pull requests and in the merge queue', () => {
    // A required check that never runs on merge_group blocks the queue forever.
    const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(triggers).toContain('pull_request:');
    expect(triggers).toContain('merge_group:');
  });

  it('still runs every gate the contributing guide promises', () => {
    for (const command of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run build']) {
      expect(workflow).toContain(`- run: ${command}`);
    }
    expect(workflow).toContain('npm audit --omit=dev --audit-level=moderate');
    expect(workflow).toContain('npm audit --audit-level=high');
  });
});
