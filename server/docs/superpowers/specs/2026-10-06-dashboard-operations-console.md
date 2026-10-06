# Dashboard Operations Console Design

## Goal

Replace the current decorative metrics dashboard with a restrained operations console that can become the shared shell for future administrator pages. Keep every existing authentication, metric, filter, chart, and API contract unchanged.

## Approved direction

- Use the selected **Operations Console** direction.
- Desktop uses a persistent administrator sidebar and a focused content workspace.
- Only `API Metrics` is visible in navigation. Do not render dead links for future pages.
- The shell uses semantic `aside`, `nav`, and `main` regions so later administrator pages can reuse it.
- Mobile turns the sidebar into a compact top navigation strip without requiring new JavaScript.
- Use neutral white/slate surfaces with one blue interactive accent. Reserve red for errors.
- Reduce decorative gradients, colored card borders, excessive radii, and large empty blocks.
- Keep current DOM IDs consumed by `dashboard.js`.
- Keep Chart.js `4.5.1`, SRI, API requests, authentication flow, weekday filtering, dimension filtering, and summary calculations unchanged.

## Metrics workspace

- Header identifies `API Metrics`, timezone, and current operating scope.
- Four compact KPI cards show today requests, selected-range requests, selected-range errors, and error rate.
- Month requests remains available as secondary context in the today card, preserving existing data binding.
- Chart is the dominant surface.
- Range select stays in chart toolbar.
- Filters move into a dedicated right rail on desktop and stack below chart controls on narrow screens.
- Refresh and logout remain visible actions.
- Loading, empty, authentication, and chart failure messages keep their existing behavior.

## Local demo data

- Add `npm run seed:dashboard-metrics`.
- Command loads `.env.dev`, requires `MONGO`, and refuses non-loopback MongoDB hosts before connecting.
- Generate deterministic 90-day hourly metrics using `seoul-bus / bus-arrival`.
- Model weekday/weekend demand, morning/evening commute peaks, overnight lows, and a small deterministic error rate.
- Use `dashboard-demo-` instance IDs.
- Delete and recreate only documents with that prefix; preserve every other metric document.
- Set `expiresAt` far enough ahead for all 90 days to remain visible during local testing.

## Verification

- Unit-test seed safety, deterministic shape, demand variation, and demo-only replacement behavior.
- Extend static dashboard tests for semantic administrator shell and preserved required controls.
- Run focused tests, full unit suite, build, E2E suite, formatting check, lint, and real browser desktop/mobile screenshots.
