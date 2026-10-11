import {
  SeriesPoint,
  ChartConfig,
  FakeResponse,
  FetchFn,
  FakeElement,
  FakeDocument,
  FakeChart,
  response,
  metricsPayload,
  deferred,
  settleAsyncWork,
  mount,
} from './testing/dashboard-fixture';

describe('Dashboard mounted behavior', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('중복 login을 보내지 않고 auth 쿠키 적용 후 logout 쿠키를 지운다', async () => {
    const document = new FakeDocument();
    const auth = deferred<FakeResponse>();
    const logout = deferred<FakeResponse>();
    const requests: string[] = [];
    let cookie = '';
    const fetchFn: FetchFn = async (url) => {
      if (url.endsWith('/session')) return response(401);
      requests.push(url);
      if (url.endsWith('/auth')) {
        const result = await auth.promise;
        cookie = 'authenticated';
        return result;
      }
      if (url.endsWith('/logout')) {
        const result = await logout.promise;
        cookie = '';
        return result;
      }
      return response(200, metricsPayload(7));
    };
    mount(document, fetchFn);
    await settleAsyncWork();
    document.getElementById('access-code').value = 'developer-code-1234';
    const login = document.getElementById('login-form').dispatch('submit');
    const duplicate = document.getElementById('login-form').dispatch('submit');
    await settleAsyncWork();
    expect(requests).toEqual(['/api/dashboard/auth']);
    const signingOut = document
      .getElementById('logout-button')
      .dispatch('click');
    await document.getElementById('login-form').dispatch('submit');
    await settleAsyncWork();
    expect(requests).toEqual(['/api/dashboard/auth']);
    auth.resolve(response(201));
    await settleAsyncWork();
    expect(cookie).toBe('authenticated');
    expect(requests).toEqual(['/api/dashboard/auth', '/api/dashboard/logout']);
    logout.resolve(response(201));
    await Promise.all([login, duplicate, signingOut]);
    expect(cookie).toBe('');
    expect(document.getElementById('dashboard-view').hidden).toBe(true);
    expect(document.getElementById('access-code').value).toBe('');
    expect(document.getElementById('status-message').textContent).toBe(
      '로그아웃했습니다.',
    );
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
      if (url.endsWith('/metric-dimensions')) return response(500);
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

  it('canvas 등록 후 생성자가 실패하면 남은 인스턴스를 제거하고 재시도한다', async () => {
    const document = new FakeDocument();
    let failOnce = true;
    class RegisteredChart extends FakeChart {
      static registered = new Map<FakeElement, RegisteredChart>();

      static getChart(canvas: FakeElement): RegisteredChart | undefined {
        return this.registered.get(canvas);
      }

      constructor(canvas: FakeElement, config: ChartConfig) {
        if (RegisteredChart.getChart(canvas)) {
          throw new Error('Canvas is already in use');
        }
        super(canvas, config);
        RegisteredChart.registered.set(canvas, this);
        if (failOnce) {
          failOnce = false;
          throw new Error('chart initialization failed after registration');
        }
      }

      destroy(): void {
        RegisteredChart.registered.delete(this.canvas);
        super.destroy();
      }
    }
    const fetchFn: FetchFn = async (url) =>
      url.endsWith('/session')
        ? response(200)
        : response(
            200,
            metricsPayload(3, [
              {
                start: '2026-10-01T00:00:00+09:00',
                requestCount: 3,
                errorCount: 1,
              },
            ]),
          );

    mount(document, fetchFn, () => RegisteredChart, false);
    await settleAsyncWork();
    const canvas = document.getElementById('request-chart');
    expect(FakeChart.instances).toHaveLength(1);
    expect(FakeChart.instances[0].destroyed).toBe(true);
    expect(RegisteredChart.getChart(canvas)).toBeUndefined();
    expect(document.getElementById('range-requests').textContent).toBe('3');
    expect(canvas.hidden).toBe(true);
    expect(document.getElementById('chart-state').textContent).toBe(
      '차트를 표시하지 못했습니다. 새로고침해 주세요.',
    );

    await expect(
      document.getElementById('refresh-button').dispatch('click'),
    ).resolves.toBeUndefined();
    expect(FakeChart.instances).toHaveLength(2);
    expect(RegisteredChart.getChart(canvas)).toBe(FakeChart.instances[1]);
    expect(FakeChart.instances[1].destroyed).toBe(false);
    expect(canvas.hidden).toBe(false);
    expect(document.getElementById('chart-state').textContent).toBe('');

    await document.getElementById('refresh-button').dispatch('click');
    expect(FakeChart.instances).toHaveLength(3);
    expect(FakeChart.instances[1].destroyed).toBe(true);
    expect(RegisteredChart.getChart(canvas)).toBe(FakeChart.instances[2]);
  });
});
