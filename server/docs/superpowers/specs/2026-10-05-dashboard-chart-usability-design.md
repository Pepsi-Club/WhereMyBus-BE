# Dashboard Chart Usability Design

## Status

Approved on 2026-10-05.

## Context

The current Dashboard draws one request-count line with custom SVG code. It has
no axes, persistent legend, useful dense-series labels, or combined request and
error inspection. The chart becomes difficult to read across the supported
`24h`, `7d`, `30d`, and `90d` ranges.

This design complements
`docs/superpowers/specs/2026-10-02-dashboard-module-separation-design.md`.
Module separation preserves backend behavior; this design changes only static
Dashboard presentation and its deployment requirements.

## Goals

- Make request and error trends readable on desktop and mobile.
- Show exact values and timestamps through pointer and touch interaction.
- Preserve current Dashboard routes, authentication, response payloads, and
  MongoDB aggregation.
- Keep summary cards and authentication usable when chart rendering fails.
- Preserve testability without loading third-party code during Jest runs.

## Non-goals

- Backend metric schema or aggregation changes.
- New Dashboard API ranges.
- Chart zoom, panning, export, or live streaming.
- Server-rendered charts.
- Runtime package installation in the NestJS application.

## Library Decision

Use Chart.js `4.5.1` through a version-pinned jsDelivr URL.

Chart.js fits the current maximum series sizes:

- `24h`: up to 24 hourly points
- `7d`: up to 168 hourly points
- `30d`: up to 30 daily points
- `90d`: up to 90 daily points

ECharts offers data zoom and larger-dataset features that this Dashboard does
not need. Continuing the custom SVG would retain more rendering and interaction
code than the application should own.

The script tag must include a verified SHA-384 Subresource Integrity value and
`crossorigin="anonymous"`. The version must not use a floating tag such as
`latest`, `4`, or `4.5`.

## Chart Presentation

Replace the custom SVG with one responsive canvas in a dedicated, relatively
positioned chart container.

The chart contains two datasets:

- Requests: blue line, subtle blue fill, primary visual emphasis.
- Errors: red line, no fill, visually distinct dash pattern.

Both datasets use the same non-negative linear Y axis. The legend lets users
show or hide either dataset. Dense ranges suppress normal point markers and
show a marker only for active hover or touch points.

The X axis uses labels derived from the API timestamps:

- `24h`: hour and minute
- `7d`: month/day and hour, with automatic tick skipping
- `30d` and `90d`: month/day, with automatic tick skipping

The tooltip uses index interaction without requiring exact point intersection.
It shows the Seoul-local timestamp, request count, error count, and calculated
error rate for the selected point. Numeric values use Korean locale grouping.

The Y axis starts at zero, uses integer ticks, locale number formatting, and a
low-contrast grid. The chart height remains stable while data loads and adapts
at the existing mobile breakpoint.

## Empty and Failure States

No series data shows a visible in-panel empty message and hides the canvas.

If Chart.js is unavailable, invalid, or throws while rendering:

- Summary cards and last-collected time still update.
- The chart area shows a concise retry message.
- The page does not expose response bodies, access codes, cookies, or secrets.
- Refresh and range controls remain usable so a later successful load can
  recover without reloading the page.

Changing ranges or refreshing destroys the previous Chart instance before
creating its replacement. Existing request-generation checks continue to
prevent stale responses from replacing newer data.

## Accessibility

The canvas has `role="img"` and a concise dynamic `aria-label` describing the
selected range, request total, error total, and point count. A visible legend
must not rely on color alone; error styling also uses a dash pattern.

The empty or failure message uses normal text content. Existing live status
messages continue to announce loading and API failures. Reduced-motion users
receive a chart with animation disabled through the
`prefers-reduced-motion` media query result.

## Code Boundaries

`dashboard.js` owns pure helpers for:

- Normalizing metric payloads.
- Formatting range-aware X-axis labels.
- Building Chart.js data and options.
- Calculating tooltip error rates.

The browser mount function receives or discovers the Chart constructor. Tests
inject a fake constructor; they do not load the CDN or require a canvas
implementation.

Chart instance lifecycle stays inside the mounted Dashboard state. No chart
state is stored globally.

## Security and Deployment

- External JavaScript is restricted to the exact Chart.js asset URL.
- Subresource Integrity verifies fetched script content.
- `crossorigin="anonymous"` enables integrity checking without credentials.
- No access code, session token, device token, or API response is sent to the
  CDN.
- Chart data stays in the browser after the library has loaded.
- Deployments using Content Security Policy must allow the selected jsDelivr
  origin in `script-src`; no `unsafe-inline` requirement is introduced.
- Production still serves the Dashboard through HTTPS.

## Testing

- Keep payload normalization and authentication race tests.
- Replace custom SVG path tests with pure Chart.js configuration tests.
- Verify request and error datasets, colors, dash pattern, and non-negative
  values.
- Verify range-specific timestamp labels and Korean count formatting.
- Verify tooltip request, error, and error-rate output.
- Verify empty data hides canvas and shows empty text.
- Verify missing or throwing Chart constructor shows failure text without
  breaking summary cards.
- Verify a subsequent successful render recovers from chart failure.
- Verify old Chart instances are destroyed before replacement.
- Verify stale range responses cannot replace the current chart.
- Verify static HTML uses an exact Chart.js version, SRI, and crossorigin.
- Run unit tests, E2E tests, formatting checks, lint, and build after the module
  separation and chart changes are integrated.

## Acceptance Criteria

- Backend modules match the approved module-separation design.
- Request and error series are readable for every supported range.
- Hover and touch reveal timestamp, request count, error count, and error rate.
- Mobile layout remains usable without horizontal page scrolling.
- Empty data and CDN failure have explicit states.
- Summary cards work independently from chart rendering.
- Chart.js URL is version-pinned and protected by SRI.
- Existing Dashboard API and authentication behavior remain unchanged.

## Rollback

Revert the static Dashboard chart commit to restore custom SVG rendering. No
backend, database, environment, or infrastructure rollback is required. If CSP
was updated only for Chart.js, remove the jsDelivr origin after reverting.
