import { createServer, type Server } from 'node:http';

export type WorkerState = 'starting' | 'idle' | 'processing';

export interface WorkerHeartbeat {
  state: WorkerState;
  /** Epoch milliseconds of the last completed poll of the job queue, or null before the first one. */
  lastPollAt: number | null;
  jobsProcessed: number;
}

export interface HealthBudgets {
  /**
   * How long an idle worker may go without completing a poll. The loop polls
   * every AGENTIC_WORKER_POLL_MS, so anything beyond a wide multiple of that
   * means the loop is wedged rather than merely slow.
   */
  idleBudgetMs: number;
  /**
   * How long a worker may stay inside a single job. Derived from the job lease:
   * past that point the queue already treats the claim as lost, so the process
   * holding it is not making progress either.
   */
  busyBudgetMs: number;
}

export interface HealthReport {
  healthy: boolean;
  status: 'ok' | 'starting' | 'stalled';
  detail: string;
  state: WorkerState;
  msSinceLastPoll: number | null;
  jobsProcessed: number;
}

/**
 * Decides whether the worker is alive, separately from serving that decision,
 * so the rule can be tested without opening a socket.
 *
 * This deliberately does not ping the database. The loop itself claims from the
 * queue on every iteration, so a fresh heartbeat is already proof that the
 * database is reachable; an extra ping would add load on the same pool the
 * worker needs and could fail the healthcheck for pool pressure alone.
 */
export function evaluateWorkerHealth(
  beat: WorkerHeartbeat,
  budgets: HealthBudgets,
  now: number = Date.now()
): HealthReport {
  const msSinceLastPoll = beat.lastPollAt === null ? null : Math.max(0, now - beat.lastPollAt);
  const common = {
    state: beat.state,
    msSinceLastPoll,
    jobsProcessed: beat.jobsProcessed,
  };

  if (beat.state === 'starting' || msSinceLastPoll === null) {
    return {
      ...common,
      healthy: false,
      status: 'starting',
      detail: 'Worker has not completed its first queue poll yet',
    };
  }

  const budget = beat.state === 'processing' ? budgets.busyBudgetMs : budgets.idleBudgetMs;
  if (msSinceLastPoll > budget) {
    return {
      ...common,
      healthy: false,
      status: 'stalled',
      detail:
        beat.state === 'processing'
          ? `Worker has been inside one job for ${Math.round(msSinceLastPoll / 1000)}s, beyond the ${Math.round(budget / 1000)}s job lease`
          : `Worker has not polled the queue for ${Math.round(msSinceLastPoll / 1000)}s, beyond the ${Math.round(budget / 1000)}s idle budget`,
    };
  }

  return { ...common, healthy: true, status: 'ok', detail: 'Worker is polling the job queue' };
}

export interface WorkerHealthServerOptions extends HealthBudgets {
  workerId: string;
  heartbeat: () => WorkerHeartbeat;
  now?: () => number;
}

/**
 * A liveness endpoint for the worker. Railway restarts on process exit, which
 * catches a crash but not a hang: without this, a wedged worker reports Online
 * forever while jobs queue behind it.
 */
export function createWorkerHealthServer(options: WorkerHealthServerOptions): Server {
  const clock = options.now ?? Date.now;
  return createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== '/health' || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ error: 'Not found' }));
      return;
    }

    const report = evaluateWorkerHealth(
      options.heartbeat(),
      { idleBudgetMs: options.idleBudgetMs, busyBudgetMs: options.busyBudgetMs },
      clock()
    );
    const data = Buffer.from(
      JSON.stringify({
        status: report.status,
        detail: report.detail,
        workerId: options.workerId,
        state: report.state,
        secondsSinceLastPoll:
          report.msSinceLastPoll === null ? null : Math.round(report.msSinceLastPoll / 1000),
        jobsProcessed: report.jobsProcessed,
      })
    );
    response.writeHead(report.healthy ? 200 : 503, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': data.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  });
}
