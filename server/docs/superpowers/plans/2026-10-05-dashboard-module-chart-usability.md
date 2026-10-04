# Dashboard Module Separation and Chart Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Dashboard backend responsibilities from metric recording and replace the unreadable custom SVG with an interactive, resilient Chart.js request/error chart.

**Architecture:** `BusApiMetricModule` retains MongoDB persistence and request recording, `DashboardAuthModule` owns developer-code authentication, and `DashboardModule` explicitly owns Dashboard routes and presentation. Static Dashboard code consumes the unchanged API and renders a version-pinned Chart.js canvas through testable pure configuration helpers and an injected chart lifecycle manager.

**Tech Stack:** NestJS 8, TypeScript, Mongoose 8, Jest 28, Supertest, mongodb-memory-server, browser JavaScript, HTML/CSS, Chart.js 4.5.1 from jsDelivr

**Spec:** `docs/superpowers/specs/2026-10-02-dashboard-module-separation-design.md`; `docs/superpowers/specs/2026-10-05-dashboard-chart-usability-design.md`

## Global Constraints

- Preserve `POST /api/dashboard/auth`, `GET /api/dashboard/session`, `GET /api/dashboard/metrics`, and `POST /api/dashboard/logout` contracts.
- Preserve cookie name, flags, TTL, path, login policy, metric schema, aggregation, cron schedule, and environment variable names.
- Keep Dashboard registration explicit in `AppModule`; importing `BusApiMetricModule` alone must not register Dashboard routes.
- Do not use circular dependencies or `forwardRef`.
- Do not add an npm runtime dependency for Chart.js.
- Load only `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js` with SHA-384 SRI and `crossorigin="anonymous"`.
- Keep summary cards and authentication operational when chart rendering fails.
- Preserve sparse timestamp spacing with a numeric time axis; do not equally space missing buckets as categories.
- Do not expose access codes, session secrets, cookies, device tokens, service keys, or raw error bodies.
- Keep comments minimal; express ownership through module and function boundaries.

## Review Focus

- Malformed or unsorted timestamps must not create `NaN` coordinates or a descending chart; Task 3 adds filtering and sorting coverage.
- A point with zero requests and nonzero errors must render a finite `0.00%` tooltip rate; Task 3 adds zero-denominator coverage.
- Repeated refreshes and range changes must leave exactly one live Chart instance; Task 4 adds destroy-before-replace coverage.
- Empty data after populated data must destroy the old chart and show the empty state; Task 4 adds transition coverage.
- Missing or initially throwing CDN constructor must not break summary cards and a later render must recover; Task 4 adds failure-and-recovery coverage.

---

### Task 1: Extract Dashboard authentication module

**Files:**

- Create: `src/dashboard/auth/dashboard-auth.module.ts`
- Move: `src/bus-api-metric/dashboard-auth.service.ts` → `src/dashboard/auth/dashboard-auth.service.ts`
- Move: `src/bus-api-metric/dashboard-auth.guard.ts` → `src/dashboard/auth/dashboard-auth.guard.ts`
- Move: `src/bus-api-metric/dashboard-login-attempt-limiter.ts` → `src/dashboard/auth/dashboard-login-attempt-limiter.ts`
- Move: `src/bus-api-metric/dto/dashboard-auth.request.dto.ts` → `src/dashboard/auth/dto/dashboard-auth.request.dto.ts`
- Move: `src/bus-api-metric/dashboard-auth.service.spec.ts` → `src/dashboard/auth/dashboard-auth.service.spec.ts`
- Move: `src/bus-api-metric/dashboard-auth.guard.spec.ts` → `src/dashboard/auth/dashboard-auth.guard.spec.ts`
- Move: `src/bus-api-metric/dashboard-login-attempt-limiter.spec.ts` → `src/dashboard/auth/dashboard-login-attempt-limiter.spec.ts`
- Modify: `src/bus-api-metric/bus-api-metric.module.ts`
- Modify imports in: `src/bus-api-metric/bus-api-metric.controller.ts`
- Modify imports in: `src/bus-api-metric/bus-api-metric.controller.spec.ts`

**Interfaces:**

