import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

const dashboardModule = { exports: {} };
runInNewContext(
  readFileSync(resolve(__dirname, '../../../dashboard/dashboard.js'), 'utf8'),
  { module: dashboardModule, Intl },
);

type ChartRange = '24h' | '7d' | '30d' | '90d';
type SeriesPoint = { start: string; requestCount: number; errorCount: number };
type TooltipItem = {
  dataIndex: number;
  parsed: { x: number; y: number };
  dataset: { label: string };
};
type ChartConfig = {
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
      legend: { display: boolean; position: string; align: string };
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

const {
  formatCount,
  prepareChartSeries,
  formatChartTimestamp,
  calculateErrorRate,
  buildChartConfig,
  createChartRenderer,
  normalizeMetrics,
  mount,
} = dashboardModule.exports as {
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

type FakeEvent = { preventDefault: () => void };
type FakeListener = (event: FakeEvent) => unknown;
type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};
type FetchFn = (url: string, options?: unknown) => Promise<FakeResponse>;

class FakeElement {
  hidden = false;
  focused = false;
  value = '';
  textContent = '';
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
}

class FakeDocument {
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
    ].forEach((id) => this.elements.set(id, new FakeElement('div', id)));
    this.getElementById('dashboard-view').hidden = true;
    this.getElementById('range-select').value = '24h';
    this.getElementById('chart-state').hidden = true;
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
}

class FakeChart {
  static instances: FakeChart[] = [];
  destroyed = false;

