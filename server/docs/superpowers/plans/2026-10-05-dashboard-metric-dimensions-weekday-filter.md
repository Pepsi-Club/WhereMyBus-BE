# Dashboard Metric Dimensions and Weekday Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store bus API metrics by provider and operation, expose validated Dashboard dimension filters, and filter returned series by multiple weekdays in the browser without extra requests.

**Architecture:** A typed metric-dimension registry supplies recorder identities, validation allowlists, and Dashboard labels. MongoDB keeps one document per minute, process instance, provider, and operation; repository aggregation accepts dimension filters and returns Seoul ISO weekdays. Dashboard requests provider and operation selections from the backend, caches returned series, and applies weekday selections locally.

**Tech Stack:** TypeScript 4.3, NestJS 8, Mongoose 8, class-transformer/class-validator, Jest 28, Supertest, mongodb-memory-server, vanilla JavaScript/CSS, Chart.js 4.5.1.

**Spec:** `docs/superpowers/specs/2026-10-05-dashboard-metric-dimensions-weekday-filter-design.md`

## Global Constraints

- Initial metric identity is exactly `provider=seoul-bus`, `operation=bus-arrival`.
- `provider` and `operation` are registry-controlled required strings; no arbitrary values enter MongoDB queries.
- MongoDB bucket identity is minute, `instanceId`, `provider`, and `operation`.
- No legacy migration or fallback fields: production has not received the old schema and the local dummy collection was dropped.
- `Asia/Seoul` controls aggregation boundaries and ISO weekday values `1=Monday` through `7=Sunday`.
- Weekdays never enter the metrics query; browser filtering must not cause network requests.
- `todayRequests` and `monthRequests` stay global; provider and operation filters apply to range summary, series, and `lastCollectedAt`.
- Frontend recomputes selected-period requests, errors, and error rate from weekday-filtered points.
- Keep at least one weekday, provider, and operation selected.
- Do not add production dependencies or change Chart.js 4.5.1 URL/SRI.
- Metric failures must never change bus API or notification behavior.
- Never log or render access codes, session cookies, `SERVICE_KEY`, device tokens, or raw credential-bearing URLs.

## Review Focus

- Repeated query arrays, empty CSV tokens, duplicate keys, oversized values, unknown keys, and incompatible provider-operation pairs return deterministic `400` responses; Task 3 controller tests pin each class.
- Same-minute events for one dimension accumulate while different dimensions remain separate; Task 2 recorder tests pin both paths.
- Seoul midnight and Sunday-to-Monday boundaries return ISO weekdays 7 and 1 without UTC drift; Task 1 repository tests pin the boundary.
- Rapid provider, operation, and range changes cannot let stale responses replace current filter state; Task 4 asset tests pin request generations.
- Empty or zero-request weekday selections render finite `0.00%`, zero cards, and the chart empty state without another fetch; Task 4 pure-helper and mounted tests pin this behavior.

---

### Task 1: Metric Registry, Schema, and Filtered Repository

**Files:**

- Create: `src/bus-api-metric/bus-api-metric.dimension.ts`
- Modify: `src/bus-api-metric/bus-api-metric.schema.ts`
- Modify: `src/bus-api-metric/bus-api-metric.repository.ts`
- Modify: `src/bus-api-metric/bus-api-metric.repository.spec.ts`

**Interfaces:**

- Consumes: existing `BusApiMetric` Mongoose model and `MetricUnit = 'hour' | 'day'`.
- Produces: `BusApiMetricIdentity`, `MetricDimensionFilter`, `SEOUL_BUS_ARRIVAL_METRIC`, `BUS_API_METRIC_DIMENSIONS`, `getMetricDimensionCatalog()`, `resolveMetricDimensionFilter()`, dimension-aware `StoredMetricBucket`, `sumSince(start, end, filter?)`, `aggregateSeries(start, end, unit, filter?)`, and `findLastCollectedAt(filter?)`.

- [ ] **Step 1: Write registry, schema, aggregation, index, and timezone boundary tests**

Extend the repository fixture helper so every bucket has an identity:

```ts
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
  expiresAt: new Date('2027-11-09T00:00:00.000Z'),
});
```

Add tests proving:

```ts
it('같은 minute과 instance라도 dimension이 다르면 별도 문서다', async () => {
  await repository.upsertBucket(metric('2026-10-05T00:00:00.000Z', '0', 3, 0));
  await repository.upsertBucket(
    metric('2026-10-05T00:00:00.000Z', '0', 5, 1, {
      provider: 'test-provider',
      operation: 'test-operation',
    }),
  );
  expect(await model.countDocuments()).toBe(2);
});

it('dimension filter와 Seoul ISO weekday를 함께 집계한다', async () => {
  await model.create([
    metric('2026-10-04T14:30:00.000Z', '0', 2, 0),
    metric('2026-10-04T15:30:00.000Z', '0', 3, 1),
  ]);
  await expect(
    repository.aggregateSeries(
      new Date('2026-10-04T14:00:00.000Z'),
      new Date('2026-10-04T16:00:00.000Z'),
      'hour',
      { providers: ['seoul-bus'], operations: ['bus-arrival'] },
    ),
  ).resolves.toMatchObject([{ weekday: 7 }, { weekday: 1 }]);
});
```

Assert index keys and names:

```ts
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
  ]),
);
```

- [ ] **Step 2: Run repository tests and confirm RED**

Run:

```bash
npm test -- --runInBand --no-watchman src/bus-api-metric/bus-api-metric.repository.spec.ts
```

Expected: compile failures for missing dimension exports and assertion failures for old schema/index/series shape.

- [ ] **Step 3: Add typed registry and filter resolver**

Create `bus-api-metric.dimension.ts` with immutable registry data and pure lookup functions:

```ts
export interface BusApiMetricIdentity {
  provider: string;
  operation: string;
}

export interface BusApiMetricDimension extends BusApiMetricIdentity {
  providerLabel: string;
  operationLabel: string;
}

export const BUS_API_METRIC_DIMENSIONS: ReadonlyArray<BusApiMetricDimension> = [
  {
    provider: 'seoul-bus',
    providerLabel: '서울 버스',
    operation: 'bus-arrival',
    operationLabel: '버스 도착 정보',
  },
] as const;

export const SEOUL_BUS_ARRIVAL_METRIC: BusApiMetricIdentity = {
  provider: 'seoul-bus',
  operation: 'bus-arrival',
};

export interface MetricDimensionFilter {
  providers: string[];
  operations: string[];
}

export function getMetricDimensionCatalog() {
  return {
    providers: BUS_API_METRIC_DIMENSIONS.reduce<
      Array<{
        key: string;
        label: string;
        operations: Array<{ key: string; label: string }>;
      }>
    >((providers, dimension) => {
      let provider = providers.find(({ key }) => key === dimension.provider);
      if (!provider) {
        provider = {
          key: dimension.provider,
          label: dimension.providerLabel,
          operations: [],
        };
        providers.push(provider);
      }
      provider.operations.push({
        key: dimension.operation,
        label: dimension.operationLabel,
      });
      return providers;
    }, []),
  };
}
```

Use this signature so compatibility behavior can be tested with more than the initial registry entry:

```ts
export function resolveMetricDimensionFilter(
  selection: {
    providers?: string[];
    operations?: string[];
  },
  dimensions: ReadonlyArray<BusApiMetricDimension> = BUS_API_METRIC_DIMENSIONS,
): MetricDimensionFilter | null;
```

The resolver must deduplicate keys, default missing arrays to all compatible keys, retain only registered provider-operation pairs, and return `null` when no pair is compatible. Do not import Nest exceptions into this domain file.

- [ ] **Step 4: Update schema and repository aggregation**

Add required schema properties:

```ts
@Prop({ required: true })
provider: string;

@Prop({ required: true })
operation: string;
```

Replace unique index and add dimension range index:

```ts
BusApiMetricSchema.index(
  { bucketStart: 1, instanceId: 1, provider: 1, operation: 1 },
  { unique: true, name: 'bucket_instance_dimension_unique' },
);
BusApiMetricSchema.index(
  { provider: 1, operation: 1, bucketStart: 1 },
  { name: 'metric_dimension_bucket_start' },
);
```

Build Mongo `$match` from trusted resolved filters only:

```ts
private rangeMatch(start: Date, end: Date, filter?: MetricDimensionFilter) {
  return {
    bucketStart: { $gte: start, $lt: end },
    ...(filter?.providers.length
      ? { provider: { $in: filter.providers } }
      : {}),
    ...(filter?.operations.length
      ? { operation: { $in: filter.operations } }
      : {}),
  };
}
```

