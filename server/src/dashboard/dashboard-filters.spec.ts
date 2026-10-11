import {
  DimensionCatalog,
  FakeResponse,
  FetchFn,
  FakeElement,
  FakeDocument,
  FakeChart,
  response,
  metricsPayload,
  deferred,
  settleAsyncWork,
  normalizeDimensionCatalog,
  filterSeriesByWeekdays,
  summarizeSeries,
  buildMetricsQuery,
  mount,
} from './testing/dashboard-fixture';

const catalog: DimensionCatalog = {
  providers: [
    {
      key: 'seoul-bus',
      label: '서울 버스',
      operations: [
        { key: 'bus-arrival', label: '버스 도착 정보' },
        { key: 'bus-route', label: '<img src=x onerror=alert(1)>' },
      ],
    },
    {
      key: 'metro',
      label: '지하철',
      operations: [{ key: 'train-arrival', label: '열차 도착 정보' }],
    },
  ],
};

function options(document: FakeDocument, group: string): FakeElement[] {
  return document
    .getElementById(`${group}-filters`)
    .children.map((label) => label.children[0]);
}

async function toggle(
  document: FakeDocument,
  group: string,
  value: string,
  checked: boolean,
): Promise<void> {
  const input = options(document, group).find((item) => item.value === value);
  if (!input) throw new Error(`missing ${group} option ${value}`);
  input.checked = checked;
  await input.dispatch('change');
}

