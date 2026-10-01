# Bus API Metrics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 버스 도착 API 호출량과 transport 오류를 분 단위로 MongoDB에 저장하고, 인증된 자체 Dashboard에서 기간별 통계를 조회한다.

**Architecture:** `BusApiMetricService`가 요청·오류를 메모리의 UTC minute bucket에 기록하고 완료 bucket만 `BusApiMetricRepository`에 idempotent upsert한다. Dashboard API는 HMAC 서명 HttpOnly cookie와 IP별 로그인 제한으로 보호하며, MongoDB aggregation 결과를 `/api/dashboard/metrics`에서 반환한다. Nginx는 저장소 루트의 `dashboard/`를 정적으로 제공하고 API namespace만 NestJS로 proxy한다.

**Tech Stack:** NestJS 8, TypeScript, Mongoose 8, MongoDB aggregation, Node `crypto`, Jest 28, Supertest, vanilla JavaScript/CSS/SVG, Nginx

**Spec:** `docs/superpowers/specs/2026-09-30-mongodb-dashboard-metrics-design.md`

## Global Constraints

- 실제 외부 요청 직전 request count를 올리고 Axios reject만 error count로 집계한다.
- 요청이 0건인 minute에는 MongoDB 문서를 생성하지 않는다.
- MongoDB 저장 실패는 버스 조회와 FCM 흐름에 전파하지 않는다.
- `bucketStart`는 UTC minute start, 조회 날짜 경계는 `Asia/Seoul`이다.
- `(bucketStart, instanceId)` unique index와 `expiresAt` TTL index를 사용한다.
- 보존 기간 기본값은 400일, pending queue 최대값은 60개다.
- Dashboard range는 `24h`, `7d`, `30d`, `90d`만 허용한다.
- cookie는 `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/dashboard`, 기본 TTL 28,800초다.
- access code와 session secret은 다른 값이며 static 파일, 응답, 로그에 포함하지 않는다.
- frontend는 외부 CDN, 외부 font, 외부 analytics를 사용하지 않는다.
- PM2 프로세스 구조와 정기 알림 스케줄 정책은 변경하지 않는다.
- 운영 static 경로는 `/home/ubuntu/WhereMyBus-BE/dashboard/`, backend는 `/home/ubuntu/WhereMyBus-BE/server/`다.

## Review Focus

- Axios 요청이 분 경계를 넘어서 실패할 때 error가 요청 시작 minute에 기록되는지 Task 3에서 검증한다.
- MongoDB write가 반복 실패하고 queue가 60개를 넘을 때 오래된 bucket만 제거되고 버스 요청에는 오류가 전파되지 않는지 Task 2에서 검증한다.
- 변조·만료 session, 동일한 access code/session secret, 6번째 로그인 실패가 각각 거부되는지 Task 4에서 검증한다.
- UTC 15:00가 서울 자정인 경계와 여러 PM2 instance 문서가 하나의 series point로 합산되는지 Task 5에서 검증한다.
- 빈 series, 매우 큰 count, session 만료, fetch 실패에서도 Dashboard가 비밀값 노출 없이 상태를 표시하는지 Task 6에서 검증한다.

---

### Task 1: Minute Bucket Schema and Repository

**Files:**

- Create: `src/bus-api-metric/bus-api-metric.schema.ts`
- Create: `src/bus-api-metric/bus-api-metric.repository.ts`
- Create: `src/bus-api-metric/bus-api-metric.repository.spec.ts`

**Interfaces:**

- Consumes: Mongoose `Model<BusApiMetric>` and UTC `Date` inputs.
- Produces: `BusApiMetricRepository.upsertBucket(bucket)`, `sumSince(start, end)`, `aggregateSeries(start, end, unit)`, `findLastCollectedAt()`.

- [ ] **Step 1: Write failing repository tests**

Create `bus-api-metric.repository.spec.ts` with `mongodb-memory-server`. Use two `instanceId` values for the same minute and literal expected totals.

```ts
it('같은 instance의 같은 minute 재시도는 count를 중복하지 않는다', async () => {
  const bucket = {
    bucketStart: new Date('2026-09-30T00:00:00.000Z'),
    instanceId: '0',
    requestCount: 3,
    errorCount: 1,
    expiresAt: new Date('2027-11-04T00:00:00.000Z'),
  };

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
```

