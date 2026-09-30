import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

const dashboardModule = { exports: {} };
runInNewContext(
  readFileSync(resolve(__dirname, '../../../dashboard/dashboard.js'), 'utf8'),
  { module: dashboardModule, Intl },
);

const { formatCount, buildLinePath, normalizeMetrics } =
  dashboardModule.exports as {
    formatCount: (value: unknown) => string;
    buildLinePath: (
      series: Array<{ requestCount: number }>,
      width: number,
      height: number,
    ) => string;
    normalizeMetrics: (payload: unknown) => unknown;
  };

describe('Dashboard static helpers', () => {
  it('큰 count를 한국어 locale 숫자로 표시한다', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('빈 series는 빈 SVG path를 만든다', () => {
    expect(buildLinePath([], 800, 240)).toBe('');
  });

  it('requestCount가 모두 0이어도 유한 좌표만 만든다', () => {
    expect(
      buildLinePath([{ requestCount: 0 }, { requestCount: 0 }], 100, 50),
    ).toBe('M 0 50 L 100 50');
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