describe('Dashboard metric filters', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('catalog의 잘못된 항목과 중복 key를 제거하고 provider별 label을 보존한다', () => {
    expect(
      normalizeDimensionCatalog({
        providers: [
          null,
          { key: '', label: 'empty', operations: [] },
          { key: 'broken', label: 3, operations: [] },
          {
            ...catalog.providers[0],
            operations: [
              catalog.providers[0].operations[0],
              catalog.providers[0].operations[0],
              { key: 'bad', label: null },
              null,
              catalog.providers[0].operations[1],
            ],
          },
          catalog.providers[0],
          catalog.providers[1],
        ],
      }),
    ).toEqual(catalog);
    expect(normalizeDimensionCatalog(null)).toEqual({ providers: [] });
  });

  it('ISO weekday 1–7만 보존하고 임의 요일 조합을 필터링한다', () => {
    const points = [1, 2, 3, 7, 0, 8, 1.5, '1', undefined].map((weekday) => ({
      start: '2026-10-05T00:00:00+09:00',
      weekday,
      requestCount: 3,
      errorCount: 1,
    }));
    expect(filterSeriesByWeekdays(points, [1, 3, 5])).toEqual([
      expect.objectContaining({ weekday: 1 }),
      expect.objectContaining({ weekday: 3 }),
    ]);
    expect(filterSeriesByWeekdays(points, [1, 2, 3, 4, 5, 6, 7])).toHaveLength(
      4,
    );
  });

  it('집계는 숫자를 정규화하고 요청이 없으면 유한 오류율을 반환한다', () => {
    expect(summarizeSeries([{ requestCount: 0, errorCount: 2 }])).toEqual({
      requestCount: 0,
      errorCount: 2,
      errorRate: 0,
    });
    expect(
      summarizeSeries([
        { requestCount: 6, errorCount: 1 },
        { requestCount: '4', errorCount: 1 },
        { requestCount: -1, errorCount: Infinity },
      ]),
    ).toEqual({ requestCount: 10, errorCount: 2, errorRate: 0.2 });
    expect(summarizeSeries([])).toEqual({
      requestCount: 0,
      errorCount: 0,
      errorRate: 0,
    });
  });

  it('metrics query는 CSV dimension을 인코딩하고 빈 선택은 생략한다', () => {
    expect(buildMetricsQuery('30d', ['seoul-bus'], ['bus-arrival'])).toBe(
      '/metrics?range=30d&providers=seoul-bus&operations=bus-arrival',
    );
    expect(buildMetricsQuery('7d', ['seoul-bus', 'metro'], ['a&b'])).toBe(
      '/metrics?range=7d&providers=seoul-bus%2Cmetro&operations=a%26b',
    );
    expect(buildMetricsQuery('24h', [], [])).toBe('/metrics?range=24h');
  });

  async function mounted() {
    const document = new FakeDocument();
    const requests: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      requests.push(url);
      if (url.endsWith('/session')) return response(200);
      if (url.endsWith('/metric-dimensions')) return response(200, catalog);
      return response(
        200,
        metricsPayload(999, [
          {
            start: '2026-10-05T00:00:00+09:00',
            weekday: 1,
            requestCount: 10,
            errorCount: 1,
          },
          {
            start: '2026-10-06T00:00:00+09:00',
            weekday: 2,
            requestCount: 20,
            errorCount: 2,
          },
          {
            start: '2026-10-07T00:00:00+09:00',
            weekday: 3,
            requestCount: 30,
            errorCount: 3,
          },
          {
            start: '2026-10-10T00:00:00+09:00',
            weekday: 6,
            requestCount: 40,
            errorCount: 4,
          },
        ]),
      );
    };
    mount(document, fetchFn, () => FakeChart);
    await settleAsyncWork();
    return { document, requests };
  }

  it('인증 후 catalog를 불러오며 label을 HTML 대신 연결된 text DOM으로 표시한다', async () => {
    const { document, requests } = await mounted();
    expect(requests.slice(0, 2)).toEqual([
      '/api/dashboard/session',
      '/api/dashboard/metric-dimensions',
    ]);
    expect(options(document, 'provider').map((input) => input.value)).toEqual([
      'seoul-bus',
      'metro',
    ]);
    const labels = document.getElementById('operation-filters').children;
    expect(labels[1].children[1].textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    labels.forEach((label) => {
      expect(label.htmlFor).toBe(label.children[0].id);
      expect(label.children[0].type).toBe('checkbox');
      expect(label.children[0].checked).toBe(true);
    });
  });

  it('월요일과 수요일 선택은 cached series와 선택 기간 카드만 갱신한다', async () => {
    const { document, requests } = await mounted();
    const before = requests.length;
    for (const day of ['2', '4', '5', '6', '7']) {
      await toggle(document, 'weekday', day, false);
    }
    expect(requests).toHaveLength(before);
    expect(document.getElementById('range-requests').textContent).toBe('40');
    expect(document.getElementById('range-errors').textContent).toBe('4');
    expect(document.getElementById('error-rate').textContent).toBe('10.00%');
    expect(document.getElementById('today-requests').textContent).toBe('999');
    expect(document.getElementById('month-requests').textContent).toBe('999');
    expect(FakeChart.instances.at(-1)?.config.data.datasets[0].data).toEqual([
      { x: 1791126000000, y: 10 },
      { x: 1791298800000, y: 30 },
    ]);
  });

  it.each([
    ['weekday', ['1', '2', '3', '4', '5']],
    ['weekend', ['6', '7']],
    ['all', ['1', '2', '3', '4', '5', '6', '7']],
  ])(
    '%s preset은 정확한 ISO 요일을 요청 없이 선택한다',
    async (preset, selected) => {
      const { document, requests } = await mounted();
      const before = requests.length;
      await document
        .getElementById(`weekday-preset-${preset}`)
        .dispatch('click');
      expect(
        options(document, 'weekday')
          .filter((input) => input.checked)
          .map((input) => input.value),
      ).toEqual(selected);
      expect(requests).toHaveLength(before);
    },
  );

  it('마지막 weekday/provider/operation은 해제할 수 없다', async () => {
    const { document } = await mounted();
    for (const day of ['2', '3', '4', '5', '6', '7', '1'])
      await toggle(document, 'weekday', day, false);
    expect(
      options(document, 'weekday')
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(['1']);
    await toggle(document, 'provider', 'metro', false);
    await toggle(document, 'provider', 'seoul-bus', false);
    expect(
      options(document, 'provider')
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(['seoul-bus']);
    await toggle(document, 'operation', 'bus-route', false);
    await toggle(document, 'operation', 'bus-arrival', false);
    expect(
      options(document, 'operation')
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(['bus-arrival']);
  });

  it('provider 변경은 호환 operation 선택을 보존하고 새 provider만 남으면 선택을 복구한다', async () => {
    const { document, requests } = await mounted();
    const before = requests.length;
    await toggle(document, 'operation', 'bus-route', false);
    await toggle(document, 'provider', 'metro', false);
    expect(
      options(document, 'operation').map((input) => [
        input.value,
        input.checked,
      ]),
    ).toEqual([
      ['bus-arrival', true],
      ['bus-route', false],
    ]);
    await toggle(document, 'provider', 'metro', true);
    await toggle(document, 'provider', 'seoul-bus', false);
    expect(
      options(document, 'operation').map((input) => [
        input.value,
        input.checked,
      ]),
    ).toEqual([['train-arrival', true]]);
    expect(requests).toHaveLength(before);
  });

  it('Apply는 한번 요청하고 range 변경은 applied dimension을 보존한다', async () => {
    const { document, requests } = await mounted();
    await toggle(document, 'operation', 'bus-route', false);
    const before = requests.length;
    await document.getElementById('filter-apply').dispatch('click');
    expect(requests.slice(before)).toEqual([
      '/api/dashboard/metrics?range=24h&providers=seoul-bus%2Cmetro&operations=bus-arrival%2Ctrain-arrival',
    ]);
    await toggle(document, 'provider', 'metro', false);
    document.getElementById('range-select').value = '30d';
    await document.getElementById('range-select').dispatch('change');
    expect(requests.at(-1)).toBe(
      '/api/dashboard/metrics?range=30d&providers=seoul-bus%2Cmetro&operations=bus-arrival%2Ctrain-arrival',
    );
  });

  it('Apply 뒤 range 변경에서 늦은 이전 dimension 응답을 무시한다', async () => {
    const document = new FakeDocument();
    const first = deferred<FakeResponse>();
    const second = deferred<FakeResponse>();
    let count = 0;
    mount(
      document,
      async (url) => {
        if (url.endsWith('/session')) return response(200);
        if (url.endsWith('/metric-dimensions')) return response(200, catalog);
        count += 1;
        return count === 1
          ? response(200, metricsPayload(1))
          : count === 2
          ? first.promise
          : second.promise;
      },
      () => FakeChart,
    );
    await settleAsyncWork();
    await toggle(document, 'provider', 'metro', false);
    const apply = document.getElementById('filter-apply').dispatch('click');
    document.getElementById('range-select').value = '90d';
    const range = document.getElementById('range-select').dispatch('change');
    second.resolve(response(200, metricsPayload(90)));
    await range;
    first.resolve(response(200, metricsPayload(24)));
    await apply;
    expect(document.getElementById('range-requests').textContent).toBe('90');
    expect(FakeChart.instances).toHaveLength(2);
  });

  it.each([
    ['HTTP', 'before'],
    ['HTTP', 'after'],
    ['network', 'before'],
    ['network', 'after'],
  ])(
    'catalog 대기 중 logout %s 실패는 초기화를 복구하고 이전 catalog가 %s 도착해도 무시한다',
    async (failure, catalogArrival) => {
      const document = new FakeDocument();
      const initialCatalog = deferred<FakeResponse>();
      const logout = deferred<FakeResponse>();
      const requests: string[] = [];
      let catalogRequests = 0;
      let activeCookieMutations = 0;
      const fetchFn: FetchFn = async (url) => {
        requests.push(url);
        if (url.endsWith('/session')) return response(200);
        if (url.endsWith('/logout')) {
          activeCookieMutations += 1;
          expect(activeCookieMutations).toBe(1);
          try {
            const result = await logout.promise;
            if (failure === 'network') throw new Error('offline');
            return result;
          } finally {
            activeCookieMutations -= 1;
          }
        }
        if (url.endsWith('/auth')) {
          throw new Error('login must not overlap pending logout');
        }
        if (url.endsWith('/metric-dimensions')) {
          catalogRequests += 1;
          if (catalogRequests === 1) return initialCatalog.promise;
          expect(activeCookieMutations).toBe(0);
          return response(200, catalog);
        }
        expect(activeCookieMutations).toBe(0);
        return response(200, metricsPayload(7));
      };

      mount(document, fetchFn, () => FakeChart);
      await settleAsyncWork();
      expect(requests).toEqual([
        '/api/dashboard/session',
        '/api/dashboard/metric-dimensions',
      ]);
      const signingOut = document
        .getElementById('logout-button')
        .dispatch('click');
      await settleAsyncWork();
      await document.getElementById('login-form').dispatch('submit');
      await document.getElementById('logout-button').dispatch('click');
      expect(requests).toHaveLength(3);
      const staleCatalog = response(200, {
        providers: [
          {
            key: 'stale',
            label: 'stale',
            operations: [{ key: 'stale', label: 'stale' }],
          },
        ],
      });
      if (catalogArrival === 'before') {
        initialCatalog.resolve(staleCatalog);
        await settleAsyncWork();
      }
      logout.resolve(response(500));
      await signingOut;
      await settleAsyncWork();

      expect(requests).toEqual([
        '/api/dashboard/session',
        '/api/dashboard/metric-dimensions',
        '/api/dashboard/logout',
        '/api/dashboard/metric-dimensions',
        '/api/dashboard/metrics?range=24h',
      ]);
      expect(document.getElementById('dashboard-view').hidden).toBe(false);
      expect(document.getElementById('filter-apply').disabled).toBe(false);
      expect(document.getElementById('dimension-state').textContent).toBe('');
      expect(document.getElementById('range-requests').textContent).toBe('7');
      expect(document.getElementById('status-message').textContent).toContain(
        '로그아웃하지 못했습니다',
      );
      expect(options(document, 'provider').map((input) => input.value)).toEqual(
        ['seoul-bus', 'metro'],
      );
      expect(activeCookieMutations).toBe(0);
      if (catalogArrival === 'after') {
        initialCatalog.resolve(staleCatalog);
        await settleAsyncWork();
        expect(requests).toHaveLength(5);
        expect(
          options(document, 'provider').map((input) => input.value),
        ).toEqual(['seoul-bus', 'metro']);
        expect(document.getElementById('range-requests').textContent).toBe('7');
      }
    },
  );

  it('catalog 실패는 dimension을 비활성화하지만 unfiltered metrics를 불러온다', async () => {
    const document = new FakeDocument();
    const requests: string[] = [];
    mount(document, async (url) => {
      requests.push(url);
      return url.endsWith('/session')
        ? response(200)
        : url.endsWith('/metric-dimensions')
        ? response(500)
        : response(200, metricsPayload(7));
    });
    await settleAsyncWork();
    expect(document.getElementById('provider-fieldset').disabled).toBe(true);
    expect(document.getElementById('operation-fieldset').disabled).toBe(true);
    expect(document.getElementById('filter-apply').disabled).toBe(true);
    expect(requests.at(-1)).toBe('/api/dashboard/metrics?range=24h');
    expect(document.getElementById('range-requests').textContent).toBe('7');
  });

  it('선택한 요일의 point가 없으면 카드와 chart는 빈 상태다', async () => {
    const { document, requests } = await mounted();
    const before = requests.length;
    for (const day of ['1', '2', '3', '4', '5', '6'])
      await toggle(document, 'weekday', day, false);
    expect(document.getElementById('range-requests').textContent).toBe('0');
    expect(document.getElementById('range-errors').textContent).toBe('0');
    expect(document.getElementById('error-rate').textContent).toBe('0.00%');
    expect(document.getElementById('request-chart').hidden).toBe(true);
    expect(document.getElementById('chart-state').textContent).toBe(
      '선택 기간에 수집된 데이터가 없습니다.',
    );
    expect(requests).toHaveLength(before);
  });

  it('Reset은 모든 요일과 draft dimension을 선택하고 Apply까지 추가 요청하지 않는다', async () => {
    const { document, requests } = await mounted();
    await document.getElementById('weekday-preset-weekend').dispatch('click');
    await toggle(document, 'provider', 'metro', false);
    await toggle(document, 'operation', 'bus-route', false);
    const before = requests.length;
    await document.getElementById('filter-reset').dispatch('click');
    expect(options(document, 'weekday').every((input) => input.checked)).toBe(
      true,
    );
    expect(options(document, 'provider').every((input) => input.checked)).toBe(
      true,
    );
    expect(options(document, 'operation').every((input) => input.checked)).toBe(
      true,
    );
    expect(requests).toHaveLength(before);
  });
});