Also test inclusive start/exclusive end, empty totals, latest bucket, unique index names, and TTL `expireAfterSeconds: 0`.

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```bash
npm test -- --runInBand bus-api-metric.repository.spec.ts
```

Expected: FAIL because schema and repository modules do not exist.

- [ ] **Step 3: Implement schema and repository**

Create exact document contract:

```ts
@Schema({ collection: 'bus_api_metrics', versionKey: false })
export class BusApiMetric {
  @Prop({ required: true }) bucketStart: Date;
  @Prop({ required: true }) instanceId: string;
  @Prop({ required: true, min: 0 }) requestCount: number;
  @Prop({ required: true, min: 0 }) errorCount: number;
  @Prop({ required: true }) expiresAt: Date;
}

export const BusApiMetricSchema = SchemaFactory.createForClass(BusApiMetric);
BusApiMetricSchema.index(
  { bucketStart: 1, instanceId: 1 },
  { unique: true, name: 'bucket_instance_unique' },
);
BusApiMetricSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'metric_expiry_ttl' },
);
BusApiMetricSchema.index({ bucketStart: 1 }, { name: 'metric_bucket_start' });
```

Repository types and writes:

```ts
export type MetricUnit = 'hour' | 'day';
export interface MetricCounts {
  requestCount: number;
  errorCount: number;
}
export interface MetricPoint extends MetricCounts {
  start: Date;
}

async upsertBucket(bucket: StoredMetricBucket): Promise<void> {
  await this.model.updateOne(
    { bucketStart: bucket.bucketStart, instanceId: bucket.instanceId },
    { $set: bucket },
    { upsert: true },
  );
}
```

`sumSince` must `$match` with `{ $gte: start, $lt: end }`. `aggregateSeries` must `$dateTrunc` with `timezone: 'Asia/Seoul'`, sum both counters, sort by `_id`, and map `_id` to `start`. `findLastCollectedAt` must use indexed descending sort and return `null` on empty collection.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run:

```bash
npm test -- --runInBand bus-api-metric.repository.spec.ts
```

Expected: PASS with all repository behaviors.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/bus-api-metric/bus-api-metric.schema.ts src/bus-api-metric/bus-api-metric.repository.ts src/bus-api-metric/bus-api-metric.repository.spec.ts
git commit -m "[Feat] 버스 API 메트릭 저장소 추가"
```

### Task 2: In-Memory Recorder, Sparse Flush, and Retry Queue

**Files:**

- Create: `src/bus-api-metric/bus-api-metric.service.ts`
- Create: `src/bus-api-metric/bus-api-metric.service.spec.ts`

**Interfaces:**

- Consumes: `BusApiMetricRepository.upsertBucket()`, `ConfigService`, optional `Date` supplied by caller/tests.
- Produces: `recordRequest(at?: Date): void`, `recordError(at?: Date): void`, `flushCompletedBuckets(now?: Date): Promise<void>`, `onApplicationShutdown(): Promise<void>`.

- [ ] **Step 1: Write failing recorder tests**

Use a small in-memory fake repository whose `upsertBucket` stores actual values or throws a configured error. Assert stored values, not mock call existence.

```ts
it('호출 없는 minute는 저장하지 않는다', async () => {
  await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));
  expect(repository.saved).toEqual([]);
});

it('같은 minute 요청과 오류를 하나의 bucket으로 저장한다', async () => {
  service.recordRequest(new Date('2026-09-30T00:00:10.000Z'));
  service.recordRequest(new Date('2026-09-30T00:00:50.000Z'));
  service.recordError(new Date('2026-09-30T00:00:10.000Z'));

  await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

  expect(repository.saved[0]).toMatchObject({
    bucketStart: new Date('2026-09-30T00:00:00.000Z'),
    instanceId: '0',
    requestCount: 2,
    errorCount: 1,
  });
});
```

Add tests proving failed writes remain for retry, a retry overwrites once, the 61st pending bucket drops only the oldest, all public recorder methods swallow repository errors, and shutdown flushes current non-empty bucket.

- [ ] **Step 2: Run recorder tests and verify RED**

Run:

```bash
npm test -- --runInBand bus-api-metric.service.spec.ts
```

Expected: FAIL because `BusApiMetricService` does not exist.

- [ ] **Step 3: Implement minute buffer and lifecycle**

Use UTC epoch minute keys so locale cannot affect storage:

```ts
type MutableBucket = { requestCount: number; errorCount: number };