Project weekday after grouping:

```ts
{
  $project: {
    _id: 0,
    start: '$_id',
    weekday: {
      $isoDayOfWeek: { date: '$_id', timezone: 'Asia/Seoul' },
    },
    requestCount: 1,
    errorCount: 1,
  },
}
```

Update `upsertBucket()` filter to include `provider` and `operation`. Apply the optional filter to `sumSince`, `aggregateSeries`, and `findLastCollectedAt`.

- [ ] **Step 5: Run repository tests and full metric repository regression**

Run:

```bash
npm test -- --runInBand --no-watchman src/bus-api-metric/bus-api-metric.repository.spec.ts
```

Expected: all repository tests PASS, including Sunday `7`, Monday `1`, filtered sums, multi-instance sums, and exact indexes.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/bus-api-metric/bus-api-metric.dimension.ts src/bus-api-metric/bus-api-metric.schema.ts src/bus-api-metric/bus-api-metric.repository.ts src/bus-api-metric/bus-api-metric.repository.spec.ts
git commit -m "[Feat] 버스 API 메트릭 분류 스키마 추가"
```

### Task 2: Dimension-Aware Recorder and Bus API Instrumentation

**Files:**

- Modify: `src/bus-api-metric/bus-api-metric.service.ts`
- Modify: `src/bus-api-metric/bus-api-metric.service.spec.ts`
- Modify: `src/bus-info/bus-info.service.ts`
- Modify: `src/bus-info/bus-info.service.spec.ts`
- Modify: `src/regular-alarm/regular-alarm.service.spec.ts`
- Modify: `test/app.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1 `BusApiMetricIdentity`, `SEOUL_BUS_ARRIVAL_METRIC`, and dimension-aware `StoredMetricBucket`.
- Produces: `recordRequest(identity: BusApiMetricIdentity, at?: Date): void` and `recordError(identity: BusApiMetricIdentity, at?: Date): void` with independent minute buckets.

- [ ] **Step 1: Write failing recorder and BusInfo identity tests**

Update service calls and add a separation test:

```ts
service.recordRequest(
  { provider: 'seoul-bus', operation: 'bus-arrival' },
  new Date('2026-10-05T00:00:10.000Z'),
);
service.recordRequest(
  { provider: 'seoul-bus', operation: 'route-info' },
  new Date('2026-10-05T00:00:20.000Z'),
);
await service.flushCompletedBuckets(new Date('2026-10-05T00:01:00.000Z'));

expect(repository.saved).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ operation: 'bus-arrival', requestCount: 1 }),
    expect.objectContaining({ operation: 'route-info', requestCount: 1 }),
  ]),
);
```

Change the BusInfo test recorder to capture identity and timestamp:

```ts
requests: Array<{ identity: BusApiMetricIdentity; at: Date }> = [];

recordRequest(identity: BusApiMetricIdentity, at: Date): void {
  this.events.push('metric');
  this.requests.push({ identity, at });
}
```

Assert every request and error uses `SEOUL_BUS_ARRIVAL_METRIC` and preserves the same `startedAt` instance.

- [ ] **Step 2: Run recorder and BusInfo tests and confirm RED**

Run:

```bash
npm test -- --runInBand --no-watchman src/bus-api-metric/bus-api-metric.service.spec.ts src/bus-info/bus-info.service.spec.ts
```

Expected: signature/type failures and one-bucket behavior instead of dimension separation.

- [ ] **Step 3: Key in-memory buckets by minute and dimension**

Store identity and minute in each mutable bucket:

```ts
type MutableBucket = BusApiMetricIdentity & {
  bucketStart: number;
  requestCount: number;
  errorCount: number;
  flushedRequestCount: number;
  flushedErrorCount: number;
};

private bucketKey(identity: BusApiMetricIdentity, minute: number): string {
  return `${minute}\u0000${identity.provider}\u0000${identity.operation}`;
}
```

Change public signatures and preserve failure isolation:

```ts
recordRequest(identity: BusApiMetricIdentity, at = new Date()): void {
  try {
    this.bucketFor(identity, at).requestCount += 1;
    this.trimPendingBuckets();
  } catch {
    this.logger.error('Failed to record bus API request metric');
  }
}
```

Scale pending capacity by registered dimension count:

