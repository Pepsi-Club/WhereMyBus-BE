import { ConfigService } from '@nestjs/config';
import { DashboardLoginAttemptLimiter } from './dashboard-login-attempt-limiter';

function createLimiter(maxAttempts = 1, windowSeconds = 10) {
  return new DashboardLoginAttemptLimiter(
    new ConfigService({
      DASHBOARD_LOGIN_MAX_ATTEMPTS: String(maxAttempts),
      DASHBOARD_LOGIN_WINDOW_SECONDS: String(windowSeconds),
    }),
  );
}

describe('DashboardLoginAttemptLimiter', () => {
  const second = 1_000;

  it('ConfigService에서 로그인 실패 제한을 읽는다', () => {
    const limiter = new DashboardLoginAttemptLimiter(
      new ConfigService({
        DASHBOARD_LOGIN_MAX_ATTEMPTS: '2',
        DASHBOARD_LOGIN_WINDOW_SECONDS: '10',
      }),
    );

    limiter.recordFailure('127.0.0.1', new Date(0));
    limiter.recordFailure('127.0.0.1', new Date(1));

    expect(limiter.hasReachedLimit('127.0.0.1', new Date(2))).toBe(true);
  });

  it('다른 IP를 확인할 때도 만료된 실패 기록을 제거한다', () => {
    const limiter = createLimiter();

    limiter.recordFailure('active-ip', new Date(5 * second));
    limiter.recordFailure('expired-ip', new Date(0));
    limiter.recordFailure('new-ip', new Date(11 * second));

    expect(limiter.hasReachedLimit('active-ip', new Date(11 * second))).toBe(
      true,
    );
    expect(limiter.hasReachedLimit('new-ip', new Date(11 * second))).toBe(true);
  });

  it('보관 IP 상한을 넘으면 가장 오래 추적한 IP를 제거한다', () => {
    const limiter = createLimiter();
    const now = new Date(0);

    limiter.recordFailure('oldest-ip', now);
    limiter.recordFailure('second-ip', now);
    for (let index = 0; index < 9_998; index += 1) {
      limiter.recordFailure(`tracked-ip-${index}`, now);
    }
    limiter.recordFailure('new-ip', now);

    expect(limiter.hasReachedLimit('oldest-ip', now)).toBe(false);
    expect(limiter.hasReachedLimit('second-ip', now)).toBe(true);
    expect(limiter.hasReachedLimit('new-ip', now)).toBe(true);
  });
});