private readonly buckets = new Map<number, MutableBucket>();
private flushRunning = false;

recordRequest(at = new Date()): void {
  try {
    this.bucketFor(at).requestCount += 1;
    this.trimPendingBuckets();
  } catch (error) {
    this.logger.error('Failed to record bus API request metric');
  }
}

recordError(at = new Date()): void {
  try {
    this.bucketFor(at).errorCount += 1;
    this.trimPendingBuckets();
  } catch (error) {
    this.logger.error('Failed to record bus API error metric');
  }
}
```

`bucketFor()` uses `Math.floor(at.getTime() / 60_000) * 60_000`. `flushCompletedBuckets()` serializes flushes with `flushRunning`, selects keys strictly older than current minute, writes oldest first, deletes only successful entries, keeps failed entries, and never rejects. `expiresAt` equals bucket start plus configured retention days. `onApplicationShutdown()` calls the same internal drain with current bucket included.

Use `@Cron(CronExpression.EVERY_MINUTE)` on `flushCompletedBuckets`. Queue trimming must sort keys, remove entries until size is 60, and log only bucket timestamp/count—not secrets or request data.

- [ ] **Step 4: Run recorder tests and verify GREEN**

Run:

```bash
npm test -- --runInBand bus-api-metric.service.spec.ts
```

Expected: PASS; retry and 60-entry boundary proven.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/bus-api-metric/bus-api-metric.service.ts src/bus-api-metric/bus-api-metric.service.spec.ts
git commit -m "[Feat] 버스 API 분 단위 메트릭 집계 추가"
```

### Task 3: Instrument Actual Seoul Bus HTTP Requests

**Files:**

- Modify: `src/bus-info/bus-info.service.ts`
- Replace: `src/bus-info/bus-info.service.spec.ts`
- Modify: `src/bus-info/bus-info.module.ts`
- Create: `src/bus-api-metric/bus-api-metric.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/regular-alarm/regular-alarm.module.ts`

**Interfaces:**

- Consumes: `BusApiMetricService.recordRequest(at)`, `recordError(at)` and repository/schema from Tasks 1-2.
- Produces: exactly one request metric per `axios.get`, with errors tied to request start minute; exports repository/service for Dashboard queries.

- [ ] **Step 1: Replace external-network test with failing deterministic tests**

Spy on `axios.get` only because it is the external HTTP boundary. Supply a real recorder double that stores request/error timestamps.

```ts
it('실제 HTTP 요청 직전에 request metric을 기록한다', async () => {
  jest.spyOn(axios, 'get').mockResolvedValue({ data: responseData });
  await service.arriveStation('22285');
  expect(recorder.requests).toHaveLength(1);
  expect(recorder.errors).toHaveLength(0);
});

it('분 경계를 넘은 HTTP 실패도 요청 시작 minute에 기록하고 원래 오류를 던진다', async () => {
  const failure = new Error('timeout');
  let rejectRequest: (error: Error) => void;
  jest.useFakeTimers().setSystemTime(new Date('2026-09-30T00:00:59.900Z'));
  jest.spyOn(axios, 'get').mockReturnValue(
    new Promise((_, reject) => {
      rejectRequest = reject;
    }),
  );

  const request = service.arriveStation('22285');
  jest.setSystemTime(new Date('2026-09-30T00:01:00.100Z'));
  rejectRequest(failure);

  await expect(request).rejects.toBe(failure);
  expect(recorder.errors[0].getTime()).toBe(recorder.requests[0].getTime());
  jest.useRealTimers();
});
```

Include an `arriveEachBus()` test proving it records once, not twice.

- [ ] **Step 2: Run BusInfo tests and verify RED**

Run:

```bash
npm test -- --runInBand bus-info.service.spec.ts
```

Expected: FAIL because `BusInfoService` does not inject or call metric recorder.

- [ ] **Step 3: Add instrumentation and module wiring**

Update request boundary:

```ts
async arriveStation(arsId: string): Promise<ResponseData> {
  const startedAt = new Date();
  this.metricRecorder.recordRequest(startedAt);
  const requestUrl = `${this.apiUrl}?ServiceKey=${this.serviceKey}&arsId=${arsId}&resultType=json`;

  try {
    return (await axios.get(requestUrl)).data;
  } catch (error) {
    this.metricRecorder.recordError(startedAt);
    throw error;
  }
}
```

