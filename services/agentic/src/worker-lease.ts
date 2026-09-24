import type { JobRepository } from './types.js';

/** Renew an owned job while external calls run. An expired or stolen lease is never revived. */
export function keepJobLeaseAlive(
  repository: Pick<JobRepository, 'renewLease'>,
  jobId: string,
  workerId: string,
  leaseSeconds: number,
  onRenewed: () => void
) {
  const intervalMs = Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3));
  let stopped = false;
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  const schedule = () => {
    if (!stopped && !lost) timer = setTimeout(() => { pending = renew(); }, intervalMs);
  };
  const renew = async () => {
    try {
      if (!await repository.renewLease(jobId, workerId, leaseSeconds)) lost = true;
      else onRenewed();
    } catch {
      // A transient database error can recover on the next tick. The lease
      // itself is the authority; a later renewal will fail if it expired.
    } finally {
      schedule();
    }
  };
  schedule();
  return {
    get lost() { return lost; },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await pending;
    },
  };
}
