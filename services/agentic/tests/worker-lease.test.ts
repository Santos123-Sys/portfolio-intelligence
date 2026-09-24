import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepJobLeaseAlive } from '../src/worker-lease.js';
import { MemoryRepository } from './memory-repository.js';

afterEach(() => vi.useRealTimers());

describe('long-running job lease', () => {
  it('renews an owned job before expiry and stops renewing after completion', async () => {
    vi.useFakeTimers();
    const renewLease = vi.fn(async () => true);
    const onRenewed = vi.fn();
    const lease = keepJobLeaseAlive({ renewLease }, 'job-1', 'worker-1', 30, onRenewed);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(renewLease).toHaveBeenCalledTimes(7);
    expect(renewLease).toHaveBeenCalledWith('job-1', 'worker-1', 30);
    expect(onRenewed).toHaveBeenCalledTimes(7);
    await lease.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renewLease).toHaveBeenCalledTimes(7);
  });

  it('stops when another worker owns the job', async () => {
    vi.useFakeTimers();
    const renewLease = vi.fn(async () => false);
    const lease = keepJobLeaseAlive({ renewLease }, 'job-1', 'worker-1', 30, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewLease).toHaveBeenCalledTimes(1);
    expect(lease.lost).toBe(true);
    await lease.stop();
  });

  it('rejects a completion from a superseded claim', async () => {
    const repository = new MemoryRepository();
    const queued = await repository.create('market_discovery', 'run-1', {}, 1);
    const claim = (await repository.claimNext('worker-1', 30))!;
    const firstAttempt = claim.attemptCount;
    queued.attemptCount += 1;
    await expect(repository.completeDiscovery(claim.id, {} as never, firstAttempt))
      .rejects.toThrow('Job claim is no longer current');
    expect(queued.status).toBe('running');
  });
});
