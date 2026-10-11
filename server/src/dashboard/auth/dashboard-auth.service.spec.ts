import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardLoginAttemptLimiter } from './dashboard-login-attempt-limiter';

describe('DashboardAuthService', () => {
  const enabledConfig = (overrides: Record<string, string> = {}) =>
    new ConfigService({
      DASHBOARD_ENABLED: 'true',
      DASHBOARD_ACCESS_CODE: 'developer-code-1234',
      DASHBOARD_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      DASHBOARD_SESSION_TTL_SECONDS: '28800',
      DASHBOARD_LOGIN_MAX_ATTEMPTS: '5',
      DASHBOARD_LOGIN_WINDOW_SECONDS: '900',
      ...overrides,
    });

  const createAuth = (configService = enabledConfig()) =>
    new DashboardAuthService(
      configService,
      new DashboardLoginAttemptLimiter(configService),
    );

  it('주입된 limiter로 로그인 실패를 확인하고 기록한다', () => {
    const configService = enabledConfig();
    const limiter = {
      hasReachedLimit: jest.fn().mockReturnValue(false),
      recordFailure: jest.fn(),
      reset: jest.fn(),
    } as unknown as DashboardLoginAttemptLimiter;
    const service = new DashboardAuthService(configService, limiter);

    expect(() =>
      service.authenticate('wrong-code', '127.0.0.1', new Date(0)),
    ).toThrow('Dashboard authentication failed');

    expect(limiter.hasReachedLimit).toHaveBeenCalledWith(
      '127.0.0.1',
      new Date(0),
    );
    expect(limiter.recordFailure).toHaveBeenCalledWith(
      '127.0.0.1',
      new Date(0),
    );
  });

  it('올바른 코드로 만든 session을 TTL 안에서 검증한다', () => {
    const auth = createAuth();
    auth.authenticate('developer-code-1234', '127.0.0.1');
    const token = auth.createSession(new Date('2026-09-30T00:00:00.000Z'));

    expect(
      auth.verifySession(token, new Date('2026-09-30T07:59:59.000Z')),
    ).toBe(true);
  });

  it('변조되거나 만료된 session을 거부한다', () => {
    const auth = createAuth();
    const token = auth.createSession(new Date('2026-09-30T00:00:00.000Z'));

    expect(
      auth.verifySession(`${token}x`, new Date('2026-09-30T00:00:01.000Z')),
    ).toBe(false);
    expect(
      auth.verifySession(token, new Date('2026-09-30T08:00:00.000Z')),
    ).toBe(false);
  });

  it('malformed session을 예외 없이 거부한다', () => {
    const auth = createAuth();

    expect(auth.verifySession('not-a-session')).toBe(false);
    expect(auth.verifySession('e30.invalid-signature')).toBe(false);
  });

  it('같은 IP의 6번째 실패를 429로 막는다', () => {
    const auth = createAuth();
    const now = new Date('2026-09-30T00:00:00.000Z');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() =>
        auth.authenticate('wrong-code', '203.0.113.10', now),
      ).toThrow(UnauthorizedException);
    }

    try {
      auth.authenticate('wrong-code', '203.0.113.10', now);
      throw new Error('expected rate limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('로그인 성공하면 해당 IP 실패 횟수를 초기화한다', () => {
    const auth = createAuth();
    const now = new Date('2026-09-30T00:00:00.000Z');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(() =>
        auth.authenticate('wrong-code', '203.0.113.10', now),
      ).toThrow(UnauthorizedException);
    }

    expect(() =>
      auth.authenticate('developer-code-1234', '203.0.113.10', now),
    ).not.toThrow();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() =>
        auth.authenticate('wrong-code', '203.0.113.10', now),
      ).toThrow(UnauthorizedException);
    }
  });

  it('로그인 제한 window가 지나면 실패 횟수를 제거한다', () => {
    const auth = createAuth();
    const first = new Date('2026-09-30T00:00:00.000Z');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() =>
        auth.authenticate('wrong-code', '203.0.113.10', first),
      ).toThrow(UnauthorizedException);
    }

    expect(() =>
      auth.authenticate(
        'wrong-code',
        '203.0.113.10',
        new Date('2026-09-30T00:15:01.000Z'),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('비활성 Dashboard는 존재하지 않는 endpoint처럼 거부한다', () => {
    const auth = createAuth(enabledConfig({ DASHBOARD_ENABLED: 'false' }));

    expect(() => auth.authenticate('developer-code-1234', '127.0.0.1')).toThrow(
      NotFoundException,
    );
  });

  it.each([
    { DASHBOARD_ACCESS_CODE: '' },
    { DASHBOARD_SESSION_SECRET: '' },
    {
      DASHBOARD_ACCESS_CODE: 'same-value-that-is-long-enough-1234',
      DASHBOARD_SESSION_SECRET: 'same-value-that-is-long-enough-1234',
    },
  ])('잘못된 설정은 코드 오류와 같은 응답으로 거부한다', (overrides) => {
    const auth = createAuth(enabledConfig(overrides));

    expect(() => auth.authenticate('submitted-secret', '127.0.0.1')).toThrow(
      new UnauthorizedException('Dashboard authentication failed'),
    );
  });

  it('인증 실패 메시지에 제출한 코드를 포함하지 않는다', () => {
    const auth = createAuth();
    const submittedCode = 'do-not-leak-this-code';

    try {
      auth.authenticate(submittedCode, '127.0.0.1');
      throw new Error('expected authentication failure');
    } catch (error) {
      expect((error as Error).message).not.toContain(submittedCode);
    }
  });
});
