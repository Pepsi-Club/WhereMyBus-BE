import {
  ChartRange,
  TooltipItem,
  FakeDocument,
  FakeChart,
  formatCount,
  prepareChartSeries,
  formatChartTimestamp,
  calculateErrorRate,
  buildChartConfig,
  createChartRenderer,
  normalizeMetrics,
} from './testing/dashboard-fixture';

describe('Dashboard static helpers', () => {
  it.each<[ChartRange, number, number]>([
    ['24h', 1790778600000, 1790782200000],
    ['7d', 1790778600000, 1790782200000],
    ['30d', 1790737200000, 1790823600000],
    ['90d', 1790737200000, 1790823600000],
  ])('%s 단일 시점 축을 집계 간격 안에 표시한다', (range, min, max) => {
    const config = buildChartConfig(
      [{ start: '2026-10-01T00:00:00+09:00', requestCount: 3, errorCount: 0 }],
      range,
      false,
    );
    expect(config.options.scales.x).toMatchObject({ type: 'linear', min, max });
    expect(config.data.datasets[0].data).toEqual([{ x: 1790780400000, y: 3 }]);
  });

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
      borderDash: [5, 4],
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
    expect(config.options.plugins.legend.labels).toMatchObject({
      usePointStyle: true,
      pointStyle: 'line',
    });
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
    expect(config.options.scales.x).toMatchObject({
      min: 1790737200000,
      max: 1793329200000,
    });
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
            weekday: 3,
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
          weekday: 3,
        },
      ],
    });
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
