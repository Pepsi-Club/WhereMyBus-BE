import {
  assertLocalMongoUri,
  buildDashboardDemoMetrics,
  replaceDashboardDemoMetrics,
} from './dashboard-metric-seed';

describe('dashboard metric seed', () => {
  it.each([
    'mongodb://localhost:27017/WhereMyBus',
    'mongodb://127.0.0.1:27017/WhereMyBus',
    'mongodb://[::1]:27017/WhereMyBus',
  ])('loopback MongoDB %s만 허용한다', (uri) => {
    expect(() => assertLocalMongoUri(uri)).not.toThrow();
  });

  it.each([
    '',
    'not-a-mongodb-uri',
    'mongodb://db.example.com/WhereMyBus',
    'mongodb+srv://cluster.example.com/WhereMyBus',
  ])('원격 또는 잘못된 MongoDB URI %p를 연결 전에 거부한다', (uri) => {
    expect(() => assertLocalMongoUri(uri)).toThrow(
      '로컬 MongoDB만 사용할 수 있습니다.',
    );
  });

  it('두 instance의 90일 hourly 문서를 결정적으로 생성한다', () => {
    const now = new Date('2026-10-06T06:00:00.000Z');
    const first = buildDashboardDemoMetrics(now);
    const second = buildDashboardDemoMetrics(now);

    expect(first).toHaveLength(90 * 24 * 2);
    expect(first).toEqual(second);
    expect(new Set(first.map(({ instanceId }) => instanceId))).toEqual(
      new Set(['dashboard-demo-1', 'dashboard-demo-2']),
    );
    expect(
      first.every(
        (metric) =>
          metric.provider === 'seoul-bus' &&
          metric.operation === 'bus-arrival' &&
          metric.requestCount >= metric.errorCount &&
          metric.errorCount >= 0 &&
          metric.bucketStart < now &&
          metric.expiresAt > now,
      ),
    ).toBe(true);
  });

  it('평일 출근 시간 요청은 심야와 주말 같은 시간보다 많다', () => {
    const metrics = buildDashboardDemoMetrics(
      new Date('2026-10-06T06:00:00.000Z'),
    );
    const requestsAt = (iso: string) =>
      metrics.find(
        ({ instanceId, bucketStart }) =>
          instanceId === 'dashboard-demo-1' &&
          bucketStart.toISOString() === iso,
      )?.requestCount ?? 0;

    const mondayCommute = requestsAt('2026-10-04T23:00:00.000Z');
    const mondayOvernight = requestsAt('2026-10-04T18:00:00.000Z');
    const sundayCommuteHour = requestsAt('2026-10-03T23:00:00.000Z');

    expect(mondayCommute).toBeGreaterThan(mondayOvernight);
    expect(mondayCommute).toBeGreaterThan(sundayCommuteHour);
  });

  it('기존 데이터는 건드리지 않고 demo prefix 문서만 교체한다', async () => {
    const documents = buildDashboardDemoMetrics(
      new Date('2026-10-06T06:00:00.000Z'),
    ).slice(0, 2);
    const collection = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }),
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 2 }),
    };

    await expect(
      replaceDashboardDemoMetrics(collection, documents),
    ).resolves.toBe(2);
    expect(collection.deleteMany).toHaveBeenCalledWith({
      instanceId: { $regex: '^dashboard-demo-' },
    });
    expect(collection.insertMany).toHaveBeenCalledWith(documents, {
      ordered: true,
    });
  });
});