`BusApiMetricModule` imports `MongooseModule.forFeature`, provides/exports service and repository, and owns controller classes added in later tasks. `BusInfoModule` imports `BusApiMetricModule`. Move `ScheduleModule.forRoot()` from `RegularAlarmModule` to root `AppModule` so scheduler initializes once.

- [ ] **Step 4: Run BusInfo tests and full focused suite**

Run:

```bash
npm test -- --runInBand bus-info.service.spec.ts bus-api-metric.service.spec.ts
```

Expected: PASS with no real network request.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/bus-info src/bus-api-metric/bus-api-metric.module.ts src/app.module.ts src/regular-alarm/regular-alarm.module.ts
git commit -m "[Feat] 버스 API 요청 계측 연결"
```

### Task 4: Dashboard Session Authentication and Login Rate Limit

**Files:**

- Create: `src/bus-api-metric/dashboard-auth.service.ts`
- Create: `src/bus-api-metric/dashboard-auth.service.spec.ts`
- Create: `src/bus-api-metric/dashboard-auth.guard.ts`
- Create: `src/bus-api-metric/dashboard-auth.guard.spec.ts`
- Create: `src/bus-api-metric/dto/dashboard-auth.request.dto.ts`

**Interfaces:**

- Consumes: `ConfigService`, request IP, raw `Cookie` header.
- Produces: `authenticate(code, ip, now?)`, `createSession(now?)`, `verifySession(token, now?)`, `DashboardAuthGuard.canActivate()` and cookie name `wmb_dashboard_session`.

- [ ] **Step 1: Write failing auth service tests**

Use literal secrets through a test `ConfigService` and fake dates.

```ts
it('올바른 코드로 만든 session을 TTL 안에서 검증한다', () => {
  auth.authenticate('developer-code-1234', '127.0.0.1');
  const token = auth.createSession(new Date('2026-09-30T00:00:00.000Z'));
  expect(auth.verifySession(token, new Date('2026-09-30T07:59:59.000Z'))).toBe(
    true,
  );
});

it('변조되거나 만료된 session을 거부한다', () => {
  const token = auth.createSession(new Date('2026-09-30T00:00:00.000Z'));
  expect(auth.verifySession(`${token}x`)).toBe(false);
  expect(auth.verifySession(token, new Date('2026-09-30T08:00:01.000Z'))).toBe(
    false,
  );
});