- Consumes: `ConfigService` keys `DASHBOARD_ENABLED`, `DASHBOARD_ACCESS_CODE`, `DASHBOARD_SESSION_SECRET`, `DASHBOARD_SESSION_TTL_SECONDS`, `DASHBOARD_LOGIN_MAX_ATTEMPTS`, and `DASHBOARD_LOGIN_WINDOW_SECONDS`.
- Produces: `DashboardAuthModule`; exported `DashboardAuthService`; exported `DashboardAuthGuard`; `DashboardLoginAttemptLimiter.hasReachedLimit(ip: string, now: Date): boolean`; `recordFailure(ip: string, now: Date): void`; `reset(ip: string): void`.

- [ ] **Step 1: Add failing dependency-injection tests**

In the current auth service spec, replace direct construction with an injected limiter mock and assert delegation:

```typescript
const limiter = {
  hasReachedLimit: jest.fn().mockReturnValue(false),
  recordFailure: jest.fn(),
  reset: jest.fn(),
} as unknown as DashboardLoginAttemptLimiter;

const service = new DashboardAuthService(configService, limiter);

expect(() =>
  service.authenticate('wrong-code', '127.0.0.1', new Date(0)),
).toThrow('Dashboard authentication failed');

expect(limiter.hasReachedLimit).toHaveBeenCalledWith('127.0.0.1', new Date(0));
expect(limiter.recordFailure).toHaveBeenCalledWith('127.0.0.1', new Date(0));
```

Add a limiter configuration test using `ConfigService`:

```typescript
const limiter = new DashboardLoginAttemptLimiter(
  new ConfigService({
    DASHBOARD_LOGIN_MAX_ATTEMPTS: '2',
    DASHBOARD_LOGIN_WINDOW_SECONDS: '10',
  }),
);

limiter.recordFailure('127.0.0.1', new Date(0));
limiter.recordFailure('127.0.0.1', new Date(1));

expect(limiter.hasReachedLimit('127.0.0.1', new Date(2))).toBe(true);
```

Update the other limiter tests through one explicit helper:

```typescript
function createLimiter(maxAttempts = 1, windowSeconds = 10) {
  return new DashboardLoginAttemptLimiter(
    new ConfigService({
      DASHBOARD_LOGIN_MAX_ATTEMPTS: String(maxAttempts),
      DASHBOARD_LOGIN_WINDOW_SECONDS: String(windowSeconds),
    }),
  );
}
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- --runInBand dashboard-auth.service.spec.ts dashboard-login-attempt-limiter.spec.ts
```

Expected: FAIL because `DashboardAuthService` does not accept a limiter and `DashboardLoginAttemptLimiter` does not accept `ConfigService`.

- [ ] **Step 3: Inject limiter and move policy configuration into it**

Make limiter injectable and own its configuration:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 900;
const DEFAULT_MAX_TRACKED_IPS = 10_000;

@Injectable()
export class DashboardLoginAttemptLimiter {
  private readonly attemptsByIp = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMilliseconds: number;
  private readonly maxTrackedIps = DEFAULT_MAX_TRACKED_IPS;

  constructor(configService: ConfigService) {
    this.maxAttempts = this.positiveInteger(
      configService.get<string>('DASHBOARD_LOGIN_MAX_ATTEMPTS'),
      DEFAULT_LOGIN_MAX_ATTEMPTS,
    );
    this.windowMilliseconds =
      this.positiveInteger(
        configService.get<string>('DASHBOARD_LOGIN_WINDOW_SECONDS'),
        DEFAULT_LOGIN_WINDOW_SECONDS,
      ) * 1_000;
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const configured = Number(value);
    return Number.isInteger(configured) && configured > 0
      ? configured
      : fallback;
  }
}
```

Change auth service construction:

```typescript
constructor(
  private readonly configService: ConfigService,
  private readonly loginAttemptLimiter: DashboardLoginAttemptLimiter,
) {}
```

Remove login-attempt configuration getters and direct limiter construction from `DashboardAuthService`.
Update the retained-IP-bound test to record `10_001` distinct IPs through the
public API, then assert the oldest IP was evicted. Do not add a production-only
constructor parameter for the test.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
npm test -- --runInBand dashboard-auth.service.spec.ts dashboard-auth.guard.spec.ts dashboard-login-attempt-limiter.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Move auth files and create module**

Create:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardLoginAttemptLimiter } from './dashboard-login-attempt-limiter';

@Module({
  imports: [ConfigModule],
  providers: [
    DashboardAuthService,
    DashboardAuthGuard,
    DashboardLoginAttemptLimiter,
  ],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class DashboardAuthModule {}
```

