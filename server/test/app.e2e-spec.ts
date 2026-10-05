import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { createConnection } from 'mongoose';
import { BusApiMetricService } from '../src/bus-api-metric/bus-api-metric.service';
import { SEOUL_BUS_ARRIVAL_METRIC } from '../src/bus-api-metric/bus-api-metric.dimension';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;
  let configService: ConfigService;
  const originalCwd = process.cwd();

  beforeAll(async () => {
    // AppModule resolves dotenv paths relative to cwd; isolate local secrets.
    process.chdir(mkdtempSync(join(tmpdir(), 'wmb-dashboard-e2e-')));
    mongoServer = await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1' },
    });
    process.env.NODE_ENV = 'test';
    process.env.MONGO = mongoServer.getUri();
    process.env.DASHBOARD_ENABLED = 'true';
    process.env.DASHBOARD_ACCESS_CODE = 'developer-code-1234';
    process.env.DASHBOARD_SESSION_SECRET = '0123456789abcdef0123456789abcdef';

    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    configService = app.get(ConfigService);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await mongoServer?.stop();
    }
    delete process.env.MONGO;
    delete process.env.DASHBOARD_ENABLED;
    delete process.env.DASHBOARD_ACCESS_CODE;
    delete process.env.DASHBOARD_SESSION_SECRET;
    process.chdir(originalCwd);
  });

  it('/ (GET)은 기존 응답을 유지한다', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('인증 없는 Dashboard metrics 요청은 401이다', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/metrics?range=24h')
      .expect(401);
  });

  it('Dashboard가 비활성화되면 auth endpoint는 404다', async () => {
    configService.set('DASHBOARD_ENABLED', 'false');
    await request(app.getHttpServer())
      .post('/api/dashboard/auth')
      .send({ code: 'developer-code-1234' })
      .expect(404);
    configService.set('DASHBOARD_ENABLED', 'true');
  });

  it('실제 catalog와 분류별 metrics HTTP 계약을 유지한다', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/metric-dimensions')
      .expect(401);
    const auth = await request(app.getHttpServer())
      .post('/api/dashboard/auth')
      .send({ code: 'developer-code-1234' })
      .expect(201);
    const cookie = String(auth.headers['set-cookie']).split(';')[0];

    await request(app.getHttpServer())
      .get('/api/dashboard/metric-dimensions')
      .set('Cookie', cookie)
      .expect(200)
      .expect({
        providers: [
          {
            key: 'seoul-bus',
            label: '서울 버스',
            operations: [{ key: 'bus-arrival', label: '버스 도착 정보' }],
          },
        ],
      });

    const now = new Date();
    const at = new Date(now.getTime() - 60_000);
    const metrics = app.get(BusApiMetricService);
    metrics.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, at);
    metrics.recordError(SEOUL_BUS_ARRIVAL_METRIC, at);
    await metrics.flushCompletedBuckets(now);

    const response = await request(app.getHttpServer())
      .get(
        '/api/dashboard/metrics?range=24h&providers=%20seoul-bus%20,seoul-bus&operations=bus-arrival,bus-arrival',
      )
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.filters).toEqual({
      providers: ['seoul-bus'],
      operations: ['bus-arrival'],
    });
    expect(response.body.summary).toMatchObject({
      rangeRequests: 1,
      rangeErrors: 1,
      errorRate: 1,
    });
    const point = response.body.series.find(
      (point) => point.requestCount === 1,
    );
    expect(point).toMatchObject({ requestCount: 1, errorCount: 1 });
    expect(point.start).toMatch(/\+09:00$/);
    const seoulDay = new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
    expect(point.weekday).toBe(seoulDay || 7);

    for (const query of [
      'providers=unknown',
      'operations=',
      'weekdays=1,3',
      'unexpected=value',
    ]) {
      await request(app.getHttpServer())
        .get(`/api/dashboard/metrics?range=24h&${query}`)
        .set('Cookie', cookie)
        .expect(400);
    }
  });

  it('실제 AppModule 종료는 Mongo 연결이 닫히기 전에 현재 minute를 저장한다', async () => {
    const at = new Date();
    const bucketStart = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    const metrics = app.get(BusApiMetricService);
    metrics.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, at);
    metrics.recordError(SEOUL_BUS_ARRIVAL_METRIC, at);
    await app.close();

    const observer = await createConnection(mongoServer.getUri()).asPromise();
    try {
      const saved = await observer.db.collection('bus_api_metrics').findOne({
        bucketStart,
        provider: 'seoul-bus',
        operation: 'bus-arrival',
      });
      expect(saved).toMatchObject({
        bucketStart,
        provider: 'seoul-bus',
        operation: 'bus-arrival',
        requestCount: 1,
        errorCount: 1,
      });
    } finally {
      await observer.close();
    }
  });
});