```ts
const maxPendingBuckets =
  MAX_PENDING_BUCKETS_PER_DIMENSION * BUS_API_METRIC_DIMENSIONS.length;
```

Flush `bucketStart`, `provider`, and `operation` from the stored bucket rather than parsing the map key. Existing clean-eviction, retry, shutdown, and serialized-flush behavior must remain unchanged.

- [ ] **Step 4: Instrument BusInfo with the registered identity**

```ts
const startedAt = new Date();
this.metricRecorder.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
```

Use the same identity and `startedAt` in the catch path. Update RegularAlarm and E2E test doubles to accept the new first argument. In shutdown E2E, query the stored document with `provider` and `operation` assertions.

- [ ] **Step 5: Run focused and shutdown lifecycle tests**

Run:

```bash
npm test -- --runInBand --no-watchman src/bus-api-metric/bus-api-metric.service.spec.ts src/bus-info/bus-info.service.spec.ts src/regular-alarm/regular-alarm.service.spec.ts
npm run test:e2e -- --runInBand --no-watchman
```

Expected: focused unit suites and four E2E tests PASS; shutdown document contains the approved dimension.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/bus-api-metric/bus-api-metric.service.ts src/bus-api-metric/bus-api-metric.service.spec.ts src/bus-info/bus-info.service.ts src/bus-info/bus-info.service.spec.ts src/regular-alarm/regular-alarm.service.spec.ts test/app.e2e-spec.ts
git commit -m "[Feat] 버스 API 호출 분류별 메트릭 기록"
```

### Task 3: Dashboard Dimension Catalog and Validated Metric Query

**Files:**

- Create: `src/dashboard/dto/dashboard-metric.query.dto.ts`
- Delete: `src/dashboard/dto/dashboard-range.query.dto.ts`
- Modify: `src/dashboard/dashboard.controller.ts`
- Modify: `src/dashboard/dashboard.controller.spec.ts`
- Modify: `src/dashboard/dashboard-metric.service.ts`
- Modify: `src/dashboard/dashboard-metric.service.spec.ts`

**Interfaces:**

- Consumes: Task 1 registry catalog, filter resolver, filtered repository methods, and `MetricPoint.weekday`.
- Produces: authenticated `GET /api/dashboard/metric-dimensions`; `DashboardMetricQueryDto`; metrics response `filters` and series `weekday`.

- [ ] **Step 1: Write controller validation and catalog tests**

Change the metric-service mock to capture arguments. Add authenticated endpoint tests for exact catalog response and query parsing:

```ts
await request(app.getHttpServer())
  .get('/api/dashboard/metric-dimensions')
  .set('Cookie', sessionCookie())
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

await request(app.getHttpServer())
  .get(
    '/api/dashboard/metrics?range=30d&providers=seoul-bus&operations=bus-arrival',
  )
  .set('Cookie', sessionCookie())
  .expect(200);

expect(metricService.getMetrics).toHaveBeenCalledWith('30d', {
  providers: ['seoul-bus'],
  operations: ['bus-arrival'],
});
```

Add separate `400` cases for:

- `providers=unknown`
- `operations=unknown`
- `providers=`
- `providers=seoul-bus,,seoul-bus`
- repeated `providers=seoul-bus&providers=seoul-bus`
- a value longer than 256 characters
- a registered provider and operation combination with no matching registry pair once a second test-only registry entry is supplied to the pure resolver test

Add `401` coverage for `/metric-dimensions`.

- [ ] **Step 2: Write service response and global-summary tests**

Seed multiple dimensions around a Seoul weekday boundary. Assert:

```ts
expect(result.filters).toEqual({
  providers: ['seoul-bus'],
  operations: ['bus-arrival'],
});
expect(result.summary.todayRequests).toBe(allDimensionsToday);
expect(result.summary.rangeRequests).toBe(selectedDimensionRange);
expect(result.series).toEqual(
  expect.arrayContaining([expect.objectContaining({ weekday: 1 })]),
);
```

Also assert `lastCollectedAt` uses the selected dimension while today/month repository calls remain unfiltered.

- [ ] **Step 3: Run Dashboard backend tests and confirm RED**

Run:

```bash
npm test -- --runInBand --no-watchman src/dashboard/dashboard.controller.spec.ts src/dashboard/dashboard-metric.service.spec.ts
```

Expected: missing endpoint/DTO fields and old service signature/response failures.

- [ ] **Step 4: Implement strict CSV transformation and validation**

Create `dashboard-metric.query.dto.ts`:

```ts
const MAX_FILTER_LENGTH = 256;

