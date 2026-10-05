import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { createConnection } from 'mongoose';
import { BusApiMetricService } from '../src/bus-api-metric/bus-api-metric.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;
  let configService: ConfigService;

  beforeAll(async () => {
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
    app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true }));
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

  it('실제 AppModule 종료는 Mongo 연결이 닫히기 전에 현재 minute를 저장한다', async () => {
    const at = new Date();
    const bucketStart = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    const metrics = app.get(BusApiMetricService);
    metrics.recordRequest(at);
    metrics.recordError(at);
    await app.close();

    const observer = await createConnection(mongoServer.getUri()).asPromise();
    try {
      const saved = await observer.db
        .collection('bus_api_metrics')
        .findOne({ bucketStart });
      expect(saved).toMatchObject({
        bucketStart,
        requestCount: 1,
        errorCount: 1,
      });
    } finally {
      await observer.close();
    }
  });
});