Temporarily import `DashboardAuthModule` from `BusApiMetricModule`, keep the existing controller registered there, and remove auth providers from its `providers` array. Update all moved relative imports.

Update the controller unit-test module to import
the following configuration and `DashboardAuthModule`; remove direct auth
service and guard declarations from its providers. Retrieve
`DashboardAuthService` from the compiled module as before.

```typescript
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
```

- [ ] **Step 6: Verify moved auth boundary**

Run:

```bash
npm test -- --runInBand dashboard-auth.service.spec.ts dashboard-auth.guard.spec.ts dashboard-login-attempt-limiter.spec.ts bus-api-metric.controller.spec.ts
npm run build
```

Expected: all selected suites PASS and build exits `0`.

- [ ] **Step 7: Commit auth extraction**

```bash
git add src/dashboard/auth src/bus-api-metric
git commit -m "[Refactor] 대시보드 인증 모듈 분리"
```

### Task 2: Extract Dashboard presentation module and explicit route ownership

**Files:**

- Create: `src/dashboard/dashboard.module.ts`
- Create: `src/dashboard/dashboard.module.spec.ts`
- Move: `src/bus-api-metric/bus-api-metric.controller.ts` → `src/dashboard/dashboard.controller.ts`
- Move: `src/bus-api-metric/bus-api-metric.controller.spec.ts` → `src/dashboard/dashboard.controller.spec.ts`
- Move: `src/bus-api-metric/dashboard-metric.service.ts` → `src/dashboard/dashboard-metric.service.ts`
- Move: `src/bus-api-metric/dashboard-metric.service.spec.ts` → `src/dashboard/dashboard-metric.service.spec.ts`
- Move: `src/bus-api-metric/dashboard-assets.spec.ts` → `src/dashboard/dashboard-assets.spec.ts`
- Move: `src/bus-api-metric/dto/dashboard-range.query.dto.ts` → `src/dashboard/dto/dashboard-range.query.dto.ts`
- Modify: `src/bus-api-metric/bus-api-metric.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**

- Consumes: exported `BusApiMetricRepository` from `BusApiMetricModule`; exported `DashboardAuthService` and `DashboardAuthGuard` from `DashboardAuthModule`.
- Produces: `DashboardModule`; `DashboardController` at `api/dashboard`; unchanged `DashboardMetricsResponse`; explicit `AppModule → DashboardModule` route registration.

- [ ] **Step 1: Write failing module-boundary test**

Create `src/dashboard/dashboard.module.spec.ts` with mongodb-memory-server setup and assertions:

```typescript
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { BusApiMetricModule } from '../bus-api-metric/bus-api-metric.module';
import { DashboardController } from './dashboard.controller';
import { DashboardMetricService } from './dashboard-metric.service';
import { DashboardModule } from './dashboard.module';

it('DashboardModule이 route와 presentation provider를 소유한다', async () => {
  const mongo = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1' },
  });
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true }),
      MongooseModule.forRoot(mongo.getUri()),
      DashboardModule,
    ],
  }).compile();

  expect(module.get(DashboardController)).toBeDefined();
  expect(module.get(DashboardMetricService)).toBeDefined();
  expect(
    Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BusApiMetricModule) ?? [],
  ).toEqual([]);

  await module.close();
  await mongo.stop();
});
```

- [ ] **Step 2: Run boundary test and confirm RED**

Run:

```bash
npm test -- --runInBand dashboard.module.spec.ts
```

Expected: FAIL because `src/dashboard/dashboard.module.ts`, controller, and metric service do not exist.

- [ ] **Step 3: Move presentation files and create DashboardModule**

Create:

```typescript
import { Module } from '@nestjs/common';
import { BusApiMetricModule } from '../bus-api-metric/bus-api-metric.module';
import { DashboardAuthModule } from './auth/dashboard-auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardMetricService } from './dashboard-metric.service';

