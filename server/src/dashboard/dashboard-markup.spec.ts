import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadDashboardScripts,
  FakeDocument,
  FakeChart,
  response,
  metricsPayload,
  settleAsyncWork,
} from './testing/dashboard-fixture';

describe('Dashboard static markup', () => {
  function sectionRange(html: string, id: string): [number, number] {
    const idIndex = html.indexOf(`id="${id}"`);
    const start = html.lastIndexOf('<section', idIndex);
    const sectionTag = /<\/?section\b[^>]*>/g;
    sectionTag.lastIndex = start;
    let depth = 0;
    let match: RegExpExecArray | null;
    while ((match = sectionTag.exec(html))) {
      depth += match[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return [start, sectionTag.lastIndex];
    }
    throw new Error(`unclosed section: ${id}`);
  }

  it('인증 상태 메시지는 숨겨지는 login/dashboard view 밖에 둔다', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../dashboard/index.html'),
      'utf8',
    );
    const statusIndex = html.indexOf('id="status-message"');

    for (const viewId of ['login-view', 'dashboard-view']) {
      const [start, end] = sectionRange(html, viewId);
      expect(statusIndex < start || statusIndex > end).toBe(true);
    }
  });

  it('확장 가능한 관리자 shell에 현재 API Metrics 메뉴만 노출한다', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../dashboard/index.html'),
      'utf8',
    );

    expect(html).toMatch(/<aside[^>]+class="admin-sidebar"/);
    expect(html).toMatch(/<nav[^>]+aria-label="관리자 메뉴"/);
    expect(html).toMatch(/<main[^>]+class="admin-main"/);
    expect(html).toContain('aria-current="page"');
    expect(html.match(/class="admin-nav-link/g)).toHaveLength(1);
  });

  it('900px에서 chart와 filter를 쌓고 620px에서 chart 높이를 줄인다', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../dashboard/dashboard.css'),
      'utf8',
    );
    const tabletMedia = css.match(
      /@media \(max-width: 900px\) \{([\s\S]*?)(?=@media|$)/,
    );
    expect(tabletMedia).not.toBeNull();
    expect(tabletMedia?.[1]).toMatch(
      /\.metrics-workspace\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*grid-template-areas:\s*"chart"\s*"filters";/,
    );
    expect(tabletMedia?.[1]).toMatch(/\.admin-sidebar\s*\{[^}]*height: auto;/);
    expect(css).toMatch(/\.chart-container\s*\{[^}]*height: 400px;/);
    expect(css).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*\.chart-container\s*\{[\s\S]*height: 300px;/,
    );
  });

  it('chart 앞에 요일 preset과 native dimension fieldset 및 Apply/Reset을 제공한다', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../dashboard/index.html'),
      'utf8',
    );
    for (const id of [
      'metric-filter-title',
      'weekday-filters',
      'provider-filters',
      'operation-filters',
      'filter-reset',
      'filter-apply',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<fieldset\s+id="provider-fieldset"/);
    expect(html).toMatch(/<fieldset\s+id="operation-fieldset"/);
    expect(html.indexOf('id="weekday-filters"')).toBeLessThan(
      html.indexOf('class="chart-container"'),
    );
    for (const preset of ['all', 'weekday', 'weekend'])
      expect(html).toContain(`data-weekday-preset="${preset}"`);
  });
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
    loadDashboardScripts(window);
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
