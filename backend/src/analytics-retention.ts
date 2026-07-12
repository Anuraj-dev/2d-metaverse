export const ANALYTICS_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface RetentionLogger {
  info: (details: Record<string, unknown>, message: string) => void;
  warn: (details: Record<string, unknown>, message: string) => void;
}

export interface AnalyticsRetentionJob {
  stop: () => void;
}

export function startAnalyticsRetentionJob(
  log: RetentionLogger,
  options: {
    prune: () => Promise<number>;
    intervalMs?: number;
  },
): AnalyticsRetentionJob {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const deleted = await options.prune();
      if (deleted > 0) log.info({ deleted }, "expired analytics pruned");
    } catch (error) {
      log.warn({ err: error }, "analytics retention prune failed");
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? ANALYTICS_RETENTION_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