@Module({
  imports: [BusApiMetricModule, DashboardAuthModule],
  controllers: [DashboardController],
  providers: [DashboardMetricService],
})
export class DashboardModule {}
```

Rename the controller class from `BusApiMetricController` to `DashboardController`. Keep `@Controller('api/dashboard')` and every handler unchanged.

Reduce metric module to:

```typescript
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BusApiMetric.name, schema: BusApiMetricSchema },
    ]),
  ],
  providers: [BusApiMetricRepository, BusApiMetricService],
  exports: [BusApiMetricRepository, BusApiMetricService],
})
export class BusApiMetricModule {}
```

Import `DashboardModule` directly in `AppModule`. Keep `BusInfoModule` importing `BusApiMetricModule` for recorder injection.

- [ ] **Step 4: Update moved tests and imports**

Update test descriptions and symbols to `DashboardController`. Keep all response, cookie, validation, race, and aggregation assertions unchanged. Keep the asset path from the moved spec at:

```typescript
resolve(__dirname, '../../../dashboard/dashboard.js');
```

Update Dashboard service import of repository to:

```typescript
import {
  BusApiMetricRepository,
  MetricUnit,
} from '../bus-api-metric/bus-api-metric.repository';
```

- [ ] **Step 5: Verify module separation GREEN**

Run:

```bash
npm test -- --runInBand dashboard.module.spec.ts dashboard.controller.spec.ts dashboard-metric.service.spec.ts dashboard-auth.service.spec.ts dashboard-auth.guard.spec.ts dashboard-login-attempt-limiter.spec.ts bus-api-metric.service.spec.ts bus-api-metric.repository.spec.ts bus-info.service.spec.ts
npm run test:e2e -- --runInBand
npm run build
```

Expected: all selected unit suites PASS, E2E PASS, build exits `0`.

- [ ] **Step 6: Confirm dependency direction statically**

Run:

```bash
rg -n "dashboard" src/bus-api-metric src/bus-info
rg -n "BusApiMetricModule|DashboardModule" src/app.module.ts src/bus-info/bus-info.module.ts src/dashboard/dashboard.module.ts
```

Expected: no Dashboard imports remain under `src/bus-api-metric` or `src/bus-info`; `AppModule` imports `DashboardModule`; `BusInfoModule` and `DashboardModule` independently import `BusApiMetricModule`.

- [ ] **Step 7: Commit presentation extraction**

```bash
git add src/app.module.ts src/bus-api-metric src/dashboard
git commit -m "[Refactor] 대시보드 표시 모듈 분리"
```

### Task 3: Build pure Chart.js data and configuration helpers

**Files:**

- Modify: `../dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard-assets.spec.ts`

**Interfaces:**

- Consumes: normalized `series: Array<{ start: string; requestCount: number; errorCount: number }>` and range union `'24h' | '7d' | '30d' | '90d'`.
- Produces: `prepareChartSeries(series)` sorted finite-timestamp points; `formatChartTimestamp(timestamp, range, includeTime)`; `calculateErrorRate(requestCount, errorCount)`; `buildChartConfig(series, range, reducedMotion)`.

- [ ] **Step 1: Replace SVG helper tests with failing chart configuration tests**

Export and test these helpers:

```typescript
const {
  prepareChartSeries,
  formatChartTimestamp,
  calculateErrorRate,
  buildChartConfig,
} = dashboardModule.exports;
```

Add assertions:

```typescript
expect(
  prepareChartSeries([
    { start: 'invalid', requestCount: 100, errorCount: 2 },
    { start: '2026-10-02T00:00:00+09:00', requestCount: 2, errorCount: 0 },
    { start: '2026-10-01T00:00:00+09:00', requestCount: 1, errorCount: 1 },
  ]).map(({ requestCount }) => requestCount),
).toEqual([1, 2]);

expect(calculateErrorRate(0, 3)).toBe(0);
expect(calculateErrorRate(4, 1)).toBe(0.25);

