(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.WmbDashboardData = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function formatCount(value) {
    return new Intl.NumberFormat("ko-KR").format(safeNumber(value));
  }

  function calculateErrorRate(requestCount, errorCount) {
    const requests = safeNumber(requestCount);
    return requests === 0 ? 0 : safeNumber(errorCount) / requests;
  }

  function normalizeMetrics(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const summarySource =
      source.summary && typeof source.summary === "object"
        ? source.summary
        : {};
    const seriesSource = Array.isArray(source.series) ? source.series : [];

    return {
      summary: {
        todayRequests: safeNumber(summarySource.todayRequests),
        monthRequests: safeNumber(summarySource.monthRequests),
        rangeRequests: safeNumber(summarySource.rangeRequests),
        rangeErrors: safeNumber(summarySource.rangeErrors),
        errorRate: safeNumber(summarySource.errorRate),
        lastCollectedAt:
          typeof summarySource.lastCollectedAt === "string"
            ? summarySource.lastCollectedAt
            : null,
      },
      series: seriesSource
        .filter(function (point) {
          return (
            point &&
            Number.isInteger(point.weekday) &&
            point.weekday >= 1 &&
            point.weekday <= 7
          );
        })
        .map(function (point) {
          const sourcePoint = point && typeof point === "object" ? point : {};
          return {
            start:
              typeof sourcePoint.start === "string" ? sourcePoint.start : "",
            requestCount: safeNumber(sourcePoint.requestCount),
            errorCount: safeNumber(sourcePoint.errorCount),
            weekday: sourcePoint.weekday,
          };
        }),
    };
  }

  function normalizeDimensionCatalog(payload) {
    const providers = [];
    const providerKeys = new Set();
    const source =
      payload && Array.isArray(payload.providers) ? payload.providers : [];
    source.forEach(function (provider) {
      if (
        !provider ||
        typeof provider.key !== "string" ||
        !provider.key.trim() ||
        typeof provider.label !== "string" ||
        providerKeys.has(provider.key) ||
        !Array.isArray(provider.operations)
      )
        return;
      const operationKeys = new Set();
      const operations = [];
      provider.operations.forEach(function (operation) {
        if (
          !operation ||
          typeof operation.key !== "string" ||
          !operation.key.trim() ||
          typeof operation.label !== "string" ||
          operationKeys.has(operation.key)
        )
          return;
        operationKeys.add(operation.key);
        operations.push({ key: operation.key, label: operation.label });
      });
      if (!operations.length) return;
      providerKeys.add(provider.key);
      providers.push({
        key: provider.key,
        label: provider.label,
        operations: operations,
      });
    });
    return { providers: providers };
  }

  function filterSeriesByWeekdays(series, weekdays) {
    const selected = new Set(weekdays);
    return normalizeMetrics({ series: series }).series.filter(function (point) {
      return selected.has(point.weekday);
    });
  }

  function summarizeSeries(series) {
    const totals = series.reduce(
      function (summary, point) {
        summary.requestCount += safeNumber(point.requestCount);
        summary.errorCount += safeNumber(point.errorCount);
        return summary;
      },
      { requestCount: 0, errorCount: 0 }
    );
    return {
      requestCount: totals.requestCount,
      errorCount: totals.errorCount,
      errorRate: calculateErrorRate(totals.requestCount, totals.errorCount),
    };
  }

  function buildMetricsQuery(range, providers, operations) {
    let query = `/metrics?range=${encodeURIComponent(range)}`;
    if (providers.length)
      query += `&providers=${encodeURIComponent(providers.join(","))}`;
    if (operations.length)
      query += `&operations=${encodeURIComponent(operations.join(","))}`;
    return query;
  }

  return {
    safeNumber,
    formatCount,
    calculateErrorRate,
    normalizeMetrics,
    normalizeDimensionCatalog,
    filterSeriesByWeekdays,
    summarizeSeries,
    buildMetricsQuery,
  };
});
