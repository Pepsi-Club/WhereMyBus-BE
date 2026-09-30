import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const DASHBOARD_SESSION_COOKIE = 'wmb_dashboard_session';

interface SessionPayload {
  exp: number;
}

const DEFAULT_SESSION_TTL_SECONDS = 28_800;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 900;
const MIN_ACCESS_CODE_LENGTH = 12;
const MIN_SESSION_SECRET_LENGTH = 32;

@Injectable()
export class DashboardAuthService {
  private readonly failedAttempts = new Map<string, number[]>();

  constructor(private readonly configService: ConfigService) {}

  authenticate(code: string, ip: string, now = new Date()): void {
    this.assertEnabled();
    const attempts = this.activeAttempts(ip, now);
    if (attempts.length >= this.loginMaxAttempts) {
      throw new HttpException(
        'Too many authentication attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      !this.configurationIsValid() ||
      !this.safeEqual(code, this.accessCode)
    ) {
      attempts.push(now.getTime());
      this.failedAttempts.set(ip, attempts);
      throw this.authenticationFailed();
    }

    this.failedAttempts.delete(ip);
  }

  createSession(now = new Date()): string {
    this.assertEnabled();
    if (!this.configurationIsValid()) {
      throw this.authenticationFailed();
    }

    const payload: SessionPayload = {
      exp: Math.floor(now.getTime() / 1000) + this.sessionTtlSeconds,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  verifySession(token: string, now = new Date()): boolean {
    if (!this.isEnabled() || !this.configurationIsValid()) {
      return false;
    }

    try {
      const [encodedPayload, signature, extraPart] = token.split('.');
      if (!encodedPayload || !signature || extraPart) {
        return false;
      }
      if (!this.safeEqual(signature, this.sign(encodedPayload))) {
        return false;
      }

      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SessionPayload;
      return (
        typeof payload.exp === 'number' &&
        Number.isFinite(payload.exp) &&
        payload.exp > Math.floor(now.getTime() / 1000)
      );
    } catch (error) {
      return false;
    }
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new NotFoundException();
    }
  }

  get sessionTtlSeconds(): number {
    return this.positiveInteger(
      'DASHBOARD_SESSION_TTL_SECONDS',
      DEFAULT_SESSION_TTL_SECONDS,
    );
  }

  private get accessCode(): string {
    return this.configService.get<string>('DASHBOARD_ACCESS_CODE', '');
  }

  private get sessionSecret(): string {
    return this.configService.get<string>('DASHBOARD_SESSION_SECRET', '');
  }

  private get loginMaxAttempts(): number {
    return this.positiveInteger(
      'DASHBOARD_LOGIN_MAX_ATTEMPTS',
      DEFAULT_LOGIN_MAX_ATTEMPTS,
    );
  }

  private get loginWindowSeconds(): number {
    return this.positiveInteger(
      'DASHBOARD_LOGIN_WINDOW_SECONDS',
      DEFAULT_LOGIN_WINDOW_SECONDS,
    );
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('DASHBOARD_ENABLED') === 'true';
  }

  private configurationIsValid(): boolean {
    return (
      this.accessCode.length >= MIN_ACCESS_CODE_LENGTH &&
      this.sessionSecret.length >= MIN_SESSION_SECRET_LENGTH &&
      this.accessCode !== this.sessionSecret
    );
  }

  private activeAttempts(ip: string, now: Date): number[] {
    const cutoff = now.getTime() - this.loginWindowSeconds * 1000;
    const attempts = (this.failedAttempts.get(ip) ?? []).filter(
      (attempt) => attempt > cutoff,
    );
    if (attempts.length === 0) {
      this.failedAttempts.delete(ip);
    } else {
      this.failedAttempts.set(ip, attempts);
    }
    return attempts;
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.sessionSecret)
      .update(encodedPayload)
      .digest('base64url');
  }

  private safeEqual(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  }

  private positiveInteger(key: string, fallback: number): number {
    const configured = Number(this.configService.get<string>(key));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : fallback;
  }

  private authenticationFailed(): UnauthorizedException {
    return new UnauthorizedException('Dashboard authentication failed');
  }
}
