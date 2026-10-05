(function (root, factory) {
  const dashboard = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = dashboard;
  }
  if (root && root.document) {
    root.addEventListener("DOMContentLoaded", function () {
      dashboard.mount(
        root.document,
        root.fetch.bind(root),
        function () {
          return root.Chart;
        },
        Boolean(
          root.matchMedia &&
            root.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
      );
    });
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  "use strict";

  const API_BASE = "/api/dashboard";

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function formatCount(value) {
    return new Intl.NumberFormat("ko-KR").format(safeNumber(value));
  }

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

  function calculateErrorRate(requestCount, errorCount) {
    const requests = safeNumber(requestCount);
    return requests === 0 ? 0 : safeNumber(errorCount) / requests;
  }

  function buildChartConfig(series, range, reducedMotion) {
    const points = prepareChartSeries(series);
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
            backgroundColor: "rgba(37, 99, 235, 0.12)",
            fill: true,
            pointRadius: pointRadius,
            pointHoverRadius: 5,
          },
          {
            label: "오류",
            data: points.map(function (point) {
              return { x: point.timestamp, y: point.errorCount };
            }),
            borderColor: "#dc2626",
            backgroundColor: "#dc2626",
            borderDash: [6, 4],
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
          legend: { display: true, position: "top", align: "end" },
          tooltip: {
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
            ticks: {
              autoSkip: true,
              maxRotation: 0,
              callback: function (timestamp) {
                return formatChartTimestamp(timestamp, range, false);
              },
            },
          },
          y: { beginAtZero: true, ticks: { precision: 0 } },
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
      series: seriesSource.map(function (point) {
        const sourcePoint = point && typeof point === "object" ? point : {};
        return {
          start: typeof sourcePoint.start === "string" ? sourcePoint.start : "",
          requestCount: safeNumber(sourcePoint.requestCount),
          errorCount: safeNumber(sourcePoint.errorCount),
        };
      }),
    };
  }

  function mount(document, fetchFn, resolveChartConstructor, reducedMotion) {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");
    const loginForm = document.getElementById("login-form");
    const accessCode = document.getElementById("access-code");
    const rangeSelect = document.getElementById("range-select");
    const logoutButton = document.getElementById("logout-button");
    const statusMessage = document.getElementById("status-message");
    const refreshButton = document.getElementById("refresh-button");
    const chartRenderer = createChartRenderer(
      resolveChartConstructor,
      reducedMotion
    );
    let metricRequestGeneration = 0;
    let authRequestGeneration = 0;

    function beginAuthRequest() {
      authRequestGeneration += 1;
      return authRequestGeneration;
    }

    function isCurrentAuthRequest(generation) {
      return generation === authRequestGeneration;
    }

    function setStatus(message, isError) {
      statusMessage.textContent = message || "";
      statusMessage.dataset.state = isError ? "error" : "normal";
    }

    function showLogin(message) {
      metricRequestGeneration += 1;
      chartRenderer.destroy();
      loginView.hidden = false;
      dashboardView.hidden = true;
      setStatus(message || "", Boolean(message));
      accessCode.focus();
    }

    function showDashboard() {
      loginView.hidden = true;
      dashboardView.hidden = false;
      setStatus("", false);
    }

    async function apiFetch(path, options) {
      const request = Object.assign(
        { credentials: "same-origin", headers: {} },
        options || {}
      );
      if (request.body) {
        request.headers = Object.assign({}, request.headers, {
          "Content-Type": "application/json",
        });
      }
      return fetchFn(`${API_BASE}${path}`, request);
    }

    function renderMetrics(payload) {
      const metrics = normalizeMetrics(payload);
      document.getElementById("today-requests").textContent = formatCount(
        metrics.summary.todayRequests
      );
      document.getElementById("month-requests").textContent = formatCount(
        metrics.summary.monthRequests
      );
      document.getElementById("range-requests").textContent = formatCount(
        metrics.summary.rangeRequests
      );
      document.getElementById("range-errors").textContent = formatCount(
        metrics.summary.rangeErrors
      );
      document.getElementById("error-rate").textContent = `${(
        metrics.summary.errorRate * 100
      ).toFixed(2)}%`;

      const collected = metrics.summary.lastCollectedAt
        ? new Date(metrics.summary.lastCollectedAt)
        : null;
      document.getElementById("last-collected-at").textContent =
        collected && !Number.isNaN(collected.getTime())
          ? collected.toLocaleString("ko-KR")
          : "수집 내역 없음";

      chartRenderer.render(
        document.getElementById("request-chart"),
        document.getElementById("chart-state"),
        metrics.series,
        rangeSelect.value
      );
    }

    async function loadMetrics() {
      const generation = ++metricRequestGeneration;
      setStatus("통계를 불러오는 중입니다.", false);
      try {
        const response = await apiFetch(
          `/metrics?range=${encodeURIComponent(rangeSelect.value)}`
        );
        if (generation !== metricRequestGeneration) {
          return;
        }
        if (response.status === 401) {
          showLogin("세션이 만료되었습니다. 다시 로그인하세요.");
          return;
        }
        if (!response.ok) {
          throw new Error("metric request failed");
        }
        const payload = await response.json();
        if (generation !== metricRequestGeneration) {
          return;
        }
        renderMetrics(payload);
        setStatus("", false);
      } catch (error) {
        if (generation === metricRequestGeneration) {
          setStatus(
            "통계를 불러오지 못했습니다. 잠시 후 다시 시도하세요.",
            true
          );
        }
      }
    }

    async function checkSession() {
      const generation = beginAuthRequest();
      try {
        const response = await apiFetch("/session");
        if (!isCurrentAuthRequest(generation)) {
          return;
        }
        if (response.ok) {
          showDashboard();
          await loadMetrics();
          return;
        }
        showLogin("");
      } catch (error) {
        if (isCurrentAuthRequest(generation)) {
          showLogin("서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
        }
      }
    }

    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const generation = beginAuthRequest();
      const code = accessCode.value;
      setStatus("인증 중입니다.", false);
      try {
        const response = await apiFetch("/auth", {
          method: "POST",
          body: JSON.stringify({ code: code }),
        });
        if (!isCurrentAuthRequest(generation)) {
          return;
        }
        accessCode.value = "";
        if (!response.ok) {
          setStatus(
            response.status === 429
              ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."
              : "개발자 코드를 확인하세요.",
            true
          );
          return;
        }
        showDashboard();
        await loadMetrics();
      } catch (error) {
        if (isCurrentAuthRequest(generation)) {
          accessCode.value = "";
          setStatus(
            "로그인 요청에 실패했습니다. 잠시 후 다시 시도하세요.",
            true
          );
        }
      }
    });

    rangeSelect.addEventListener("change", loadMetrics);
    refreshButton.addEventListener("click", loadMetrics);
    logoutButton.addEventListener("click", async function () {
      const generation = beginAuthRequest();
      setStatus("로그아웃 중입니다.", false);
      try {
        const response = await apiFetch("/logout", { method: "POST" });
        if (!isCurrentAuthRequest(generation)) {
          return;
        }
        if (!response.ok) {
          throw new Error("logout request failed");
        }
        showLogin("");
        setStatus("로그아웃했습니다.", false);
      } catch (error) {
        if (isCurrentAuthRequest(generation)) {
          setStatus("로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.", true);
        }
      }
    });

    checkSession();
  }

  return {
    formatCount: formatCount,
    prepareChartSeries: prepareChartSeries,
    formatChartTimestamp: formatChartTimestamp,
    calculateErrorRate: calculateErrorRate,
    buildChartConfig: buildChartConfig,
    createChartRenderer: createChartRenderer,
    normalizeMetrics: normalizeMetrics,
    mount: mount,
  };
});
