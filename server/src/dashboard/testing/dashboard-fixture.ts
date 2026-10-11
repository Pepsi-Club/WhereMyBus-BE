import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createContext, runInContext } from 'vm';

export function loadDashboardScripts(window?: object) {
  const context = createContext({ Intl, ...(window ? { window } : {}) });
  const dashboardPath = resolve(__dirname, '../../../../dashboard');
  const html = readFileSync(resolve(dashboardPath, 'index.html'), 'utf8');
  const scripts = html.matchAll(
    /<script\s+src="(\/dashboard\/[^"]+)"\s+defer><\/script>/g,
  );
  for (const [, path] of scripts) {
    const filename = resolve(dashboardPath, path.slice('/dashboard/'.length));
    runInContext(readFileSync(filename, 'utf8'), context, { filename });
  }
  const root = context.window ?? context;
  return {
    ...root.WmbDashboardData,
    ...root.WmbDashboardChart,
    ...root.WmbDashboardApp,
  };
}

const dashboard = loadDashboardScripts();

export type ChartRange = '24h' | '7d' | '30d' | '90d';
export type SeriesPoint = {
  start: string;
  weekday?: number;
  requestCount: number;
  errorCount: number;
};
export type DimensionCatalog = {
  providers: Array<{
    key: string;
    label: string;
    operations: Array<{ key: string; label: string }>;
  }>;
};
export type TooltipItem = {
  dataIndex: number;
  parsed: { x: number; y: number };
  dataset: { label: string };
};
export type ChartConfig = {
  type: string;
  data: {
    datasets: Array<{
      label: string;
      data: Array<{ x: number; y: number }>;
      borderDash?: number[];
      fill: boolean;
      borderColor: string;
      backgroundColor: string;
      pointRadius: number;
      pointHoverRadius: number;
    }>;
  };
  options: {
    responsive: boolean;
    maintainAspectRatio: boolean;
    parsing: boolean;
    animation: false | { duration: number };
    interaction: { mode: string; intersect: boolean; axis: string };
    plugins: {
      legend: {
        display: boolean;
        position: string;
        align: string;
        labels?: { usePointStyle: boolean; pointStyle: string };
      };
      tooltip: {
        callbacks: {
          title: (items: TooltipItem[]) => string;
          label: (item: TooltipItem) => string;
          afterBody: (items: TooltipItem[]) => string;
        };
      };
    };
    scales: {
      x: {
        type: string;
        min?: number;
        max?: number;
        ticks: {
          autoSkip: boolean;
          maxRotation: number;
          callback: (timestamp: number) => string;
        };
      };
      y: { beginAtZero: boolean; ticks: { precision: number } };
    };
  };
};

export const {
  formatCount,
  prepareChartSeries,
  formatChartTimestamp,
  calculateErrorRate,
  buildChartConfig,
  createChartRenderer,
  normalizeMetrics,
  normalizeDimensionCatalog,
  filterSeriesByWeekdays,
  summarizeSeries,
  buildMetricsQuery,
  mount,
} = dashboard as {
  formatCount: (value: unknown) => string;
  prepareChartSeries: (
    series: unknown,
  ) => Array<SeriesPoint & { timestamp: number }>;
  formatChartTimestamp: (
    timestamp: number,
    range: ChartRange,
    includeTime: boolean,
  ) => string;
  calculateErrorRate: (requestCount: unknown, errorCount: unknown) => number;
  buildChartConfig: (
    series: SeriesPoint[],
    range: ChartRange,
    reducedMotion: boolean,
  ) => ChartConfig;
  normalizeMetrics: (payload: unknown) => unknown;
  normalizeDimensionCatalog: (payload: unknown) => DimensionCatalog;
  filterSeriesByWeekdays: (
    series: unknown,
    weekdays: number[],
  ) => SeriesPoint[];
  summarizeSeries: (series: unknown[]) => {
    requestCount: number;
    errorCount: number;
    errorRate: number;
  };
  buildMetricsQuery: (
    range: string,
    providers: string[],
    operations: string[],
  ) => string;
  createChartRenderer: (
    resolveChartConstructor: () => typeof FakeChart | undefined,
    reducedMotion: boolean,
  ) => {
    render: (
      canvas: FakeElement,
      stateElement: FakeElement,
      series: SeriesPoint[],
      range: ChartRange,
    ) => void;
    destroy: () => void;
  };
  mount: (
    document: FakeDocument,
    fetchFn: FetchFn,
    resolveChartConstructor?: () => typeof FakeChart | undefined,
    reducedMotion?: boolean,
  ) => void;
};