function parseCsvFilter(value: unknown): string[] | { invalid: true } {
  if (typeof value !== 'string' || value.length > MAX_FILTER_LENGTH) {
    return { invalid: true };
  }
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    return [];
  }
  return [...new Set(tokens)];
}

export class DashboardMetricQueryDto {
  @IsIn(DASHBOARD_RANGES)
  range: DashboardRange;

  @IsOptional()
  @Transform(({ value }) => parseCsvFilter(value))
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(METRIC_PROVIDER_KEYS, { each: true })
  providers?: string[];

  @IsOptional()
  @Transform(({ value }) => parseCsvFilter(value))
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(METRIC_OPERATION_KEYS, { each: true })
  operations?: string[];
}
```

Deduplication is accepted; empty tokens, arrays from repeated query keys, excessive strings, and unknown keys fail validation. Resolve cross-field compatibility in `DashboardMetricService` and throw `BadRequestException('Invalid metric dimension filter')` when the resolver returns `null`.

- [ ] **Step 5: Add catalog endpoint and filtered response**

Controller:

```ts
@UseGuards(DashboardAuthGuard)
@Get('metric-dimensions')
metricDimensions() {
  return this.metricService.getDimensions();
}

@UseGuards(DashboardAuthGuard)
@Get('metrics')
metrics(@Query() query: DashboardMetricQueryDto) {
  return this.metricService.getMetrics(query.range, {
    providers: query.providers,
    operations: query.operations,
  });
}
```

Service behavior:

- Resolve the filter against registry.
- Call `sumSince(todayStart, now)` and `sumSince(monthStart, now)` without a filter.
- Call range sum, series aggregation, and last-collected lookup with the resolved filter.
- Echo resolved keys under `filters`.
- Copy repository `weekday` to every serialized series point.

- [ ] **Step 6: Run Dashboard backend and all repository tests**

Run:

```bash
npm test -- --runInBand --no-watchman src/dashboard/dashboard.controller.spec.ts src/dashboard/dashboard-metric.service.spec.ts src/bus-api-metric/bus-api-metric.repository.spec.ts
```

Expected: endpoint authentication, validation matrix, global cards, filtered range, weekday values, and empty data cases PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/dashboard/dto/dashboard-metric.query.dto.ts src/dashboard/dto/dashboard-range.query.dto.ts src/dashboard/dashboard.controller.ts src/dashboard/dashboard.controller.spec.ts src/dashboard/dashboard-metric.service.ts src/dashboard/dashboard-metric.service.spec.ts
git commit -m "[Feat] 대시보드 API 분류 필터 추가"
```

### Task 4: Dashboard Multi-Weekday and API Dimension Controls

**Files:**

- Modify: `../dashboard/index.html`
- Modify: `../dashboard/dashboard.css`
- Modify: `../dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard-assets.spec.ts`

**Interfaces:**

- Consumes: Task 3 catalog endpoint and metrics `filters`, `series[].weekday`, and summary contract.
- Produces: pure `normalizeDimensionCatalog`, `filterSeriesByWeekdays`, `summarizeSeries`, and `buildMetricsQuery`; mounted accessible weekday presets/toggles and dimension checkboxes.

- [ ] **Step 1: Add pure helper tests before DOM changes**

Extend `SeriesPoint` with `weekday`. Test exact behavior:

```ts
expect(filterSeriesByWeekdays(series, [1, 3, 5])).toEqual([
  expect.objectContaining({ weekday: 1 }),
  expect.objectContaining({ weekday: 3 }),
]);

expect(summarizeSeries([{ requestCount: 0, errorCount: 2 }])).toEqual({
  requestCount: 0,
  errorCount: 2,
  errorRate: 0,
});

expect(buildMetricsQuery('30d', ['seoul-bus'], ['bus-arrival'])).toBe(
  '/metrics?range=30d&providers=seoul-bus&operations=bus-arrival',
);
```

`normalizeDimensionCatalog` must discard malformed entries, deduplicate keys, preserve text labels as strings, and keep operations grouped under providers.

- [ ] **Step 2: Add mounted interaction tests and confirm RED**

Extend `FakeDocument` with filter elements and checkbox behavior. Add tests proving:

- Catalog is fetched after authenticated session and controls are created with text content.
- Monday plus Wednesday arbitrary selection filters cached points and performs zero new fetches.
- `평일`, `주말`, and `전체` select exact ISO weekday sets.
- Last selected weekday/provider/operation cannot be deselected.
- Provider selection hides unrelated operations and preserves compatible checked operations.
- Apply performs one encoded metrics request; weekday changes perform none.
- Range change preserves applied provider/operation filters.
- Rapid Apply then range change ignores the earlier response.
- Catalog failure disables dimension controls and still requests unfiltered metrics.
- Empty selected-weekday series produces zero selected-period cards, finite `0.00%`, and empty chart state.

Run:

```bash
npm test -- --runInBand --no-watchman src/dashboard/dashboard-assets.spec.ts
```

Expected: helper exports, required DOM IDs, catalog request, and mounted behavior tests fail.

- [ ] **Step 3: Add accessible filter markup**

Add one filter panel before the chart container:

```html
<section class="metric-filters" aria-labelledby="metric-filter-title">
  <div class="filter-heading">
    <h3 id="metric-filter-title">조회 필터</h3>
    <button id="filter-reset" class="secondary" type="button">초기화</button>
  </div>
  <fieldset>
    <legend>요일</legend>
    <div class="filter-presets" aria-label="요일 빠른 선택">
      <button type="button" data-weekday-preset="all">전체</button>
      <button type="button" data-weekday-preset="weekday">평일</button>
      <button type="button" data-weekday-preset="weekend">주말</button>
    </div>
    <div id="weekday-filters" class="filter-options"></div>
  </fieldset>
  <fieldset>
    <legend>제공기관</legend>
    <div id="provider-filters" class="filter-options"></div>
  </fieldset>
  <fieldset>
    <legend>호출 API</legend>
    <div id="operation-filters" class="filter-options"></div>
  </fieldset>
  <button id="filter-apply" type="button">필터 적용</button>
</section>
```

Create checkbox labels via `createElement`, `textContent`, `htmlFor`, and `appendChild`; never use `innerHTML` with catalog data.

- [ ] **Step 4: Implement pure filter state and local weekday rendering**

Add pure helpers:

```js
function filterSeriesByWeekdays(series, weekdays) {
  const selected = new Set(weekdays);
  return normalizeMetrics({ series: series }).series.filter(function (point) {
    return selected.has(point.weekday);
  });
}

function summarizeSeries(series) {
  const totals = series.reduce(
    function (summary, point) {
      summary.requestCount += safeNumber(point.requestCount);
      summary.errorCount += safeNumber(point.errorCount);
      return summary;
    },
    { requestCount: 0, errorCount: 0 },
  );
  return {
    requestCount: totals.requestCount,
    errorCount: totals.errorCount,
    errorRate: calculateErrorRate(totals.requestCount, totals.errorCount),
  };
}
```

`normalizeMetrics` must retain only integer weekdays 1 through 7. Store the most recent normalized server payload. `renderMetrics()` keeps global today/month values, filters cached series by selected weekdays, derives selected-period cards with `summarizeSeries`, and passes filtered points to the existing Chart.js renderer.

- [ ] **Step 5: Implement catalog and dimension request flow**

Use state with separate draft and applied dimension selections:

```js
const filterState = {
  weekdays: new Set([1, 2, 3, 4, 5, 6, 7]),
  draftProviders: new Set(),
  draftOperations: new Set(),
  appliedProviders: [],
  appliedOperations: [],
  catalog: { providers: [] },
  metrics: null,
};
```

`loadDimensions()` fetches `/metric-dimensions`, normalizes it, selects all entries, and renders controls. On failure, disable dimension fieldsets and leave applied arrays empty so `buildMetricsQuery()` omits those query parameters. `loadMetrics()` uses current range plus applied dimensions and the existing request-generation guard. Apply copies compatible draft sets to arrays then calls `loadMetrics()` once. Weekday buttons only call local rendering.

- [ ] **Step 6: Style responsive controls without changing chart sizing**

Add grid/flex rules for `.metric-filters`, `.filter-options`, `.filter-option`, and `.filter-presets`. Requirements:

- Visible keyboard focus uses existing button/input focus colors.
- Checkbox labels have at least 40px control height.
- Desktop provider and operation groups can share rows.
- At `max-width: 640px`, groups stack and buttons wrap without horizontal overflow.
- Keep existing chart heights 360px desktop and 280px mobile.
- Disabled catalog controls remain legible and expose `disabled` on their native inputs/buttons.

