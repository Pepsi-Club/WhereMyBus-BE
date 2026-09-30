import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthService,
} from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';

describe('DashboardAuthGuard', () => {
  const config = (enabled = 'true') =>
    new ConfigService({
      DASHBOARD_ENABLED: enabled,
      DASHBOARD_ACCESS_CODE: 'developer-code-1234',
      DASHBOARD_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      DASHBOARD_SESSION_TTL_SECONDS: '28800',
    });

  const contextWithCookie = (cookie?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { cookie } }),
      }),
    } as ExecutionContext);

  it('서명된 session cookie를 허용한다', () => {
    const auth = new DashboardAuthService(config());
    const guard = new DashboardAuthGuard(auth);
    const token = auth.createSession();

    expect(
      guard.canActivate(
        contextWithCookie(
          `unrelated=one; ${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(
            token,
          )}`,
        ),
      ),
    ).toBe(true);
  });

  it('cookie가 없거나 변조됐으면 401을 반환한다', () => {
    const auth = new DashboardAuthService(config());
    const guard = new DashboardAuthGuard(auth);

    expect(() => guard.canActivate(contextWithCookie())).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(
        contextWithCookie(`${DASHBOARD_SESSION_COOKIE}=tampered`),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('비활성 Dashboard는 404를 반환한다', () => {
    const guard = new DashboardAuthGuard(
      new DashboardAuthService(config('false')),
    );

    expect(() => guard.canActivate(contextWithCookie())).toThrow(
      NotFoundException,
    );
  });
});