const config = buildChartConfig(
  [
    {
      start: '2026-10-01T00:00:00+09:00',
      requestCount: 12,
      errorCount: 2,
    },
  ],
  '24h',
  true,
);

expect(config.type).toBe('line');
expect(config.data.datasets).toHaveLength(2);
expect(config.data.datasets[0].label).toBe('요청');
expect(config.data.datasets[1].label).toBe('오류');
expect(config.data.datasets[1].borderDash).toEqual([6, 4]);
expect(config.options.scales.x.type).toBe('linear');
expect(config.options.scales.y.beginAtZero).toBe(true);
expect(config.options.animation).toBe(false);
```

Invoke tooltip callbacks with a zero-request point and assert all returned strings contain finite values and `오류율: 0.00%`.

Pin range label behavior with:

```typescript
it.each([
  ['24h', '10. 1. 00:00'],
  ['7d', '10. 1. 00시'],
  ['30d', '10. 1.'],
  ['90d', '10. 1.'],
])('%s 축 라벨을 기간 밀도에 맞게 표시한다', (range, expected) => {
  expect(
    formatChartTimestamp(Date.parse('2026-10-01T00:00:00+09:00'), range, false),
  ).toBe(expected);
});
```

These strings are checked `Intl.DateTimeFormat('ko-KR')` output; do not
normalize them through browser sniffing.

- [ ] **Step 2: Run helper tests and confirm RED**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts
```

Expected: FAIL because Chart.js helpers are not exported and SVG helpers still define the chart.

- [ ] **Step 3: Implement normalized time points and formatters**

Use numeric timestamps to preserve sparse spacing:

```javascript
function prepareChartSeries(series) {
  return (Array.isArray(series) ? series : [])
    .map(function (point) {
      return {
        timestamp: Date.parse(point.start),
        start: point.start,
        requestCount: safeNumber(point.requestCount),
        errorCount: safeNumber(point.errorCount),
      };
    })
    .filter(function (point) {
      return Number.isFinite(point.timestamp);
    })
    .sort(function (left, right) {
      return left.timestamp - right.timestamp;
    });
}

function calculateErrorRate(requestCount, errorCount) {
  const requests = safeNumber(requestCount);
  return requests === 0 ? 0 : safeNumber(errorCount) / requests;
}
```

Format timestamps with `Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ... })`; `24h` includes hour/minute, `7d` includes month/day and hour, and daily ranges include month/day. Tooltip titles always include month/day and hour/minute.

- [ ] **Step 4: Implement Chart.js configuration**

Build two aligned datasets using `{ x: timestamp, y: count }` objects. Required options:

```javascript
{
  type: "line",
  data: { datasets: [requestDataset, errorDataset] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    animation: reducedMotion ? false : { duration: 250 },
    interaction: { mode: "index", intersect: false, axis: "x" },
    plugins: {
      legend: { display: true, position: "top", align: "end" },
      tooltip: { callbacks: tooltipCallbacks },
    },
    scales: {
      x: { type: "linear", ticks: { autoSkip: true, maxRotation: 0 } },
      y: { beginAtZero: true, ticks: { precision: 0 } },
    },
  },
}
```

Use `pointRadius: points.length <= 30 ? 3 : 0`, `pointHoverRadius: 5`, blue request fill, and red dashed error line. Locale-format counts and error rate inside tooltip callbacks.

- [ ] **Step 5: Run helper tests and confirm GREEN**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts
```

Expected: PASS for sorting, invalid timestamp filtering, range labels, dataset configuration, sparse numeric X values, and finite tooltip rate.

- [ ] **Step 6: Commit chart configuration helpers**

```bash
git add ../dashboard/dashboard.js src/dashboard/dashboard-assets.spec.ts
git commit -m "[Feat] 대시보드 차트 설정 추가"
```

### Task 4: Integrate Chart.js lifecycle, accessible states, and pinned CDN

**Files:**

- Modify: `../dashboard/index.html`
- Modify: `../dashboard/dashboard.js`
- Modify: `../dashboard/dashboard.css`
- Modify: `src/dashboard/dashboard-assets.spec.ts`
- Modify: `docs/operations/dashboard-nginx-deployment.md`

**Interfaces:**

- Consumes: Task 3 `buildChartConfig(series, range, reducedMotion)` and browser `window.Chart` constructor.
- Produces: `createChartRenderer(resolveChartConstructor, reducedMotion)` with `render(canvas, stateElement, series, range): void` and `destroy(): void`; `mount(document, fetchFn, resolveChartConstructor, reducedMotion)`; static canvas `#request-chart`; status element `#chart-state`.

