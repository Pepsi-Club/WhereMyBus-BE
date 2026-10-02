import { DashboardLoginAttemptLimiter } from './dashboard-login-attempt-limiter';

describe('DashboardLoginAttemptLimiter', () => {
  const second = 1_000;

  it('다른 IP를 확인할 때도 만료된 실패 기록을 제거한다', () => {
    const limiter = new DashboardLoginAttemptLimiter(1, 10 * second, 2);

    limiter.recordFailure('active-ip', new Date(5 * second));
    limiter.recordFailure('expired-ip', new Date(0));
    limiter.recordFailure('new-ip', new Date(11 * second));

    expect(limiter.hasReachedLimit('active-ip', new Date(11 * second))).toBe(
      true,
    );
    expect(limiter.hasReachedLimit('new-ip', new Date(11 * second))).toBe(true);
  });

  it('보관 IP 상한을 넘으면 가장 오래 추적한 IP를 제거한다', () => {
    const limiter = new DashboardLoginAttemptLimiter(1, 10 * second, 2);
    const now = new Date(0);

    limiter.recordFailure('oldest-ip', now);
    limiter.recordFailure('second-ip', now);
    limiter.recordFailure('new-ip', now);

    expect(limiter.hasReachedLimit('oldest-ip', now)).toBe(false);
    expect(limiter.hasReachedLimit('second-ip', now)).toBe(true);
    expect(limiter.hasReachedLimit('new-ip', now)).toBe(true);
  });
});
