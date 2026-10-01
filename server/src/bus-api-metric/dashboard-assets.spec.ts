import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

const dashboardModule = { exports: {} };
runInNewContext(
  readFileSync(resolve(__dirname, '../../../dashboard/dashboard.js'), 'utf8'),
  { module: dashboardModule, Intl },
);

const { formatCount, buildLinePath, normalizeMetrics, mount } =
  dashboardModule.exports as {
    formatCount: (value: unknown) => string;
    buildLinePath: (
      series: Array<{ start: string; requestCount: number }>,
      width: number,
      height: number,
    ) => string;
    normalizeMetrics: (payload: unknown) => unknown;
    mount: (document: FakeDocument, fetchFn: FetchFn) => void;
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
    ].forEach((id) => this.elements.set(id, new FakeElement('div', id)));
    this.getElementById('dashboard-view').hidden = true;
    this.getElementById('range-select').value = '24h';
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

  it('빈 series는 빈 SVG path를 만든다', () => {
    expect(buildLinePath([], 800, 240)).toBe('');
  });

  it('requestCount가 모두 0이어도 유한 좌표만 만든다', () => {
    expect(
      buildLinePath(
        [
          { start: '2026-09-01T00:00:00+09:00', requestCount: 0 },
          { start: '2026-09-02T00:00:00+09:00', requestCount: 0 },
        ],
        100,
        50,
      ),
    ).toBe('M 0 50 L 100 50');
  });

  it('sparse series의 x 좌표를 실제 시간 간격으로 배치한다', () => {
    expect(
      buildLinePath(
        [
          { start: '2026-09-01T00:00:00+09:00', requestCount: 1 },
          { start: '2026-09-02T00:00:00+09:00', requestCount: 1 },
          { start: '2026-09-30T00:00:00+09:00', requestCount: 1 },
        ],
        290,
        100,
      ),
    ).toBe('M 0 0 L 10 0 L 290 0');
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

  it('단일 point를 marker와 날짜·count 접근성 정보로 표시한다', async () => {
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

    mount(document, fetchFn);
    await settleAsyncWork();

    const chart = document.getElementById('request-chart');
    expect(chart.children.some(({ tagName }) => tagName === 'circle')).toBe(
      true,
    );
    expect(chart.attributes.get('aria-label')).toContain('2026-09-30');
    expect(chart.attributes.get('aria-label')).toContain('3');
  });
});
