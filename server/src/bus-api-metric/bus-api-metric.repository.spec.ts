import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import { BusApiMetric, BusApiMetricSchema } from './bus-api-metric.schema';
import {
  BusApiMetricRepository,
  StoredMetricBucket,
} from './bus-api-metric.repository';

describe('BusApiMetricRepository', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let model: Model<BusApiMetric>;
  let repository: BusApiMetricRepository;

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
    await model.syncIndexes();
    repository = new BusApiMetricRepository(model);
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await connection.close();
    await mongoServer.stop();
  });

  it('같은 instance의 같은 minute 재시도는 count를 중복하지 않는다', async () => {
    const bucket = metric('2026-09-30T00:00:00.000Z', '0', 3, 1);

    await repository.upsertBucket(bucket);
    await repository.upsertBucket(bucket);

    expect(await model.countDocuments()).toBe(1);
    expect((await model.findOne()).requestCount).toBe(3);
  });

  it('여러 instance를 시간별 한 point로 합산한다', async () => {
    await model.create([
      metric('2026-09-30T00:10:00.000Z', '0', 3, 1),
      metric('2026-09-30T00:20:00.000Z', '1', 5, 0),
    ]);

    await expect(
      repository.aggregateSeries(
        new Date('2026-09-30T00:00:00.000Z'),
        new Date('2026-09-30T01:00:00.000Z'),
        'hour',
      ),
    ).resolves.toEqual([
      {
        start: new Date('2026-09-30T00:00:00.000Z'),
        requestCount: 8,
        errorCount: 1,
      },
    ]);
  });

  it('합계 조회는 시작을 포함하고 끝을 제외한다', async () => {
    await model.create([
      metric('2026-09-30T00:00:00.000Z', '0', 2, 1),
      metric('2026-09-30T00:59:00.000Z', '0', 3, 0),
      metric('2026-09-30T01:00:00.000Z', '0', 100, 100),
    ]);

    await expect(
      repository.sumSince(
        new Date('2026-09-30T00:00:00.000Z'),
        new Date('2026-09-30T01:00:00.000Z'),
      ),
    ).resolves.toEqual({ requestCount: 5, errorCount: 1 });
  });

  it('조회 기간이 비어 있으면 0 합계를 반환한다', async () => {
    await expect(
      repository.sumSince(
        new Date('2026-09-30T00:00:00.000Z'),
        new Date('2026-09-30T01:00:00.000Z'),
      ),
    ).resolves.toEqual({ requestCount: 0, errorCount: 0 });
  });

  it('가장 최근에 수집된 minute을 반환한다', async () => {
    await model.create([
      metric('2026-09-30T00:00:00.000Z', '0', 1, 0),
      metric('2026-09-30T00:02:00.000Z', '0', 1, 0),
      metric('2026-09-30T00:01:00.000Z', '0', 1, 0),
    ]);

    await expect(repository.findLastCollectedAt()).resolves.toEqual(
      new Date('2026-09-30T00:02:00.000Z'),
    );
  });

  it('수집값이 없으면 최근 minute은 null이다', async () => {
    await expect(repository.findLastCollectedAt()).resolves.toBeNull();
  });

  it('bucket unique, TTL, 조회 index를 생성한다', async () => {
    const indexes = await model.collection.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'bucket_instance_unique',
          key: { bucketStart: 1, instanceId: 1 },
          unique: true,
        }),
        expect.objectContaining({
          name: 'metric_expiry_ttl',
          key: { expiresAt: 1 },
          expireAfterSeconds: 0,
        }),
        expect.objectContaining({
          name: 'metric_bucket_start',
          key: { bucketStart: 1 },
        }),
      ]),
    );
  });
});