- [ ] **Step 7: Run asset tests, formatting, and build**

Run:

```bash
npm test -- --runInBand --no-watchman src/dashboard/dashboard-assets.spec.ts
npx prettier --check "src/**/*.ts" "test/**/*.ts" "../dashboard/*.{html,js,css}"
npm run build
```

Expected: all asset tests PASS, Prettier exits 0, build exits 0 with only the existing TypeScript `getMutableClone` deprecation warning.

- [ ] **Step 8: Commit Task 4**

```bash
git add ../dashboard/index.html ../dashboard/dashboard.css ../dashboard/dashboard.js src/dashboard/dashboard-assets.spec.ts
git commit -m "[Feat] 대시보드 요일 및 API 분류 필터 추가"
```

### Task 5: Operations Documentation and Whole-Feature Verification

**Files:**

- Modify: `docs/operations/dashboard-nginx-deployment.md`
- Modify: `test/app.e2e-spec.ts` only if the catalog/metrics HTTP contract lacks end-to-end coverage after Task 3

**Interfaces:**

- Consumes: completed schema, recorder, endpoints, and browser controls from Tasks 1–4.
- Produces: deploy/runbook instructions and evidence that no old contract or security boundary regressed.

- [ ] **Step 1: Add deployment and data reset instructions**

Document:

- Final MongoDB document and four indexes.
- `provider=seoul-bus`, `operation=bus-arrival` initial identity.
- Authenticated `/metric-dimensions` endpoint and filtered metrics examples.
- No `weekdays` query; `weekday` lives in series response.
- Local-only reset command targets `WhereMyBus.bus_api_metrics`; warn operators not to run it against a remote host.
- No production migration because the old metric schema was never deployed.
- Post-deploy `getIndexes()` and sample response checks.

- [ ] **Step 2: Run non-mutating static checks**

Run:

```bash
npx prettier --check "src/**/*.ts" "test/**/*.ts" "../dashboard/*.{html,js,css}" "docs/**/*.md"
npx eslint "{src,apps,libs,test}/**/*.ts"
git diff --check
rg -n "DASHBOARD_(ACCESS_CODE|SESSION_SECRET)=[^<]" ../dashboard src docs/operations
```

Expected: formatting and whitespace checks exit 0; ESLint has no errors; secret assignment scan returns no matches.

- [ ] **Step 3: Run complete automated regression**

Run:

```bash
npm test -- --runInBand --no-watchman
npm run test:e2e -- --runInBand --no-watchman
npm run build
```

Expected: every unit and E2E suite passes; build succeeds with no new warning class.

- [ ] **Step 4: Run local real-browser smoke with disposable data**

Start the built `AppModule` against MongoMemoryServer on unused loopback ports with ephemeral Dashboard credentials. Serve repository static files through `http-server` proxying `/api/dashboard` to the temporary backend. Use installed Chromium and real Chart.js 4.5.1 to verify:

1. Login succeeds and catalog renders 서울 버스 / 버스 도착 정보.
2. All four ranges return 200 and charts render.
3. Monday plus Wednesday selection changes cards/chart without a new metrics request.
4. 평일, 주말, 전체 presets select exact weekdays and use cached data.
5. Provider or operation Apply performs exactly one metrics request with encoded query.
6. Empty weekday result shows zero cards and empty chart state.
7. 390px viewport has no horizontal overflow.
8. Refresh, reload/session restore, and logout still work.
9. Browser storage and console contain no access code or session value.
10. Temporary Chromium, backend, proxy, and MongoDB processes close after the run.

Retain sanitized JSON results and desktop/mobile screenshots under a fresh `/private/tmp/wmb-dashboard-dimension-smoke.*` directory for review.

- [ ] **Step 5: Commit documentation or test corrections**

```bash
git add docs/operations/dashboard-nginx-deployment.md test/app.e2e-spec.ts
git commit -m "[Docs] 대시보드 메트릭 필터 운영 절차 추가"
```

If `test/app.e2e-spec.ts` required no Task 5 change, stage only the operations document. Do not create an empty commit.

- [ ] **Step 6: Review final branch state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: tracked checkout clean; feature commits are local until the user explicitly requests push or PR mutation.
