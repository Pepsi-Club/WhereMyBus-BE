import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardAuthModule } from './auth/dashboard-auth.module';
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthService,
} from './auth/dashboard-auth.service';
import { DashboardMetricService } from './dashboard-metric.service';

describe('DashboardController', () => {
  let app: INestApplication;
  let authService: DashboardAuthService;
  const metricResponse = {
    range: '24h',
    timezone: 'Asia/Seoul',
    summary: {
      todayRequests: 3,
      monthRequests: 10,
      rangeRequests: 3,
      rangeErrors: 1,
      errorRate: 1 / 3,
      lastCollectedAt: '2026-09-30T00:00:00.000Z',
    },
    series: [],
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              DASHBOARD_ENABLED: 'true',
              DASHBOARD_ACCESS_CODE: 'developer-code-1234',
              DASHBOARD_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
              DASHBOARD_SESSION_TTL_SECONDS: '28800',
              DASHBOARD_LOGIN_MAX_ATTEMPTS: '5',
              DASHBOARD_LOGIN_WINDOW_SECONDS: '900',
            }),
          ],
        }),
        DashboardAuthModule,
      ],
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardMetricService,
          useValue: { getMetrics: async () => metricResponse },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    authService = module.get(DashboardAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  const sessionCookie = () =>
    `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(
      authService.createSession(),
    )}`;

  it('인증되지 않은 metrics 요청을 거부한다', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/metrics?range=24h')
      .expect(401);
  });

  it('올바른 코드로 보안 속성이 적용된 cookie를 발급한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/dashboard/auth')
      .send({ code: 'developer-code-1234' })
      .expect(201)
      .expect({ authenticated: true });

    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/dashboard');
    expect(cookie).toContain('Max-Age=28800');
  });

  it('인증 session과 허용 range로 metrics를 반환한다', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/session')
      .set('Cookie', sessionCookie())
      .expect(200)
      .expect({ authenticated: true });

    const response = await request(app.getHttpServer())
      .get('/api/dashboard/metrics?range=24h')
      .set('Cookie', sessionCookie())
      .expect(200);

    expect(response.body).toEqual(metricResponse);
    expect(JSON.stringify(response.body)).not.toContain('developer-code-1234');
    expect(JSON.stringify(response.body)).not.toContain(
      '0123456789abcdef0123456789abcdef',
    );
  });

  it('허용하지 않은 range는 400을 반환한다', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/metrics?range=365d')
      .set('Cookie', sessionCookie())
      .expect(400);
  });

  it('logout은 Dashboard cookie를 즉시 만료한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/dashboard/logout')
      .set('Cookie', sessionCookie())
      .expect(201)
      .expect({ authenticated: false });

    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/api/dashboard');

    await request(app.getHttpServer())
      .get('/api/dashboard/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(401);
  });
});