- [ ] **Step 1: Add failing lifecycle and failure-state tests**

Extend fake DOM with `chart-state` and canvas visibility. Use a fake Chart constructor:

```typescript
class FakeChart {
  static instances: FakeChart[] = [];
  destroyed = false;

  constructor(readonly canvas: FakeElement, readonly config: unknown) {
    FakeChart.instances.push(this);
  }

  destroy(): void {
    this.destroyed = true;
  }
}
```

Add tests proving:

```typescript
expect(FakeChart.instances).toHaveLength(1);

await document.getElementById('refresh-button').dispatch('click');

expect(FakeChart.instances).toHaveLength(2);
expect(FakeChart.instances[0].destroyed).toBe(true);
```

Then return an empty series and assert the latest instance is destroyed, canvas is hidden, and `chart-state` says `선택 기간에 수집된 데이터가 없습니다.`

Inject a resolver that first returns `undefined`, then returns `FakeChart`; assert summary cards update during failure, failure text appears, and refresh creates a chart and clears the failure text.

Inject a constructor that throws once and succeeds next time; assert the same recovery behavior and no rejected event promise.

- [ ] **Step 2: Add failing static dependency and accessibility tests**

Read `index.html` and assert exact strings:

```typescript
expect(html).toContain(
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
);
expect(html).toContain(
  'integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"',
);
expect(html).toContain('crossorigin="anonymous"');
expect(html).toContain('<canvas');
expect(html).toContain('id="request-chart"');
expect(html).toContain('role="img"');
expect(html).toContain('id="chart-state"');
```

- [ ] **Step 3: Run Dashboard asset tests and confirm RED**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts
```

Expected: FAIL because lifecycle manager, canvas, state element, and CDN tag do not exist.

- [ ] **Step 4: Implement chart lifecycle manager**

Implement one private live instance per mounted Dashboard:

```javascript
function createChartRenderer(resolveChartConstructor, reducedMotion) {
  let chart = null;

  function destroy() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function render(canvas, stateElement, series, range) {
    destroy();
    const points = prepareChartSeries(series);
    if (points.length === 0) {
      canvas.hidden = true;
      stateElement.hidden = false;
      stateElement.textContent = '선택 기간에 수집된 데이터가 없습니다.';
      return;
    }

    try {
      const ChartConstructor = resolveChartConstructor();
      if (typeof ChartConstructor !== 'function') {
        throw new Error('Chart.js unavailable');
      }
      chart = new ChartConstructor(
        canvas,
        buildChartConfig(series, range, reducedMotion),
      );
      canvas.hidden = false;
      stateElement.hidden = true;
      stateElement.textContent = '';
    } catch (error) {
      canvas.hidden = true;
      stateElement.hidden = false;
      stateElement.textContent =
        '차트를 표시하지 못했습니다. 새로고침해 주세요.';
    }
  }

  return { render: render, destroy: destroy };
}
```

Set a concise canvas `aria-label` before construction using selected range, request sum, error sum, and point count. Call renderer only after summary text updates. Browser bootstrap passes `function () { return root.Chart; }` and current reduced-motion preference. Tests inject their resolver and boolean.

- [ ] **Step 5: Replace SVG markup and styling**

Load scripts in this order, both deferred:

```html
<script
  src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
  integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"
  crossorigin="anonymous"
  defer
></script>
<script src="/dashboard/dashboard.js" defer></script>
```

Replace SVG with:

```html
<div class="chart-container">
  <canvas
    id="request-chart"
    role="img"
    aria-label="선택 기간 요청 및 오류 추이"
  ></canvas>
  <p id="chart-state" class="chart-state" hidden></p>