export type FakeEvent = { preventDefault: () => void };
export type FakeListener = (event: FakeEvent) => unknown;
export type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};
export type FetchFn = (url: string, options?: unknown) => Promise<FakeResponse>;

export class FakeElement {
  hidden = false;
  focused = false;
  value = '';
  textContent = '';
  checked = false;
  disabled = false;
  type = '';
  htmlFor = '';
  dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(readonly tagName: string, readonly id?: string) {}

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type: string): Promise<void> {
    const event = { preventDefault: () => undefined };
    await Promise.all(
      (this.listeners.get(type) ?? []).map((listener) => listener(event)),
    );
  }

  focus(): void {
    this.focused = true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(): void {
    this.children.splice(0, this.children.length);
  }

  set innerHTML(_value: string) {
    throw new Error('HTML interpolation is forbidden in filter controls');
  }
}

export class FakeDocument {
  private readonly elements = new Map<string, FakeElement>();

  constructor() {
    [
      'login-view',
      'dashboard-view',
      'login-form',
      'access-code',
      'range-select',
      'logout-button',
      'status-message',
      'refresh-button',
      'today-requests',
      'month-requests',
      'range-requests',
      'range-errors',
      'error-rate',
      'last-collected-at',
      'request-chart',
      'chart-state',
      'weekday-filters',
      'provider-filters',
      'operation-filters',
      'provider-fieldset',
      'operation-fieldset',
      'filter-apply',
      'filter-reset',
      'dimension-state',
      'weekday-preset-all',
      'weekday-preset-weekday',
      'weekday-preset-weekend',
    ].forEach((id) => this.elements.set(id, new FakeElement('div', id)));
    this.getElementById('dashboard-view').hidden = true;
    this.getElementById('range-select').value = '24h';
    this.getElementById('chart-state').hidden = true;
    ['all', 'weekday', 'weekend'].forEach((preset) => {
      this.getElementById(`weekday-preset-${preset}`).dataset.weekdayPreset =
        preset;
    });
  }

  getElementById(id: string): FakeElement {
    const element = this.elements.get(id);
    if (!element) {
      throw new Error(`missing fake element: ${id}`);
    }
    return element;
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  querySelectorAll(): FakeElement[] {
    return ['all', 'weekday', 'weekend'].map((preset) =>
      this.getElementById(`weekday-preset-${preset}`),
    );
  }
}

export class FakeChart {
  static instances: FakeChart[] = [];
  destroyed = false;

  constructor(readonly canvas: FakeElement, readonly config: ChartConfig) {
    FakeChart.instances.push(this);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export function response(status: number, payload: unknown = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

export function metricsPayload(
  rangeRequests: number,
  series: unknown[] = [
    {
      start: '2026-10-05T00:00:00+09:00',
      weekday: 1,
      requestCount: rangeRequests,
      errorCount: 0,
    },
  ],
) {
  return {
    summary: {
      todayRequests: rangeRequests,
      monthRequests: rangeRequests,
      rangeRequests,
      rangeErrors: 0,
      errorRate: 0,
      lastCollectedAt: '2026-09-30T00:00:00.000Z',
    },
    series: series.map((point) => ({ weekday: 1, ...(point as object) })),
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export async function settleAsyncWork(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await Promise.resolve();
  }
}
