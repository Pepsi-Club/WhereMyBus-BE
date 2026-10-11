import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 900;
const DEFAULT_MAX_TRACKED_IPS = 10_000;

@Injectable()
export class DashboardLoginAttemptLimiter {
  private readonly attemptsByIp = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMilliseconds: number;
  private readonly maxTrackedIps = DEFAULT_MAX_TRACKED_IPS;

  constructor(configService: ConfigService) {
    this.maxAttempts = this.positiveInteger(
      configService.get<string>('DASHBOARD_LOGIN_MAX_ATTEMPTS'),
      DEFAULT_LOGIN_MAX_ATTEMPTS,
    );
    this.windowMilliseconds =
      this.positiveInteger(
        configService.get<string>('DASHBOARD_LOGIN_WINDOW_SECONDS'),
        DEFAULT_LOGIN_WINDOW_SECONDS,
      ) * 1_000;
  }

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

  private positiveInteger(value: string | undefined, fallback: number): number {
    const configured = Number(value);
    return Number.isInteger(configured) && configured > 0
      ? configured
      : fallback;
  }
}