it('같은 IP의 6번째 실패를 429로 막고 성공하면 실패 기록을 지운다', () => {
  for (let i = 0; i < 5; i += 1) {
    expect(() => auth.authenticate('wrong-code', '203.0.113.10')).toThrow(
      UnauthorizedException,
    );
  }
  try {
    auth.authenticate('wrong-code', '203.0.113.10');
    throw new Error('expected rate limit rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  }
});
```

Also test expiry of rate-limit window, missing config, same access code/session secret, and no exception text containing submitted code.

- [ ] **Step 2: Run auth tests and verify RED**

Run:

```bash
npm test -- --runInBand dashboard-auth.service.spec.ts dashboard-auth.guard.spec.ts
```

Expected: FAIL because auth service and guard do not exist.

- [ ] **Step 3: Implement HMAC session and constant-time code check**

Use SHA-256 digests before `timingSafeEqual` so both buffers always have equal length:

```ts
private safeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
```

Session token format is `<base64url JSON payload>.<base64url HMAC-SHA256 signature>`, payload is `{ "exp": <unix-seconds> }`, and verification rejects malformed JSON, non-numeric expiration, invalid signature, or `exp <= now`. Require access code length at least 12, secret length at least 32, and different values; invalid configuration returns the same unauthorized response as wrong login without logging either value.

Guard cookie parsing must split pairs on the first `=`, decode the matching cookie, and reject missing/invalid sessions with `UnauthorizedException`. `DASHBOARD_ENABLED !== 'true'` returns `NotFoundException` from auth entry and guard.

- [ ] **Step 4: Run auth tests and verify GREEN**

Run:

```bash
npm test -- --runInBand dashboard-auth.service.spec.ts dashboard-auth.guard.spec.ts
```

Expected: PASS for valid, malformed, expired, disabled, and rate-limited cases.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/bus-api-metric/dashboard-auth.service.ts src/bus-api-metric/dashboard-auth.service.spec.ts src/bus-api-metric/dashboard-auth.guard.ts src/bus-api-metric/dashboard-auth.guard.spec.ts src/bus-api-metric/dto/dashboard-auth.request.dto.ts
git commit -m "[Feat] 대시보드 세션 인증 추가"
```

### Task 5: Metrics Query Service and Protected Dashboard API

**Files:**

- Create: `src/bus-api-metric/dashboard-metric.service.ts`
- Create: `src/bus-api-metric/dashboard-metric.service.spec.ts`
- Create: `src/bus-api-metric/bus-api-metric.controller.ts`
- Create: `src/bus-api-metric/bus-api-metric.controller.spec.ts`
- Create: `src/bus-api-metric/dto/dashboard-range.query.dto.ts`
- Modify: `src/bus-api-metric/bus-api-metric.module.ts`

**Interfaces:**

- Consumes: repository query methods, `DashboardAuthService`, `DashboardAuthGuard`.
- Produces: auth/session/logout endpoints and `getMetrics(range, now?)` response matching spec.

- [ ] **Step 1: Write failing query tests**

Use a real in-memory MongoDB repository. Seed literal data on both sides of Seoul midnight and duplicate minute documents for instance `0` and `1`.

```ts
it('UTC 15:00를 서울 날짜 경계로 사용하고 instance 값을 합산한다', async () => {
  await seed([
    metric('2026-09-29T14:59:00.000Z', '0', 100, 0),
    metric('2026-09-29T15:00:00.000Z', '0', 3, 1),
    metric('2026-09-29T15:00:00.000Z', '1', 5, 0),
  ]);

  const result = await service.getMetrics(
    '24h',
    new Date('2026-09-30T01:00:00.000Z'),
  );

  expect(result.summary.todayRequests).toBe(8);
  expect(result.series[0].requestCount).toBe(8);
});

it('데이터가 없으면 0 summary와 빈 series를 반환한다', async () => {
  await expect(
    service.getMetrics('30d', new Date('2026-09-30T01:00:00.000Z')),
  ).resolves.toMatchObject({
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
```

Add table-driven tests for range duration/unit: `24h/hour`, `7d/hour`, `30d/day`, `90d/day`; assert `errorRate = rangeErrors / rangeRequests` and `0` when requests are zero.

- [ ] **Step 2: Write failing controller HTTP tests**

Create a small Nest testing app with real validation pipe and Supertest. Assert:

```ts
await request(app.getHttpServer())
  .get('/api/dashboard/metrics?range=24h')
  .expect(401);

const login = await request(app.getHttpServer())
  .post('/api/dashboard/auth')
  .send({ code: 'developer-code-1234' })
  .expect(201)
  .expect('set-cookie', /HttpOnly/)
  .expect('set-cookie', /Secure/)
  .expect('set-cookie', /SameSite=Strict/)
  .expect('set-cookie', /Path=\/api\/dashboard/);

await request(app.getHttpServer())
  .get('/api/dashboard/metrics?range=365d')
  .set('Cookie', login.headers['set-cookie'])
  .expect(400);
```

Also assert session returns `{ authenticated: true }`, logout expires cookie, post-logout token is not reused by the test client, and metrics response contains no access code or secret.

- [ ] **Step 3: Run query/controller tests and verify RED**

Run:

```bash
npm test -- --runInBand dashboard-metric.service.spec.ts bus-api-metric.controller.spec.ts
```

Expected: FAIL because query service/controller/DTO do not exist.

- [ ] **Step 4: Implement query boundaries and controller**

Use fixed Korea offset helpers because `Asia/Seoul` has no DST:

```ts
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function startOfSeoulDay(now: Date): Date {
  const local = new Date(now.getTime() + SEOUL_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      SEOUL_OFFSET_MS,
  );
}
```

`getMetrics` computes rolling range start, Seoul day/month starts, calls repository methods with exclusive `end = now`, selects hour/day unit, and returns ISO strings plus `timezone: 'Asia/Seoul'`. Format point `start` as `YYYY-MM-DDTHH:mm:ss+09:00`; do not expose `instanceId`.

Controller contract:

```ts
@Controller('api/dashboard')
export class BusApiMetricController {
  @Post('auth') auth(...): { authenticated: true };
  @UseGuards(DashboardAuthGuard) @Get('session') session(): { authenticated: true };
  @UseGuards(DashboardAuthGuard) @Get('metrics') metrics(@Query() query: DashboardRangeQueryDto);
  @Post('logout') logout(...): { authenticated: false };
}
```

Set cookie with `httpOnly: true`, `secure: true`, `sameSite: 'strict'`, `path: '/api/dashboard'`, and configured `maxAge` milliseconds. Logout sets same options with `maxAge: 0`. `DashboardRangeQueryDto.range` uses `@IsIn(['24h', '7d', '30d', '90d'])`.

- [ ] **Step 5: Run query/controller tests and verify GREEN**

Run:

```bash
npm test -- --runInBand dashboard-metric.service.spec.ts bus-api-metric.controller.spec.ts
```

Expected: PASS for timezone, range validation, auth, cookie, empty data, and multiple instances.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/bus-api-metric
git commit -m "[Feat] 대시보드 메트릭 API 추가"
```

### Task 6: Static Dashboard

**Files:**

- Create: `../dashboard/index.html`
- Create: `../dashboard/dashboard.js`
- Create: `../dashboard/dashboard.css`
- Create: `src/bus-api-metric/dashboard-assets.spec.ts`

**Interfaces:**

- Consumes: `/api/dashboard/auth`, `/session`, `/metrics`, `/logout` from Task 5.
- Produces: `/dashboard/` login and authenticated metrics view with summary cards, range selection, SVG chart, error/session states.

- [ ] **Step 1: Write failing pure frontend behavior tests**

`dashboard.js` uses a browser/Node-compatible wrapper and exports pure helpers under `module.exports` only when CommonJS exists. Test hand-derived output:

```ts
const {
  formatCount,
  buildLinePath,
  normalizeMetrics,
} = require('../../../dashboard/dashboard.js');

it('큰 count를 한국어 locale 숫자로 표시한다', () => {
  expect(formatCount(1234567)).toBe('1,234,567');
});

it('빈 series는 빈 SVG path를 만든다', () => {
  expect(buildLinePath([], 800, 240)).toBe('');
});

it('requestCount가 모두 0이어도 유한 좌표만 만든다', () => {
  expect(
    buildLinePath([{ requestCount: 0 }, { requestCount: 0 }], 100, 50),
  ).toBe('M 0 50 L 100 50');
});
```

`normalizeMetrics` must convert missing/invalid numeric fields to `0` and preserve only server-provided count/start fields, preventing arbitrary HTML from becoming render input.

- [ ] **Step 2: Run frontend helper tests and verify RED**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts
```

Expected: FAIL because dashboard assets do not exist.

- [ ] **Step 3: Implement HTML structure and pure JS helpers**

HTML includes:

```html
<main>
  <section id="login-view" aria-labelledby="login-title">...</section>
  <section id="dashboard-view" hidden aria-labelledby="dashboard-title">
    <div id="summary-cards" aria-live="polite">...</div>
    <select id="range-select" aria-label="조회 기간">
      ...
    </select>
    <svg id="request-chart" role="img" aria-labelledby="chart-title"></svg>
  </section>
  <p id="status-message" role="status" aria-live="polite"></p>
</main>
```

JavaScript uses `const API_BASE = '/api/dashboard'`, `fetch(..., { credentials: 'same-origin' })`, and text content only. Startup calls `/session`; 401 shows login, success loads `24h`. Login code exists only in current input and request body, then input value is cleared. Metrics 401 returns to login. Other fetch failures show a generic retry message without response bodies or secrets. Logout clears the server cookie then returns to login.

Use SVG `<path>` plus accessible textual totals; do not use `innerHTML` for API values. CSS provides responsive cards, visible focus states, system fonts, and no external asset URLs.

- [ ] **Step 4: Run frontend tests and local static smoke check**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts
node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=path.resolve('../dashboard');const s=http.createServer((q,r)=>{const file=q.url==='/'?'index.html':q.url.slice(1);fs.createReadStream(path.join(root,file)).on('error',()=>{r.statusCode=404;r.end()}).pipe(r)}).listen(4173,'127.0.0.1',async()=>{const x=await fetch('http://127.0.0.1:4173/');if(x.status!==200||!(await x.text()).includes('버스 API'))process.exitCode=1;s.close()})"
```

Expected: Jest PASS and smoke command exit `0`.

- [ ] **Step 5: Commit Task 6**

```bash
git add ../dashboard/index.html ../dashboard/dashboard.js ../dashboard/dashboard.css src/bus-api-metric/dashboard-assets.spec.ts
git commit -m "[Feat] 버스 API 메트릭 대시보드 화면 추가"
```

### Task 7: Runtime Security, Regression Verification, and Deployment Handoff

**Files:**

- Modify: `src/main.ts`
- Create: `src/main.spec.ts`
- Modify: `test/app.e2e-spec.ts`
- Modify: `docs/operations/dashboard-nginx-deployment.md`
- Modify: `docs/superpowers/specs/2026-09-30-mongodb-dashboard-metrics-design.md`

**Interfaces:**

- Consumes: complete module and static assets from Tasks 1-6.
- Produces: loopback-default server binding, loopback proxy trust, shutdown hooks, end-to-end startup coverage, final deployment commands.

- [ ] **Step 1: Write failing bootstrap/E2E coverage**

Extract bootstrap configuration into an exported function that accepts a Nest app and config, then test behavior without opening a public socket:

```ts
it('loopback proxy만 신뢰하고 shutdown hook을 활성화한다', async () => {
  const app = createFakeNestApplication();
  await configureApplication(app, config({ HOST: '127.0.0.1', PORT: 3000 }));
  expect(app.httpInstance.trustProxy).toBe('loopback');
  expect(app.shutdownHooksEnabled).toBe(true);
  expect(app.listenArgs).toEqual([3000, '127.0.0.1']);
});
```

Update E2E setup to use an in-memory MongoDB URI and safe dashboard test secrets. Assert `/` remains `Hello World!`, unauthenticated `/api/dashboard/metrics?range=24h` returns 401, and disabled Dashboard auth returns 404.

- [ ] **Step 2: Run bootstrap/E2E tests and verify RED**

Run:

```bash
npm test -- --runInBand main.spec.ts
npm run test:e2e -- --runInBand
```

Expected: main test FAIL because configuration function does not exist; E2E exposes missing or incorrect Dashboard behavior until wiring is complete.

- [ ] **Step 3: Implement loopback defaults and shutdown hooks**

Configure Express proxy trust and listen host:

```ts
export async function configureApplication(
  app: INestApplication,
  configService: ConfigService,
): Promise<void> {
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true }));
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.enableShutdownHooks();
  const port = configService.get<number>('PORT', 3000);
  const host = configService.get<string>('HOST', '127.0.0.1');
  await app.listen(port, host);
}
```

Keep logger assignment before listen. Document `HOST=127.0.0.1`, all Dashboard env names/defaults, `npm run build`, PM2 reload, `sudo nginx -t`, Nginx reload, pre-login 401, browser login, logout, and Mongo sparse-write check. State that this repository change does not mutate OCI/Nginx directly.

- [ ] **Step 4: Run formatting check without modifying files, build, and complete suites**

Run:

```bash
npx prettier --check "src/**/*.ts" "test/**/*.ts" "../dashboard/*.{html,js,css}"
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Expected: all commands exit `0`. If pre-existing external API/Firebase tests fail, record exact test names and errors; do not weaken or skip them silently.

