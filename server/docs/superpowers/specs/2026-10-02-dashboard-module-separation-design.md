# Dashboard Module Separation Design

## Status

Proposed for review.

## Context

`src/bus-api-metric/` currently contains metric recording, MongoDB persistence,
Dashboard query logic, HTTP endpoints, session authentication, login limiting,
and static-asset tests. `BusApiMetricModule` is imported by `BusInfoModule`, so
Dashboard routes are registered as an indirect side effect of bus API metric
recording.

The refactor must make module ownership explicit without changing runtime
behavior.

## Goals

- Keep `BusApiMetricModule` focused on recording and storing bus API metrics.
- Isolate Dashboard authentication and login limiting in `DashboardAuthModule`.
- Make `DashboardModule` own Dashboard HTTP routes and metric presentation.
- Register Dashboard routes explicitly from `AppModule`.
- Preserve every public route, response, cookie, environment variable, MongoDB
  schema, cron schedule, and static asset path.
- Avoid duplicate providers, circular dependencies, `forwardRef`, and explanatory
  comments that compensate for unclear structure.

## Non-goals

- Authentication policy changes.
- Dashboard UI changes.
- Metric schema or aggregation changes.
- New environment variables.
- OCI, Nginx, PM2, or firewall changes.

## Options Considered

### 1. Extract only `DashboardAuthModule`

Smallest diff, but `BusApiMetricModule` would still own Dashboard controller and
query presentation. Dashboard route registration would remain an indirect side
effect of `BusInfoModule` importing the metric module.

### 2. Extract `DashboardModule` and nested `DashboardAuthModule`

Selected. Separates recording/storage, Dashboard presentation, and Dashboard
authentication while keeping auth scoped to its only consumer.

### 3. Create a top-level generic application auth module

Rejected. Authentication is specific to the operations Dashboard and is not a
general user-authentication subsystem.

## Target Structure

```text
src/
├── bus-api-metric/
│   ├── bus-api-metric.module.ts
│   ├── bus-api-metric.repository.ts
│   ├── bus-api-metric.schema.ts
│   └── bus-api-metric.service.ts
└── dashboard/
    ├── dashboard.module.ts
    ├── dashboard.controller.ts
    ├── dashboard-metric.service.ts
    ├── dashboard-assets.spec.ts
    ├── dto/
    │   └── dashboard-range.query.dto.ts
    └── auth/
        ├── dashboard-auth.module.ts
        ├── dashboard-auth.service.ts
        ├── dashboard-auth.guard.ts
        ├── dashboard-login-attempt-limiter.ts
        └── dto/
            └── dashboard-auth.request.dto.ts
```

Tests move beside their production files.

## Module Responsibilities

### `BusApiMetricModule`

- Registers `BusApiMetricSchema`.
- Provides `BusApiMetricRepository` and `BusApiMetricService`.
- Exports repository and recorder service.
- Owns no controllers, guards, cookies, or Dashboard DTOs.

### `DashboardAuthModule`

- Provides `DashboardAuthService`, `DashboardAuthGuard`, and
  `DashboardLoginAttemptLimiter`.
- Exports auth service and guard.
- Has no dependency on MongoDB or bus metric recording.
- Injects the limiter into the auth service instead of constructing it inside
  the service. The limiter owns login-attempt policy configuration.

### `DashboardModule`

- Imports `BusApiMetricModule` and `DashboardAuthModule`.
- Provides `DashboardMetricService`.
- Registers `DashboardController` at the unchanged `/api/dashboard` path.
- Does not redeclare providers exported by imported modules.

### `AppModule`

- Imports `DashboardModule` explicitly.
- Continues importing `BusInfoModule`; `BusInfoModule` imports
  `BusApiMetricModule` only for request recording.

## Dependency Direction

```text
BusInfoModule ───────▶ BusApiMetricModule
DashboardModule ─────▶ BusApiMetricModule
DashboardModule ─────▶ DashboardAuthModule
AppModule ───────────▶ BusInfoModule
AppModule ───────────▶ DashboardModule
```

No dependency points from metric recording into Dashboard or authentication.

## Runtime Behavior

The following remain unchanged:

- `POST /api/dashboard/auth`
- `GET /api/dashboard/session`
- `GET /api/dashboard/metrics`
- `POST /api/dashboard/logout`
- Cookie name, TTL, flags, and path
- Login failure window and retained-IP bound
- Metric recorder injection into `BusInfoService`
- MongoDB collection, indexes, and retention
- `/dashboard/` static files and API calls

## Error and Side-effect Boundaries

- Importing `BusApiMetricModule` no longer registers Dashboard routes.
- Dashboard route registration occurs only through explicit `DashboardModule`
  import in `AppModule`.
- Auth state remains process-local and is instantiated once through Nest DI.
- Mongoose model registration remains inside `BusApiMetricModule`; importing the
  module from two consumers must reuse the same Nest module instance.

## Testing

- Run existing auth service, guard, limiter, controller, query, asset, recorder,
  repository, and BusInfo tests after path updates.
- Keep E2E assertions for root response, unauthenticated metrics `401`, and
  disabled Dashboard auth `404` unchanged.
- Add a module-boundary test proving `DashboardModule` can compile from imported
  metric and auth modules without duplicate provider declarations.
- Run Prettier, ESLint, build, full unit tests, and E2E tests.

## Acceptance Criteria

- `BusApiMetricModule` contains only schema/repository/recorder concerns.
- Dashboard auth lives under `src/dashboard/auth/` and is provided by
  `DashboardAuthModule`.
- Dashboard routes live under `DashboardModule`, imported explicitly by
  `AppModule`.
- No public behavior or configuration changes.
- No circular dependency or `forwardRef`.
- Full verification passes and PR branch remains clean.

## Rollback

Revert the refactor commit. No data or infrastructure rollback is required
because routes, configuration, and MongoDB schema remain unchanged.
