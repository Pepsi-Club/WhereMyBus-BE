# Dashboard Operations Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a professional, administrator-ready Operations Console dashboard plus safe, reusable local MongoDB demo data.

**Architecture:** Preserve backend and browser behavior contracts while replacing static page structure and presentation. Add a standalone local seed module with pure deterministic generation and an injected collection boundary, then keep its CLI wrapper thin.

**Tech Stack:** Node.js, TypeScript, Jest, Mongoose, static HTML/CSS/JavaScript, Chart.js 4.5.1

**Spec:** `docs/superpowers/specs/2026-10-06-dashboard-operations-console.md`

## Global Constraints

- Continue on `feat/bus-api-metrics-dashboard`; do not create another branch or worktree.
- Preserve all existing dashboard API, authentication, filter, DOM ID, and Chart.js CDN/SRI contracts.
- Expose only `API Metrics` in navigation; future administrator pages reuse shell but do not appear as dead links.
- Seed command must reject non-loopback MongoDB hosts before connection.
- Seed replacement may delete only `instanceId` values matching `dashboard-demo-` prefix.
- Do not add runtime dependencies or commit secrets.

## Review Focus

- Remote MongoDB URI must fail before connector invocation; Task 1 test exercises this.
- Existing non-demo metric documents must survive reseeding; Task 1 test exercises deletion filter and replacement boundary.
- Generated errors must never exceed requests; Task 1 test checks every generated document.
- Existing browser code must find every required element after markup rewrite; Task 2 focused dashboard suite exercises mount behavior.
- Mobile layout must avoid horizontal overflow and preserve chart readability; Task 2 real-browser 390px verification exercises this.

---

### Task 1: Safe local dashboard metric seed

**Files:**

- Create: `src/dashboard/dashboard-metric-seed.ts`
- Create: `src/dashboard/dashboard-metric-seed.spec.ts`
- Create: `scripts/seed-dashboard-metrics.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: MongoDB URI from `MONGO`; Mongoose-compatible collection methods `deleteMany` and `insertMany`.
- Produces: `assertLocalMongoUri(uri: string): void`, `buildDashboardDemoMetrics(now: Date): DashboardDemoMetric[]`, `replaceDashboardDemoMetrics(collection, documents): Promise<number>`, and `npm run seed:dashboard-metrics`.

- [ ] **Step 1: Write failing unit tests**

```typescript
expect(() =>
  assertLocalMongoUri('mongodb://db.example.com/WhereMyBus'),
).toThrow('로컬 MongoDB만 사용할 수 있습니다.');
expect(
  buildDashboardDemoMetrics(new Date('2026-10-06T06:00:00.000Z')),
).toHaveLength(90 * 24 * 2);
expect(collection.deleteMany).toHaveBeenCalledWith({
  instanceId: { $regex: '^dashboard-demo-' },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --runInBand dashboard-metric-seed.spec.ts`

Expected: FAIL because `dashboard-metric-seed` does not exist.

- [ ] **Step 3: Implement deterministic generator and safe replacement boundary**

```typescript
export function assertLocalMongoUri(uri: string): void;
export function buildDashboardDemoMetrics(now: Date): DashboardDemoMetric[];
export async function replaceDashboardDemoMetrics(
  collection: DashboardMetricCollection,
  documents: DashboardDemoMetric[],
): Promise<number>;
```

Use two `dashboard-demo-*` instances, hourly UTC buckets, Korean local-hour demand shaping, commute peaks, weekend reduction, deterministic errors, and future `expiresAt`. CLI loads `.env.dev` through Nest `ConfigModule`, validates URI before `mongoose.connect`, replaces demo-prefixed documents, prints inserted count, and closes connection in `finally`.

- [ ] **Step 4: Add npm command and verify GREEN**

Run: `npm test -- --runInBand dashboard-metric-seed.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/dashboard-metric-seed.ts src/dashboard/dashboard-metric-seed.spec.ts scripts/seed-dashboard-metrics.ts package.json
git commit -m "Feat: 로컬 대시보드 메트릭 시드 추가"
```

### Task 2: Administrator-ready Operations Console UI

**Files:**

- Modify: `../dashboard/index.html`
- Modify: `../dashboard/dashboard.css`
- Modify: `../dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard-assets.spec.ts`

**Interfaces:**

- Consumes: existing IDs and browser behavior in `dashboard.js`; Chart.js 4.5.1 global constructor.
- Produces: semantic reusable administrator shell, compact KPI grid, desktop filter rail, mobile top navigation, and refined chart presentation.

- [ ] **Step 1: Write failing static shell and chart-style tests**

```typescript
expect(html).toMatch(/<aside[^>]+class="admin-sidebar"/);
expect(html).toMatch(/<nav[^>]+aria-label="관리자 메뉴"/);
expect(html).toContain('aria-current="page"');
expect(html).toMatch(/<main[^>]+class="admin-main"/);
expect(config.options.plugins.legend.labels.usePointStyle).toBe(true);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --runInBand dashboard-assets.spec.ts`

Expected: FAIL because administrator shell and refined legend options do not exist.

- [ ] **Step 3: Rewrite static shell and presentation without changing behavior contracts**

Keep every ID used by `mount`. Change KPI structure to four cards while retaining `month-requests` as secondary text. Move filter markup into the workspace rail. Replace decorative styling with neutral tokens, compact spacing, a persistent desktop sidebar, and responsive mobile flow. Update Chart.js colors, grid, tooltip, legend, and line tension for matching visual polish.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand dashboard-assets.spec.ts`

Expected: PASS.

- [ ] **Step 5: Browser verification**

Run dashboard through the existing local static/API smoke setup. Capture desktop and 390px screenshots. Verify login, dashboard load, filters, chart, refresh, logout, no horizontal overflow, and readable empty/error states.

- [ ] **Step 6: Commit**

```bash
git add ../dashboard/index.html ../dashboard/dashboard.css ../dashboard/dashboard.js src/dashboard/dashboard-assets.spec.ts
git commit -m "Design: 관리자용 API 메트릭 콘솔 개편"
```

### Task 3: Seed local data and verify branch

**Files:**

- Modify: none unless verification exposes a defect through a new failing test.

**Interfaces:**

- Consumes: Task 1 seed command and Task 2 dashboard.
- Produces: populated local demo metrics and verified branch.

- [ ] **Step 1: Run local seed**

Run: `npm run seed:dashboard-metrics`

Expected: command reports `4320` inserted demo documents and preserves non-demo documents.

- [ ] **Step 2: Run complete verification**

Run: `npm test -- --runInBand`

Expected: all unit tests pass.

Run: `npm run build`

Expected: Nest build exits 0.

Run: `npm run test:e2e -- --runInBand`

Expected: all E2E tests pass.

Run: `npx prettier --check "src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts" "../dashboard/*.{html,css,js}"`

Expected: all files formatted.

Run: `npx eslint "{src,apps,libs,test,scripts}/**/*.ts"`

Expected: zero errors; unchanged existing warnings may remain.

- [ ] **Step 3: Commit verification-only fixes if needed**

```bash
git add -A
git commit -m "Fix: 대시보드 콘솔 검증 보완"
```

Skip this commit when verification makes no source change.
