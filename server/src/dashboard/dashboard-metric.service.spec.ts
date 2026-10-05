import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import {
  BusApiMetric,
  BusApiMetricSchema,
} from '../bus-api-metric/bus-api-metric.schema';
import {
  BusApiMetricRepository,
  StoredMetricBucket,
} from '../bus-api-metric/bus-api-metric.repository';
import { DashboardMetricService } from './dashboard-metric.service';

describe('DashboardMetricService', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let model: Model<BusApiMetric>;
  let service: DashboardMetricService;

  const metric = (
    bucketStart: string,
    instanceId: string,
    requestCount: number,
    errorCount: number,
  ): StoredMetricBucket => ({
    bucketStart: new Date(bucketStart),
    instanceId,
    requestCount,
    errorCount,
    expiresAt: new Date('2027-11-04T00:00:00.000Z'),
  });

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1' },
    });
    connection = await createConnection(mongoServer.getUri()).asPromise();
    model = connection.model(BusApiMetric.name, BusApiMetricSchema);
    service = new DashboardMetricService(new BusApiMetricRepository(model));
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await connection.close();
    await mongoServer.stop();
  });

  it('UTC 15:00를 서울 날짜 경계로 사용하고 instance 값을 합산한다', async () => {
    await model.create([
      metric('2026-09-29T14:59:00.000Z', '0', 100, 0),
      metric('2026-09-29T15:00:00.000Z', '0', 3, 1),
      metric('2026-09-29T15:00:00.000Z', '1', 5, 0),
    ]);

    const result = await service.getMetrics(
      '24h',
      new Date('2026-09-30T01:00:00.000Z'),
    );

    expect(result.summary.todayRequests).toBe(8);
    expect(result.summary.rangeRequests).toBe(108);
    expect(
      result.series.find(({ start }) => start === '2026-09-30T00:00:00+09:00'),
    ).toMatchObject({ requestCount: 8, errorCount: 1 });
  });

  it('데이터가 없으면 0 summary와 빈 series를 반환한다', async () => {
    await expect(
      service.getMetrics('30d', new Date('2026-09-30T01:00:00.000Z')),
    ).resolves.toEqual({
      range: '30d',
      timezone: 'Asia/Seoul',
      summary: {
        todayRequests: 0,
        monthRequests: 0,
        rangeRequests: 0,
        rangeErrors: 0,
        errorRate: 0,
        lastCollectedAt: null,
      },
      series: [],
    });
  });

  it.each([
    ['24h', 1],
    ['7d', 2],
    ['30d', 3],
    ['90d', 4],
  ] as const)(
    '%s rolling 기간 밖의 값은 합계에서 제외한다',
    async (range, count) => {
      const now = new Date('2026-09-30T12:00:00.000Z');
      await model.create([
        metric('2026-09-29T13:00:00.000Z', '0', 1, 0),
        metric('2026-09-29T11:00:00.000Z', '0', 1, 0),
        metric('2026-09-22T11:00:00.000Z', '0', 1, 0),
        metric('2026-08-30T11:00:00.000Z', '0', 1, 0),
        metric('2026-06-30T11:00:00.000Z', '0', 100, 0),
      ]);

      const result = await service.getMetrics(range, now);

      expect(result.summary.rangeRequests).toBe(count);
    },
  );

  it('7d는 시간 단위, 30d는 일 단위로 series를 묶는다', async () => {
    await model.create([
      metric('2026-09-29T01:00:00.000Z', '0', 2, 0),
      metric('2026-09-29T02:00:00.000Z', '0', 3, 0),
    ]);
    const now = new Date('2026-09-30T01:00:00.000Z');

    expect((await service.getMetrics('7d', now)).series).toHaveLength(2);
    expect((await service.getMetrics('30d', now)).series).toEqual([
      {
        start: '2026-09-29T00:00:00+09:00',
        requestCount: 5,
        errorCount: 0,
      },
    ]);
  });

  it('errorRate는 선택 기간 오류를 요청으로 나눈 값이다', async () => {
    await model.create([
      metric('2026-09-30T00:00:00.000Z', '0', 8, 2),
      metric('2026-09-30T00:01:00.000Z', '1', 2, 1),
    ]);

    const result = await service.getMetrics(
      '24h',
      new Date('2026-09-30T01:00:00.000Z'),
    );

    expect(result.summary.errorRate).toBe(0.3);
  });
});