- [ ] **Step 5: Verify secret and route boundaries**

Run:

```bash
rg -n "developer-code-1234" src ../dashboard docs/operations
rg -n "DASHBOARD_(ACCESS_CODE|SESSION_SECRET)=[^<]" ../dashboard docs/operations
rg -n "/dashboard/api" src ../dashboard
git diff --check main...HEAD
```

Expected: test fixture code appears only in test files, real secret assignment search has no result, no `/dashboard/api` route, and `git diff --check` emits no errors.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/main.ts src/main.spec.ts test/app.e2e-spec.ts docs/operations/dashboard-nginx-deployment.md docs/superpowers/specs/2026-09-30-mongodb-dashboard-metrics-design.md
git commit -m "[Chore] 대시보드 운영 보안 설정 추가"
```

## Self-Review Record

- Spec coverage: storage, sparse minute flush, retry, actual HTTP instrumentation, auth, range query, static UI, Nginx handoff, failure isolation, PM2 instance sum, and verification each map to Tasks 1-7.
- Placeholder scan: no deferred implementation markers; each production step names exact contract and test command.
- Type consistency: `MetricUnit`, `MetricPoint`, stored bucket fields, auth cookie name, range union, and API paths stay consistent across producers/consumers.
- Review Focus coverage: minute-crossing error in Task 3; queue overflow in Task 2; session/config/rate limits in Task 4; timezone/instances in Task 5; frontend empty/error states in Task 6.
