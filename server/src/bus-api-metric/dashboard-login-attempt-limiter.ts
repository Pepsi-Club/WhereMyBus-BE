const DEFAULT_MAX_TRACKED_IPS = 10_000;

export class DashboardLoginAttemptLimiter {
  private readonly attemptsByIp = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMilliseconds: number,
    private readonly maxTrackedIps = DEFAULT_MAX_TRACKED_IPS,
  ) {}

  hasReachedLimit(ip: string, now: Date): boolean {
    this.removeExpiredAttempts(now);
    return (this.attemptsByIp.get(ip)?.length ?? 0) >= this.maxAttempts;
  }

  recordFailure(ip: string, now: Date): void {
    this.removeExpiredAttempts(now);
    if (!this.attemptsByIp.has(ip)) {
      this.makeRoomForNewIp();
    }
    const attempts = this.attemptsByIp.get(ip) ?? [];
    attempts.push(now.getTime());
    this.attemptsByIp.set(ip, attempts);
  }

  reset(ip: string): void {
    this.attemptsByIp.delete(ip);
  }

  private removeExpiredAttempts(now: Date): void {
    const cutoff = now.getTime() - this.windowMilliseconds;
    for (const [ip, attempts] of this.attemptsByIp) {
      const activeAttempts = attempts.filter((attempt) => attempt > cutoff);
      if (activeAttempts.length === 0) {
        this.attemptsByIp.delete(ip);
      } else {
        this.attemptsByIp.set(ip, activeAttempts);
      }
    }
  }

  private makeRoomForNewIp(): void {
    if (this.attemptsByIp.size < this.maxTrackedIps) {
      return;
    }
    const oldestIp = this.attemptsByIp.keys().next().value;
    if (oldestIp !== undefined) {
      this.attemptsByIp.delete(oldestIp);
    }
  }
}