</div>
```

Use a relatively positioned container with desktop height `360px`, mobile height `280px`, and no horizontal overflow. Remove `.request-line`, `.request-point`, and SVG text rules.

- [ ] **Step 6: Document CDN and CSP deployment requirement**

Add to operations guide:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

Document that existing CSP must merge `https://cdn.jsdelivr.net` into `script-src` rather than adding a second conflicting header. Record exact Chart.js URL, SRI verification, and browser-console symptom when CDN or CSP blocks the library.

- [ ] **Step 7: Verify Dashboard integration GREEN**

Run:

```bash
npm test -- --runInBand dashboard-assets.spec.ts dashboard.controller.spec.ts dashboard-metric.service.spec.ts
npx prettier --check "src/**/*.ts" "test/**/*.ts" "../dashboard/*.{html,js,css}" "docs/operations/dashboard-nginx-deployment.md"
npm run build
```

Expected: selected suites PASS, Prettier exits `0`, build exits `0`.

- [ ] **Step 8: Commit Chart.js integration**

```bash
git add ../dashboard src/dashboard/dashboard-assets.spec.ts docs/operations/dashboard-nginx-deployment.md
git commit -m "[Feat] 대시보드 차트 사용성 개선"
```

### Task 5: Whole-feature regression and browser smoke verification

**Files:**

- Verification only; no planned file changes

**Interfaces:**

- Consumes: completed module boundaries, unchanged Dashboard HTTP contract, Chart.js static integration, local MongoDB dummy metrics.
- Produces: verified branch ready for final independent review.

- [ ] **Step 1: Run formatting check without rewriting files**

Run:

```bash
npx prettier --check "src/**/*.ts" "test/**/*.ts" "../dashboard/*.{html,js,css}" "docs/**/*.md"
```

Expected: exit `0`. If it fails, run Prettier only on listed failing files, inspect the diff, and rerun the check.

- [ ] **Step 2: Run lint and inspect every modification**

Run non-mutating ESLint directly instead of the repository's fixing script:

```bash
npx eslint "{src,apps,libs,test}/**/*.ts"
git diff --check
git status --short
```

Expected: ESLint exits `0`, diff check emits no output, and status contains only intended task changes.

- [ ] **Step 3: Run complete unit, E2E, and build verification**

Run:

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Expected: all unit suites PASS, E2E PASS, build exits `0`.

- [ ] **Step 4: Run local same-origin smoke test**

With local MongoDB running and `.env.dev` Dashboard settings enabled, start Backend:

```bash
npm run start:dev
```

From repository root, serve static files with API fallback proxy:

```bash
npx --yes http-server . -a 127.0.0.1 -p 4173 -c-1 -P http://127.0.0.1:3000
```

Open `http://localhost:4173/dashboard/` in Chrome or Firefox. Verify login, all four ranges, request/error legend, tooltip values, responsive layout, refresh, logout, and browser console. Confirm network requests stay under `/api/dashboard/*` and no secret appears in storage or logs.

- [ ] **Step 5: Verify dependency and secret boundaries**

Run:

```bash
rg -n "dashboard" src/bus-api-metric src/bus-info
rg -n "DASHBOARD_(ACCESS_CODE|SESSION_SECRET)=[^<]" ../dashboard src docs/operations
rg -n "chart\.js@" ../dashboard docs/operations
git diff --check
```

Expected: no reverse Dashboard imports in metric/bus-info modules; no real Dashboard secret assignments; every Chart.js runtime URL is exactly `4.5.1`; diff check emits no output.

- [ ] **Step 6: Commit verification-only fixes if needed**

When Steps 1–5 required tracked corrections:

```bash
git add src test ../dashboard docs/operations
git commit -m "[Fix] 대시보드 통합 검증 수정"
```

When no tracked correction exists, do not create an empty commit.

## Final Review and Completion

After all tasks:

1. Request one independent whole-branch review against both specs, with focus on module ownership, duplicate providers, chart lifecycle, CDN failure, accessibility, stale-response handling, security, and unintended side effects.
2. Fix every Critical or Important finding through a RED→GREEN test cycle.
3. Re-run `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`, Prettier check, `git diff --check`, and `git status --short --branch`.
4. Do not push, update the PR, or deploy until the user explicitly requests those external changes.