  constructor(readonly canvas: FakeElement, readonly config: ChartConfig) {
    FakeChart.instances.push(this);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function response(status: number, payload: unknown = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function metricsPayload(rangeRequests: number, series: unknown[] = []) {
  return {
    summary: {
      todayRequests: rangeRequests,
      monthRequests: rangeRequests,
      rangeRequests,
      rangeErrors: 0,
      errorRate: 0,
      lastCollectedAt: '2026-09-30T00:00:00.000Z',
    },
    series,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function settleAsyncWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('Dashboard static helpers', () => {
  it('큰 count를 한국어 locale 숫자로 표시한다', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('유효한 timestamp만 정렬하고 count를 정규화하며 입력을 보존한다', () => {
    const series = [
      { start: 'invalid', requestCount: 100, errorCount: 2 },
      { start: '2026-10-02T00:00:00+09:00', requestCount: 2, errorCount: 0 },
      { start: '2026-10-01T00:00:00+09:00', requestCount: 1, errorCount: 1 },
      {
        start: '2026-10-03T00:00:00+09:00',
        requestCount: -1,
        errorCount: Infinity,
      },
    ];
    expect(prepareChartSeries(series)).toEqual([
      {
        timestamp: 1790780400000,
        start: '2026-10-01T00:00:00+09:00',
        requestCount: 1,
        errorCount: 1,
      },
      {
        timestamp: 1790866800000,
        start: '2026-10-02T00:00:00+09:00',
        requestCount: 2,
        errorCount: 0,
      },
      {
        timestamp: 1790953200000,
        start: '2026-10-03T00:00:00+09:00',
        requestCount: 0,
        errorCount: 0,
      },
    ]);
    expect(series[0].start).toBe('invalid');
    expect(series[3].requestCount).toBe(-1);
  });

  it.each([[], null, undefined, {}])(
    '빈 입력 %p는 빈 chart series를 만든다',
    (series) => {
      expect(prepareChartSeries(series)).toEqual([]);
    },
  );

  it.each([
    [0, 3, 0],
    [4, 1, 0.25],
    ['4', '1', 0.25],
    [Infinity, 3, 0],
    [-1, 3, 0],
    [4, 'invalid', 0],
  ])('요청 %p / 오류 %p의 오류율은 %p다', (requests, errors, expected) => {
    expect(calculateErrorRate(requests, errors)).toBe(expected);
  });

  it.each<[ChartRange, string]>([
    ['24h', '10. 1. 00:00'],
    ['7d', '10. 1. 00시'],
    ['30d', '10. 1.'],
    ['90d', '10. 1.'],
  ])('%s 축 라벨을 기간 밀도에 맞게 표시한다', (range, expected) => {
    expect(formatChartTimestamp(1790780400000, range, false)).toBe(expected);
    expect(formatChartTimestamp(1790780400000, range, true)).toBe(
      '10. 1. 00:00',
    );
  });

  it('요청과 오류를 구분하고 수치 축 및 reduced motion을 설정한다', () => {
    const config = buildChartConfig(
      [{ start: '2026-10-01T00:00:00+09:00', requestCount: 12, errorCount: 2 }],
      '24h',
      true,
    );
    expect(config.type).toBe('line');
    expect(config.data.datasets).toHaveLength(2);
    expect(config.data.datasets[0]).toMatchObject({
      label: '요청',
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5,
    });
    expect(config.data.datasets[1]).toMatchObject({
      label: '오류',
      borderDash: [6, 4],
      fill: false,
      pointRadius: 3,
      pointHoverRadius: 5,
    });
    expect(config.data.datasets[0].borderColor).not.toBe(
      config.data.datasets[1].borderColor,
    );
    expect(config.options).toMatchObject({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: { legend: { display: true, position: 'top', align: 'end' } },
      scales: {
        x: { type: 'linear', ticks: { autoSkip: true, maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    });
    expect(config.options.scales.x.ticks.callback(1790780400000)).toBe(
      '10. 1. 00:00',
    );
  });

  it('sparse series를 정렬하여 두 dataset의 숫자 x 좌표를 실제 시간 간격으로 배치한다', () => {
    const config = buildChartConfig(
      [
        { start: '2026-10-30T00:00:00+09:00', requestCount: 30, errorCount: 3 },
        { start: 'invalid', requestCount: 100, errorCount: 100 },
        { start: '2026-10-01T00:00:00+09:00', requestCount: 10, errorCount: 1 },
        { start: '2026-10-02T00:00:00+09:00', requestCount: 20, errorCount: 2 },
      ],
      '30d',
      false,
    );
    expect(config.data.datasets[0].data).toEqual([
      { x: 1790780400000, y: 10 },
      { x: 1790866800000, y: 20 },
      { x: 1793286000000, y: 30 },
    ]);
    expect(config.data.datasets[1].data).toEqual([
      { x: 1790780400000, y: 1 },
      { x: 1790866800000, y: 2 },
      { x: 1793286000000, y: 3 },
    ]);
    expect(config.options.animation).toEqual({ duration: 250 });
    expect(config.options.scales.x.ticks.callback(1790780400000)).toBe(
      '10. 1.',
    );
  });

  it.each([30, 31])('%p points의 marker 밀도를 조절한다', (count) => {
    const series = Array.from({ length: count }, () => ({
      start: '2026-10-01T00:00:00+09:00',
      requestCount: 1,
      errorCount: 0,
    }));
    const config = buildChartConfig(series, '7d', false);
    expect(config.data.datasets.map(({ pointRadius }) => pointRadius)).toEqual(
      count === 30 ? [3, 3] : [0, 0],
    );
  });

  it('빈 series는 두 빈 dataset을 만든다', () => {
    const config = buildChartConfig([], '90d', false);
    expect(config.data.datasets.map(({ data }) => data)).toEqual([[], []]);
  });

  it('요청이 0인 tooltip은 유한 값과 0.00% 오류율을 표시한다', () => {
    const config = buildChartConfig(
      [{ start: '2026-10-01T00:00:00+09:00', requestCount: 0, errorCount: 3 }],
      '90d',
      false,
    );
    const items: TooltipItem[] = [
      {
        dataIndex: 0,
        parsed: { x: 1790780400000, y: 0 },
        dataset: { label: '요청' },
      },
      {
        dataIndex: 0,
        parsed: { x: 1790780400000, y: 3 },
        dataset: { label: '오류' },
      },
    ];
    const callbacks = config.options.plugins.tooltip.callbacks;
    const strings = [
      callbacks.title(items),
      ...items.map(callbacks.label),
      callbacks.afterBody(items),
    ];
    expect(strings).toEqual([
      '10. 1. 00:00',
      '요청: 0건',
      '오류: 3건',
      '오류율: 0.00%',
    ]);
    strings.forEach((value) => expect(value).not.toMatch(/NaN|Infinity/));
  });

  it('tooltip은 정렬된 point의 locale count와 오류율을 표시한다', () => {
    const config = buildChartConfig(
      [
        { start: '2026-10-02T00:00:00+09:00', requestCount: 4, errorCount: 1 },
        {
          start: '2026-10-01T00:00:00+09:00',
          requestCount: 1234,
          errorCount: 617,
        },
      ],
      '7d',
      false,
    );
    const item: TooltipItem = {
      dataIndex: 0,
      parsed: { x: 1790780400000, y: 1234 },
      dataset: { label: '요청' },
    };
    const callbacks = config.options.plugins.tooltip.callbacks;
    expect(callbacks.label(item)).toBe('요청: 1,234건');
    expect(callbacks.afterBody([item])).toBe('오류율: 50.00%');
    expect(callbacks.title([])).toBe('');
    expect(callbacks.afterBody([])).toBe('');
  });

  it('응답 숫자를 정규화하고 허용 필드만 남긴다', () => {
    expect(
      normalizeMetrics({
        summary: {
          todayRequests: '12',
          monthRequests: undefined,
          rangeRequests: -1,
          rangeErrors: 'not-a-number',
          errorRate: Infinity,
          lastCollectedAt: '<img src=x onerror=alert(1)>',
          secret: 'must-not-survive',
        },
        series: [
          {
            start: '<b>2026-09-30</b>',
            requestCount: '3',
            errorCount: null,
            html: '<script>alert(1)</script>',
          },
        ],
      }),
    ).toEqual({
      summary: {
        todayRequests: 12,
        monthRequests: 0,
        rangeRequests: 0,
        rangeErrors: 0,
        errorRate: 0,
        lastCollectedAt: '<img src=x onerror=alert(1)>',
      },
      series: [
        {
          start: '<b>2026-09-30</b>',
          requestCount: 3,
          errorCount: 0,
        },
      ],
    });
  });
});

describe('Dashboard mounted behavior', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('로그인 성공 뒤 늦게 도착한 session 실패가 Dashboard를 덮어쓰지 않는다', async () => {
    const document = new FakeDocument();
    const initialSession = deferred<FakeResponse>();
    const fetchFn: FetchFn = async (url) => {
      if (url.endsWith('/session')) {
        return initialSession.promise;
      }
      if (url.endsWith('/auth')) {
        return response(201, { authenticated: true });
      }
      return response(200, metricsPayload(7));
    };

    mount(document, fetchFn);
    await settleAsyncWork();
    document.getElementById('access-code').value = 'developer-code-1234';
    await document.getElementById('login-form').dispatch('submit');

    expect(document.getElementById('dashboard-view').hidden).toBe(false);
    expect(document.getElementById('range-requests').textContent).toBe('7');
    expect(document.getElementById('status-message').textContent).toBe('');

    initialSession.resolve(response(401));
    await settleAsyncWork();

    expect(document.getElementById('dashboard-view').hidden).toBe(false);
    expect(document.getElementById('range-requests').textContent).toBe('7');
    expect(document.getElementById('status-message').textContent).toBe('');
  });

  it.each([
    ['HTTP 오류', async () => response(500)],
    ['network 오류', async () => Promise.reject(new Error('offline'))],
  ])(
    'logout %s면 인증 화면으로 전환하거나 성공을 표시하지 않는다',
    async (_label, logoutResponse) => {
      const document = new FakeDocument();
      const fetchFn: FetchFn = async (url) => {
        if (url.endsWith('/session')) {
          return response(200);
        }
        if (url.includes('/metrics?')) {
          return response(200, metricsPayload(7));
        }
        return logoutResponse();
      };

      mount(document, fetchFn);
      await settleAsyncWork();
      await expect(
        document.getElementById('logout-button').dispatch('click'),
      ).resolves.toBeUndefined();

      expect(document.getElementById('dashboard-view').hidden).toBe(false);
      expect(document.getElementById('status-message').textContent).toContain(
        '로그아웃하지 못했습니다',
      );
    },
  );

  it('늦게 도착한 이전 range 응답이 현재 화면을 덮어쓰지 않는다', async () => {
    const document = new FakeDocument();
    const firstMetrics = deferred<FakeResponse>();
    const secondMetrics = deferred<FakeResponse>();
    let metricRequestCount = 0;
    const fetchFn: FetchFn = async (url) => {
      if (url.endsWith('/session')) {
        return response(200);
      }
      metricRequestCount += 1;
      return metricRequestCount === 1
        ? firstMetrics.promise
        : secondMetrics.promise;
    };

    mount(document, fetchFn);
    await settleAsyncWork();
    document.getElementById('range-select').value = '90d';
    const rangeChange = document
      .getElementById('range-select')
      .dispatch('change');
    await settleAsyncWork();
    secondMetrics.resolve(response(200, metricsPayload(90)));
    await rangeChange;
    expect(document.getElementById('range-requests').textContent).toBe('90');

    firstMetrics.resolve(response(200, metricsPayload(24)));
    await settleAsyncWork();

    expect(document.getElementById('range-select').value).toBe('90d');
    expect(document.getElementById('range-requests').textContent).toBe('90');
  });

  it('단일 point와 기간·합계·시점 수 접근성 정보를 canvas에 표시한다', async () => {
    const document = new FakeDocument();
    const fetchFn: FetchFn = async (url) =>
      url.endsWith('/session')
        ? response(200)
        : response(
            200,
            metricsPayload(3, [
              {
                start: '2026-09-30T00:00:00+09:00',
                requestCount: 3,
                errorCount: 0,
              },
            ]),
          );

    mount(document, fetchFn, () => FakeChart, true);
    await settleAsyncWork();

    const chart = document.getElementById('request-chart');
    expect(FakeChart.instances).toHaveLength(1);
    expect(FakeChart.instances[0].canvas).toBe(chart);
    expect(FakeChart.instances[0].config.data.datasets[0].data).toEqual([
      { x: 1790694000000, y: 3 },
    ]);
    expect(FakeChart.instances[0].config.options.animation).toBe(false);
    expect(chart.attributes.get('aria-label')).toBe(
      '최근 24시간: 요청 3건, 오류 0건, 1개 시점',
    );
    expect(chart.hidden).toBe(false);
    expect(document.getElementById('chart-state').hidden).toBe(true);
  });

  it('새로고침과 빈 응답 전 이전 차트를 제거하고 빈 상태를 표시한다', async () => {
    const document = new FakeDocument();
    let series: SeriesPoint[] = [
      { start: '2026-10-01T00:00:00+09:00', requestCount: 12, errorCount: 2 },
    ];
    const fetchFn: FetchFn = async (url) =>
      url.endsWith('/session')
        ? response(200)
        : response(200, metricsPayload(12, series));

    mount(document, fetchFn, () => FakeChart, false);
    await settleAsyncWork();
    expect(FakeChart.instances).toHaveLength(1);

    await document.getElementById('refresh-button').dispatch('click');
    expect(FakeChart.instances).toHaveLength(2);
    expect(FakeChart.instances[0].destroyed).toBe(true);
    expect(FakeChart.instances[1].destroyed).toBe(false);

    series = [];
    await document.getElementById('refresh-button').dispatch('click');
    expect(FakeChart.instances).toHaveLength(2);
    expect(FakeChart.instances[1].destroyed).toBe(true);
    expect(document.getElementById('request-chart').hidden).toBe(true);
    expect(document.getElementById('chart-state').hidden).toBe(false);
    expect(document.getElementById('chart-state').textContent).toBe(
      '선택 기간에 수집된 데이터가 없습니다.',
    );
  });

  it.each(['missing', 'throwing'])(
    '%s 차트 실패 중 요약을 갱신하고 새로고침으로 복구한다',
    async (failure) => {
      const document = new FakeDocument();
      let available = false;
      class ThrowingChart extends FakeChart {
        constructor(canvas: FakeElement, config: ChartConfig) {
          if (!available) {
            throw new Error('chart construction failed');
          }
          super(canvas, config);
        }
      }
      const resolveChartConstructor = () =>
        failure === 'throwing'
          ? ThrowingChart
          : available
          ? FakeChart
          : undefined;
      const fetchFn: FetchFn = async (url) =>
        url.endsWith('/session')
          ? response(200)
          : response(
              200,
              metricsPayload(1234, [
                {
                  start: '2026-10-01T00:00:00+09:00',
                  requestCount: 1234,
                  errorCount: 2,
                },
              ]),
            );

      mount(document, fetchFn, resolveChartConstructor, false);
      await settleAsyncWork();
      expect(document.getElementById('range-requests').textContent).toBe(
        '1,234',
      );
      expect(document.getElementById('status-message').textContent).toBe('');
      expect(document.getElementById('request-chart').hidden).toBe(true);
      expect(document.getElementById('chart-state').hidden).toBe(false);
      expect(document.getElementById('chart-state').textContent).toBe(
        '차트를 표시하지 못했습니다. 새로고침해 주세요.',
      );
      expect(FakeChart.instances).toHaveLength(0);

      available = true;
      await expect(
        document.getElementById('refresh-button').dispatch('click'),
      ).resolves.toBeUndefined();
      expect(FakeChart.instances).toHaveLength(1);
      expect(document.getElementById('request-chart').hidden).toBe(false);
      expect(document.getElementById('chart-state').hidden).toBe(true);
      expect(document.getElementById('chart-state').textContent).toBe('');
    },
  );

  it('logout과 세션 만료 시 현재 차트를 제거한다', async () => {
    const document = new FakeDocument();
    let expired = false;
    const fetchFn: FetchFn = async (url) =>
      url.endsWith('/session') || url.endsWith('/logout')
        ? response(200)
        : expired
        ? response(401)
        : response(
            200,
            metricsPayload(3, [
              {
                start: '2026-10-01T00:00:00+09:00',
                requestCount: 3,
                errorCount: 0,
              },
            ]),
          );
    mount(document, fetchFn, () => FakeChart, false);
    await settleAsyncWork();
    expect(FakeChart.instances).toHaveLength(1);
    await document.getElementById('logout-button').dispatch('click');
    expect(FakeChart.instances[0].destroyed).toBe(true);
    expect(document.getElementById('dashboard-view').hidden).toBe(true);

    await document.getElementById('login-form').dispatch('submit');
    expect(FakeChart.instances).toHaveLength(2);
    expired = true;
    await document.getElementById('refresh-button').dispatch('click');
    expect(FakeChart.instances[1].destroyed).toBe(true);
    expect(document.getElementById('dashboard-view').hidden).toBe(true);
  });
});

describe('Dashboard chart renderer', () => {
  it('잘못된 timestamp만 있는 응답은 빈 상태이며 destroy는 반복 호출할 수 있다', () => {
    const document = new FakeDocument();
    const renderer = createChartRenderer(() => FakeChart, false);
    const canvas = document.getElementById('request-chart');
    const state = document.getElementById('chart-state');
    renderer.render(
      canvas,
      state,
      [{ start: '2026-10-01T00:00:00+09:00', requestCount: 3, errorCount: 1 }],
      '7d',
    );
    const chart = FakeChart.instances[FakeChart.instances.length - 1];
    expect(canvas.attributes.get('aria-label')).toBe(
      '최근 7일: 요청 3건, 오류 1건, 1개 시점',
    );
    renderer.render(
      canvas,
      state,
      [{ start: 'invalid', requestCount: 100, errorCount: 2 }],
      '7d',
    );
    expect(chart.destroyed).toBe(true);
    expect(canvas.hidden).toBe(true);
    expect(state.textContent).toBe('선택 기간에 수집된 데이터가 없습니다.');
    expect(() => {
      renderer.destroy();
      renderer.destroy();
    }).not.toThrow();
  });
});

describe('Dashboard static markup', () => {
  it('브라우저 bootstrap은 최신 Chart constructor와 reduced motion 설정을 전달한다', async () => {
    FakeChart.instances = [];
    const document = new FakeDocument();
    let ready = () => undefined;
    const window = {
      document,
      Chart: undefined as typeof FakeChart | undefined,
      matchMedia: (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      }),
      fetch: async (url: string) =>
        url.endsWith('/session')
          ? response(200)
          : response(
              200,
              metricsPayload(3, [
                {
                  start: '2026-10-01T00:00:00+09:00',
                  requestCount: 3,
                  errorCount: 0,
                },
              ]),
            ),
      addEventListener: (_type: string, listener: () => undefined) => {
        ready = listener;
      },
    };
    runInNewContext(
      readFileSync(
        resolve(__dirname, '../../../dashboard/dashboard.js'),
        'utf8',
      ),
      { window, Intl },
    );
    ready();
    await settleAsyncWork();
    expect(document.getElementById('chart-state').textContent).toBe(
      '차트를 표시하지 못했습니다. 새로고침해 주세요.',
    );
    window.Chart = FakeChart;
    await document.getElementById('refresh-button').dispatch('click');
    expect(FakeChart.instances).toHaveLength(1);
    expect(FakeChart.instances[0].config.options.animation).toBe(false);
  });

  it('고정 버전 CDN과 SRI를 앱 script 앞에 defer로 로드하고 접근성 canvas와 상태를 제공한다', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../dashboard/index.html'),
      'utf8',
    );
    const cdn =
      'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';
    expect(html).toContain(cdn);
    expect(html).toContain(
      'integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"',
    );
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).toMatch(/src="https:\/\/cdn\.jsdelivr\.net[^>]+defer\s*>/);
    expect(html.indexOf(cdn)).toBeLessThan(
      html.indexOf('/dashboard/dashboard.js'),
    );
    expect(html).toContain('<script src="/dashboard/dashboard.js" defer>');
    expect(html).toMatch(/<canvas\s+id="request-chart"\s+role="img"/);
    expect(html).toContain('id="chart-state"');
  });
});
