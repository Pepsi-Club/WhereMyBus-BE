(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./dashboard-data.js"));
  } else {
    root.WmbDashboardChart = factory(root.WmbDashboardData);
  }
})(typeof window !== "undefined" ? window : globalThis, function (data) {
  "use strict";

  const { safeNumber, formatCount, calculateErrorRate } = data;

  function prepareChartSeries(series) {
    return (Array.isArray(series) ? series : [])
      .map(function (point) {
        return {
          timestamp: Date.parse(point.start),
          start: point.start,
          requestCount: safeNumber(point.requestCount),
          errorCount: safeNumber(point.errorCount),
        };
      })
      .filter(function (point) {
        return Number.isFinite(point.timestamp);
      })
      .sort(function (left, right) {
        return left.timestamp - right.timestamp;
      });
  }

  function formatChartTimestamp(timestamp, range, includeTime) {
    const options = {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hourCycle: "h23",
    };
    if (includeTime || range === "24h") {
      options.hour = "2-digit";
      options.minute = "2-digit";
    } else if (range === "7d") {
      options.hour = "2-digit";
    }
    return new Intl.DateTimeFormat("ko-KR", options).format(timestamp);
  }

  function buildChartConfig(series, range, reducedMotion) {
    const points = prepareChartSeries(series);
    const halfInterval =
      (range === "30d" || range === "90d"
        ? 24 * 60 * 60 * 1000
        : 60 * 60 * 1000) / 2;
    const pointRadius = points.length <= 30 ? 3 : 0;
    const rateFormatter = new Intl.NumberFormat("ko-KR", {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return {
      type: "line",
      data: {
        datasets: [
          {
            label: "요청",
            data: points.map(function (point) {
              return { x: point.timestamp, y: point.requestCount };
            }),
            borderColor: "#2563eb",
            backgroundColor: "rgba(37, 99, 235, 0.08)",
            borderWidth: 2,
            tension: 0.28,
            fill: true,
            pointRadius: pointRadius,
            pointHoverRadius: 5,
          },
          {
            label: "오류",
            data: points.map(function (point) {
              return { x: point.timestamp, y: point.errorCount };
            }),
            borderColor: "#c53f4f",
            backgroundColor: "#c53f4f",
            borderWidth: 1.5,
            borderDash: [5, 4],
            tension: 0.28,
            fill: false,
            pointRadius: pointRadius,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: reducedMotion ? false : { duration: 250 },
        interaction: { mode: "index", intersect: false, axis: "x" },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              usePointStyle: true,
              pointStyle: "line",
              color: "#475467",
              boxWidth: 24,
              boxHeight: 8,
              padding: 18,
            },
          },
          tooltip: {
            backgroundColor: "#111827",
            padding: 12,
            cornerRadius: 7,
            callbacks: {
              title: function (items) {
                return items.length
                  ? formatChartTimestamp(items[0].parsed.x, range, true)
                  : "";
              },
              label: function (item) {
                return `${item.dataset.label}: ${formatCount(item.parsed.y)}건`;
              },
              afterBody: function (items) {
                const point = items.length ? points[items[0].dataIndex] : null;
                return point
                  ? `오류율: ${rateFormatter.format(
                      calculateErrorRate(point.requestCount, point.errorCount)
                    )}`
                  : "";
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: points.length ? points[0].timestamp - halfInterval : undefined,
            max: points.length
              ? points[points.length - 1].timestamp + halfInterval
              : undefined,
            ticks: {
              autoSkip: true,
              maxRotation: 0,
              color: "#7b8492",
              padding: 10,
              callback: function (timestamp) {
                return formatChartTimestamp(timestamp, range, false);
              },
            },
            grid: { color: "#edf0f3", drawTicks: false },
            border: { color: "#dfe3e8" },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: "#7b8492", padding: 10 },
            grid: { color: "#edf0f3", drawTicks: false },
            border: { display: false },
          },
        },
      },
    };
  }

  function createChartRenderer(resolveChartConstructor, reducedMotion) {
    let chart = null;

    function destroy() {
      if (chart) {
        chart.destroy();
        chart = null;
      }
    }

    function render(canvas, stateElement, series, range) {
      destroy();
      const points = prepareChartSeries(series);
      if (points.length === 0) {
        canvas.hidden = true;
        stateElement.hidden = false;
        stateElement.textContent = "선택 기간에 수집된 데이터가 없습니다.";
        return;
      }

      const rangeLabels = {
        "24h": "최근 24시간",
        "7d": "최근 7일",
        "30d": "최근 30일",
        "90d": "최근 90일",
      };
      const totals = points.reduce(
        function (sum, point) {
          sum.requests += point.requestCount;
          sum.errors += point.errorCount;
          return sum;
        },
        { requests: 0, errors: 0 }
      );
      canvas.setAttribute(
        "aria-label",
        `${rangeLabels[range] || "선택 기간"}: 요청 ${formatCount(
          totals.requests
        )}건, 오류 ${formatCount(totals.errors)}건, ${formatCount(
          points.length
        )}개 시점`
      );

      let ChartConstructor;
      try {
        ChartConstructor = resolveChartConstructor();
        if (typeof ChartConstructor !== "function") {
          throw new Error("Chart.js unavailable");
        }
        canvas.hidden = false;
        chart = new ChartConstructor(
          canvas,
          buildChartConfig(series, range, reducedMotion)
        );
        stateElement.hidden = true;
        stateElement.textContent = "";
      } catch (error) {
        canvas.hidden = true;
        stateElement.hidden = false;
        stateElement.textContent =
          "차트를 표시하지 못했습니다. 새로고침해 주세요.";
        try {
          if (
            ChartConstructor &&
            typeof ChartConstructor.getChart === "function"
          ) {
            const failedChart = ChartConstructor.getChart(canvas);
            if (failedChart) {
              failedChart.destroy();
            }
          }
        } catch (cleanupError) {
          // Keep the failure state visible if partial-instance cleanup also fails.
        }
      }
    }

    return { render: render, destroy: destroy };
  }

  return {
    prepareChartSeries,
    formatChartTimestamp,
    buildChartConfig,
    createChartRenderer,
  };
});
