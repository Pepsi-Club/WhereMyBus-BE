# Dashboard Metric Dimension and Weekday Filter Design

## Status

Approved on 2026-10-05. Canonical discussion copy: [Notion — 버스 호출 API metric 추가](https://app.notion.com/p/3eb0c1769c65800d9b5cde7d6eaa1084?pvs=204).

## Goal

Add API-provider and operation dimensions to bus API metrics, then let operators filter Dashboard trends by API classification and multiple weekdays. API classification is filtered by the backend; weekdays are returned with each series point and filtered in the browser.

## Decisions

- Store `provider` and `operation` on every metric bucket.
- Initial identity is `seoul-bus / bus-arrival`.
- Keep metric labels in a typed server registry, not MongoDB documents or hardcoded Dashboard markup.
- Filter provider and operation in MongoDB.
- Do not accept a `weekdays` query parameter.
- Return ISO weekday `1` through `7` for each point, calculated in `Asia/Seoul`.
- Filter weekdays in the browser because every supported range returns at most about 168 points.
- Keep `todayRequests` and `monthRequests` unfiltered.
- Apply provider and operation filters to range summary, series, and last collection time.
- Recalculate selected-period requests, errors, and error rate in the browser after weekday filtering.
- Keep at least one weekday, provider, and operation selected.
- No production legacy migration is required because the feature has not been deployed. The local `bus_api_metrics` collection containing 2,162 dummy documents was dropped on 2026-10-05.

## MongoDB Document

Collection: `bus_api_metrics`

```json
{
  "bucketStart": "2026-10-05T03:30:00.000Z",
  "instanceId": "0:12345:4f7b...",
  "provider": "seoul-bus",
  "operation": "bus-arrival",
  "requestCount": 12,
  "errorCount": 1,
  "expiresAt": "2027-11-09T03:30:00.000Z"
}
```

Indexes:

- Unique: `{ bucketStart: 1, instanceId: 1, provider: 1, operation: 1 }`
- TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 0`
- Unfiltered range: `{ bucketStart: 1 }`
- Dimension range: `{ provider: 1, operation: 1, bucketStart: 1 }`

Bucket identity is minute, process instance, provider, and operation. A retry uses `$set` plus upsert so one process does not double-count its own bucket. Empty minutes do not create documents.

## Metric Identity Registry

The server owns a typed registry containing stable keys and Korean labels:

```ts
{
  provider: 'seoul-bus',
  providerLabel: '서울 버스',
  operation: 'bus-arrival',
  operationLabel: '버스 도착 정보',
}
```

New external calls add one registry entry and pass its identity at the actual HTTP boundary. Existing schema and Dashboard rendering remain unchanged.

## Recorder Contract

```ts
metricRecorder.recordRequest(
  { provider: 'seoul-bus', operation: 'bus-arrival' },
  startedAt,
);
metricRecorder.recordError(
  { provider: 'seoul-bus', operation: 'bus-arrival' },
  startedAt,
);
```

`BusInfoService.arriveStation()` records `seoul-bus / bus-arrival`. Metric failures remain isolated from the bus arrival and notification path.

## Dashboard APIs

### Dimension catalog

`GET /api/dashboard/metric-dimensions`

```json
{
  "providers": [
    {
      "key": "seoul-bus",
      "label": "서울 버스",
      "operations": [{ "key": "bus-arrival", "label": "버스 도착 정보" }]
    }
  ]
}
```

### Metrics

`GET /api/dashboard/metrics?range=30d&providers=seoul-bus&operations=bus-arrival`

- `range` is required and limited to `24h`, `7d`, `30d`, and `90d`.
- `providers` and `operations` are optional comma-separated registered keys.
- Omission means all matching registered dimensions.
- Unknown keys, empty selections, incompatible provider-operation selections, repeated query arrays, and excessive query strings return `400`.
- There is no `weekdays` query parameter.

Response shape:

```json
{
  "range": "30d",
  "timezone": "Asia/Seoul",
  "filters": {
    "providers": ["seoul-bus"],
    "operations": ["bus-arrival"]
  },
  "summary": {
    "todayRequests": 120,
    "monthRequests": 3400,
    "rangeRequests": 3200,
    "rangeErrors": 21,
    "errorRate": 0.0065625,
    "lastCollectedAt": "2026-10-05T03:31:00.000Z"
  },
  "series": [
    {
      "start": "2026-10-05T00:00:00+09:00",
      "weekday": 1,
      "requestCount": 30,
      "errorCount": 2
    }
  ]
}
```

## Frontend Behavior

- Render weekday toggles for Monday through Sunday.
- `전체` selects 1–7, `평일` selects 1–5, and `주말` selects 6–7.
- Render provider and operation checkboxes from the catalog endpoint.
- Show only operations belonging to selected providers.
- Weekday changes do not perform network requests. They filter cached points and recalculate selected-period cards.
- Provider or operation Apply and range changes request metrics while preserving current selections.
- Reset selects every weekday, provider, and operation.
- Empty weekday results display zero selected-period cards and the existing empty-chart state.
- Existing stale-response protection must cover dimension and range requests.
- A catalog failure disables dimension controls but still allows an unfiltered metrics request.

## Failure and Security Rules

- Dashboard APIs retain session Guard protection.
- Metric recording, flushing, and catalog behavior must not expose secrets or interrupt bus notification work.
- Registry keys are allowlisted and never accepted as arbitrary MongoDB paths.
- Frontend uses text nodes and DOM properties, not HTML string interpolation, for registry labels.
- Existing Chart.js version and SRI pin remain unchanged.

## Verification

- Schema and all four indexes match the approved shape.
- Same minute and process can store separate dimension documents.
- Multiple process documents aggregate into one point.
- Seoul Sunday-to-Monday boundary returns ISO weekdays 7 then 1.
- Invalid and incompatible filters return `400`.
- Weekday toggles produce no fetch calls.
- Presets and arbitrary multiple weekdays calculate correct totals and finite error rates.
- Provider, operation, and range changes reject stale results.
- Unit, E2E, build, formatting, lint, and real-browser Dashboard smoke pass.
