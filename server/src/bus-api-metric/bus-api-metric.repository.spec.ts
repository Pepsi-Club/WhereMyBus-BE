import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import { BusApiMetric, BusApiMetricSchema } from './bus-api-metric.schema';
import {
  BusApiMetricRepository,
  StoredMetricBucket,
} from './bus-api-metric.repository';
import {
  BusApiMetricDimension,
  BusApiMetricIdentity,
  BUS_API_METRIC_DIMENSIONS,
  getMetricDimensionCatalog,
  resolveMetricDimensionFilter,
  SEOUL_BUS_ARRIVAL_METRIC,
} from './bus-api-metric.dimension';

describe('Metric dimension registry', () => {
  const dimensions: ReadonlyArray<BusApiMetricDimension> = [
    {
      provider: 'a',
      providerLabel: 'A',
      operation: 'arrival',
      operationLabel: 'Arrival',
    },
    {
      provider: 'a',
      providerLabel: 'A',
      operation: 'route',
      operationLabel: 'Route',
    },
    {
      provider: 'b',
      providerLabel: 'B',
      operation: 'location',
      operationLabel: 'Location',
    },
  ];

  it('카탈로그는 등록된 provider별 operation과 표시 이름을 반환한다', () => {
    expect(getMetricDimensionCatalog()).toEqual({
      providers: [
        {
          key: 'seoul-bus',
          label: '서울 버스',
          operations: [{ key: 'bus-arrival', label: '버스 도착 정보' }],
        },
      ],
    });
    getMetricDimensionCatalog().providers[0].operations.length = 0;
    expect(getMetricDimensionCatalog().providers[0].operations).toHaveLength(1);
    expect(Object.isFrozen(BUS_API_METRIC_DIMENSIONS)).toBe(true);
    expect(Object.isFrozen(BUS_API_METRIC_DIMENSIONS[0])).toBe(true);
    expect(Object.isFrozen(SEOUL_BUS_ARRIVAL_METRIC)).toBe(true);
  });

  it.each([
    [
      {},
      { providers: ['a', 'b'], operations: ['arrival', 'route', 'location'] },
    ],
    [
      { providers: ['a'] },
      { providers: ['a'], operations: ['arrival', 'route'] },
    ],
    [
      { operations: ['location'] },
      { providers: ['b'], operations: ['location'] },
    ],
    [
      {
        providers: ['a', 'a', 'unknown'],
        operations: ['arrival', 'arrival', 'location', 'unknown'],
      },
      { providers: ['a'], operations: ['arrival'] },
    ],
    [
      { providers: ['a', 'b'], operations: ['arrival'] },
      { providers: ['a'], operations: ['arrival'] },
    ],
    [{ providers: ['a'], operations: ['location'] }, null],
    [{ providers: ['unknown'] }, null],
    [{ operations: ['unknown'] }, null],
    [{ providers: [] }, null],
    [{ operations: [] }, null],
  ])('호환되는 등록 pair로 선택 %j를 해석한다', (selection, expected) => {
    expect(resolveMetricDimensionFilter(selection, dimensions)).toEqual(
      expected,
    );
  });

  it('기본 registry의 모든 분류를 선택한다', () => {
    expect(resolveMetricDimensionFilter({})).toEqual({
      providers: ['seoul-bus'],
      operations: ['bus-arrival'],
    });
  });
});

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
    identity: BusApiMetricIdentity = SEOUL_BUS_ARRIVAL_METRIC,
  ): StoredMetricBucket => ({
    bucketStart: new Date(bucketStart),
    instanceId,
    ...identity,
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

  it('같은 minute과 instance라도 dimension이 다르면 별도 문서다', async () => {
    await repository.upsertBucket(
      metric('2026-10-05T00:00:00.000Z', '0', 3, 0),
    );
    await repository.upsertBucket(
      metric('2026-10-05T00:00:00.000Z', '0', 5, 1, {
        provider: 'test-provider',
        operation: 'test-operation',
      }),
    );
    expect(await model.countDocuments()).toBe(2);
    await expect(
      repository.sumSince(
        new Date('2026-10-05T00:00:00.000Z'),
        new Date('2026-10-05T01:00:00.000Z'),
      ),
    ).resolves.toEqual({ requestCount: 8, errorCount: 1 });
  });

  it('provider와 operation은 저장에 필수다', async () => {
    const bucket = metric('2026-10-05T00:00:00.000Z', '0', 3, 0);
    await expect(
      model.create({ ...bucket, provider: undefined }),
    ).rejects.toThrow('provider');
    await expect(
      model.create({ ...bucket, operation: undefined }),
    ).rejects.toThrow('operation');
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
        weekday: 3,
        requestCount: 8,
        errorCount: 1,
      },
    ]);
  });

  it('dimension filter와 Seoul ISO weekday를 함께 집계한다', async () => {
    await model.create([
      metric('2026-10-04T14:30:00.000Z', '0', 2, 0),
      metric('2026-10-04T15:30:00.000Z', '0', 3, 1),
      metric('2026-10-04T15:40:00.000Z', '1', 5, 0),
      metric('2026-10-04T15:50:00.000Z', '0', 100, 100, {
        provider: 'test-provider',
        operation: 'bus-arrival',
      }),
      metric('2026-10-04T15:51:00.000Z', '0', 100, 100, {
        provider: 'seoul-bus',
        operation: 'test-operation',
      }),
    ]);
    await expect(
      repository.aggregateSeries(
        new Date('2026-10-04T14:00:00.000Z'),
        new Date('2026-10-04T16:00:00.000Z'),
        'hour',
        { providers: ['seoul-bus'], operations: ['bus-arrival'] },
      ),
    ).resolves.toEqual([
      {
        start: new Date('2026-10-04T14:00:00.000Z'),
        weekday: 7,
        requestCount: 2,
        errorCount: 0,
      },
      {
        start: new Date('2026-10-04T15:00:00.000Z'),
        weekday: 1,
        requestCount: 8,
        errorCount: 1,
      },
    ]);
  });

  it('일별 point는 Seoul 자정으로 묶고 요일을 반환한다', async () => {
    await model.create([
      metric('2026-10-04T14:59:00.000Z', '0', 2, 0),
      metric('2026-10-04T15:00:00.000Z', '0', 3, 1),
    ]);
    await expect(
      repository.aggregateSeries(
        new Date('2026-10-04T00:00:00.000Z'),
        new Date('2026-10-05T00:00:00.000Z'),
        'day',
      ),
    ).resolves.toEqual([
      {
        start: new Date('2026-10-03T15:00:00.000Z'),
        weekday: 7,
        requestCount: 2,
        errorCount: 0,
      },
      {
        start: new Date('2026-10-04T15:00:00.000Z'),
        weekday: 1,
        requestCount: 3,
        errorCount: 1,
      },
    ]);
  });

  it('dimension filter가 합계와 최근 수집값 모두에 적용된다', async () => {
    await model.create([
      metric('2026-10-05T00:00:00.000Z', '0', 2, 1),
      metric('2026-10-05T00:01:00.000Z', '1', 3, 0),
      metric('2026-10-05T00:02:00.000Z', '0', 100, 100, {
        provider: 'test-provider',
        operation: 'bus-arrival',
      }),
      metric('2026-10-05T00:03:00.000Z', '0', 100, 100, {
        provider: 'seoul-bus',
        operation: 'test-operation',
      }),
      metric('2026-10-05T01:00:00.000Z', '0', 10, 2),
    ]);
    const filter = { providers: ['seoul-bus'], operations: ['bus-arrival'] };
    await expect(
      repository.sumSince(
        new Date('2026-10-05T00:00:00.000Z'),
        new Date('2026-10-05T01:00:00.000Z'),
        filter,
      ),
    ).resolves.toEqual({ requestCount: 5, errorCount: 1 });
    await expect(repository.findLastCollectedAt(filter)).resolves.toEqual(
      new Date('2026-10-05T01:00:00.000Z'),
    );
    await expect(
      repository.findLastCollectedAt({
        providers: ['test-provider'],
        operations: ['bus-arrival'],
      }),
    ).resolves.toEqual(new Date('2026-10-05T00:02:00.000Z'));
    await expect(
      repository.findLastCollectedAt({
        providers: ['missing'],
        operations: ['missing'],
      }),
    ).resolves.toBeNull();
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
          name: 'bucket_instance_dimension_unique',
          key: { bucketStart: 1, instanceId: 1, provider: 1, operation: 1 },
          unique: true,
        }),
        expect.objectContaining({
          name: 'metric_dimension_bucket_start',
          key: { provider: 1, operation: 1, bucketStart: 1 },
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
    expect(indexes.some(({ name }) => name === 'bucket_instance_unique')).toBe(
      false,
    );
  });
});
