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

  function mount(document, fetchFn, resolveChartConstructor, reducedMotion) {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");
    const loginForm = document.getElementById("login-form");
    const accessCode = document.getElementById("access-code");
    const rangeSelect = document.getElementById("range-select");
    const logoutButton = document.getElementById("logout-button");
    const statusMessage = document.getElementById("status-message");
    const refreshButton = document.getElementById("refresh-button");
    const applyButton = document.getElementById("filter-apply");
    const dimensionState = document.getElementById("dimension-state");
    const allWeekdays = [1, 2, 3, 4, 5, 6, 7];
    const filterState = {
      weekdays: new Set(allWeekdays),
      draftProviders: new Set(),
      draftOperations: new Set(),
      appliedProviders: [],
      appliedOperations: [],
      catalog: { providers: [] },
      metrics: null,
      range: rangeSelect.value,
    };
    let dimensionRequestGeneration = 0;
    let dashboardInitializationGeneration = null;
    let dimensionsReady = false;
    const chartRenderer = createChartRenderer(
      resolveChartConstructor,
      reducedMotion
    );
    let metricRequestGeneration = 0;
    let authRequestGeneration = 0;
    let cookieMutationQueue = Promise.resolve();
    let loginPending = false;
    let logoutPending = false;

    function mutateSessionCookie(path, options) {
      const operation = cookieMutationQueue.then(function () {
        return apiFetch(path, options);
      });
      cookieMutationQueue = operation.catch(function () {});
      return operation;
    }

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
      dimensionRequestGeneration += 1;
      filterState.metrics = null;
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

    function renderMetrics() {
      const metrics = filterState.metrics;
      if (!metrics) return;
      const series = filterSeriesByWeekdays(
        metrics.series,
        filterState.weekdays
      );
      const summary = summarizeSeries(series);
      document.getElementById("today-requests").textContent = formatCount(
        metrics.summary.todayRequests
      );
      document.getElementById("month-requests").textContent = formatCount(
        metrics.summary.monthRequests
      );
      document.getElementById("range-requests").textContent = formatCount(
        summary.requestCount
      );
      document.getElementById("range-errors").textContent = formatCount(
        summary.errorCount
      );
      document.getElementById("error-rate").textContent = `${(
        summary.errorRate * 100
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
        series,
        filterState.range
      );
    }

    function createOption(group, key, labelText, selected, onChange) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const text = document.createElement("span");
      label.className = "filter-option";
      input.id = `${group}-option-${key}`;
      input.type = "checkbox";
      input.value = String(key);
      input.checked = selected.has(key);
      label.htmlFor = input.id;
      text.textContent = labelText;
      input.addEventListener("change", function () {
        if (!input.checked && selected.size === 1) {
          input.checked = true;
          return;
        }
        if (input.checked) selected.add(key);
        else selected.delete(key);
        onChange();
      });
      label.appendChild(input);
      label.appendChild(text);
      return label;
    }

    function renderWeekdays() {
      const container = document.getElementById("weekday-filters");
      container.replaceChildren();
      const labels = [
        "월요일",
        "화요일",
        "수요일",
        "목요일",
        "금요일",
        "토요일",
        "일요일",
      ];
      allWeekdays.forEach(function (day) {
        container.appendChild(
          createOption(
            "weekday",
            day,
            labels[day - 1],
            filterState.weekdays,
            function () {
              updatePresets();
              renderMetrics();
            }
          )
        );
      });
      updatePresets();
    }

    function presetDays(preset) {
      return preset === "weekday"
        ? [1, 2, 3, 4, 5]
        : preset === "weekend"
        ? [6, 7]
        : allWeekdays;
    }

    function updatePresets() {
      document
        .querySelectorAll("[data-weekday-preset]")
        .forEach(function (button) {
          const days = presetDays(button.dataset.weekdayPreset);
          button.setAttribute(
            "aria-pressed",
            String(
              days.length === filterState.weekdays.size &&
                days.every(function (day) {
                  return filterState.weekdays.has(day);
                })
            )
          );
        });
    }

    function compatibleOperations() {
      const operations = new Map();
      filterState.catalog.providers.forEach(function (provider) {
        if (filterState.draftProviders.has(provider.key))
          provider.operations.forEach(function (operation) {
            if (!operations.has(operation.key))
              operations.set(operation.key, operation);
          });
      });
      return Array.from(operations.values());
    }

    function reconcileOperations() {
      const operations = compatibleOperations();
      const keys = new Set(
        operations.map(function (operation) {
          return operation.key;
        })
      );
      filterState.draftOperations.forEach(function (key) {
        if (!keys.has(key)) filterState.draftOperations.delete(key);
      });
      if (!filterState.draftOperations.size)
        keys.forEach(function (key) {
          filterState.draftOperations.add(key);
        });
      renderOperations();
    }

    function renderOperations() {
      const container = document.getElementById("operation-filters");
      container.replaceChildren();
      compatibleOperations().forEach(function (operation) {
        container.appendChild(
          createOption(
            "operation",
            operation.key,
            operation.label,
            filterState.draftOperations,
            function () {}
          )
        );
      });
    }

    function selectAllDimensions() {
      filterState.draftProviders = new Set(
        filterState.catalog.providers.map(function (provider) {
          return provider.key;
        })
      );
      filterState.draftOperations = new Set();
      compatibleOperations().forEach(function (operation) {
        filterState.draftOperations.add(operation.key);
      });
    }

    function renderDimensions() {
      const container = document.getElementById("provider-filters");
      container.replaceChildren();
      filterState.catalog.providers.forEach(function (provider) {
        container.appendChild(
          createOption(
            "provider",
            provider.key,
            provider.label,
            filterState.draftProviders,
            reconcileOperations
          )
        );
      });
      renderOperations();
    }

    function setDimensionsEnabled(enabled) {
      dimensionsReady = enabled;
      document.getElementById("provider-fieldset").disabled = !enabled;
      document.getElementById("operation-fieldset").disabled = !enabled;
      applyButton.disabled = !enabled;
    }

    async function loadDimensions(authGeneration) {
      const generation = ++dimensionRequestGeneration;
      const isCurrent = function () {
        return (
          generation === dimensionRequestGeneration &&
          isCurrentAuthRequest(authGeneration)
        );
      };
      setDimensionsEnabled(false);
      filterState.appliedProviders = [];
      filterState.appliedOperations = [];
      dimensionState.textContent = "API 분류를 불러오는 중입니다.";
      try {
        const response = await apiFetch("/metric-dimensions");
        if (!isCurrent()) return false;
        if (response.status === 401) {
          showLogin("세션이 만료되었습니다. 다시 로그인하세요.");
          return false;
        }
        if (!response.ok) throw new Error("dimension request failed");
        const payload = await response.json();
        if (!isCurrent()) return false;
        const catalog = normalizeDimensionCatalog(payload);
        if (!catalog.providers.length)
          throw new Error("empty dimension catalog");
        filterState.catalog = catalog;
        selectAllDimensions();
        renderDimensions();
        setDimensionsEnabled(true);
        dimensionState.textContent = "";
      } catch (error) {
        if (!isCurrent()) return false;
        filterState.catalog = { providers: [] };
        selectAllDimensions();
        renderDimensions();
        setDimensionsEnabled(false);
        dimensionState.textContent =
          "API 분류를 불러오지 못했습니다. 전체 API 통계를 표시합니다.";
      }
      return isCurrent();
    }

    async function loadDashboard(authGeneration) {
      dashboardInitializationGeneration = authGeneration;
      let initialized;
      try {
        initialized = await loadDimensions(authGeneration);
      } finally {
        if (dashboardInitializationGeneration === authGeneration) {
          dashboardInitializationGeneration = null;
        }
      }
      if (initialized) await loadMetrics();
    }

    async function loadMetrics() {
      const generation = ++metricRequestGeneration;
      const range = rangeSelect.value;
      setStatus("통계를 불러오는 중입니다.", false);
      try {
        const response = await apiFetch(
          buildMetricsQuery(
            range,
            filterState.appliedProviders,
            filterState.appliedOperations
          )
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
        filterState.metrics = normalizeMetrics(payload);
        filterState.range = range;
        renderMetrics();
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
          await loadDashboard(generation);
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
      if (loginPending || logoutPending) {
        return;
      }
      loginPending = true;
      loginForm.setAttribute("aria-busy", "true");
      const generation = beginAuthRequest();
      const code = accessCode.value;
      setStatus("인증 중입니다.", false);
      try {
        const response = await mutateSessionCookie("/auth", {
          method: "POST",
          body: JSON.stringify({ code: code }),
        });
        accessCode.value = "";
        if (!isCurrentAuthRequest(generation)) {
          return;
        }
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
        await loadDashboard(generation);
      } catch (error) {
        if (isCurrentAuthRequest(generation)) {
          accessCode.value = "";
          setStatus(
            "로그인 요청에 실패했습니다. 잠시 후 다시 시도하세요.",
            true
          );
        }
      } finally {
        loginPending = false;
        accessCode.value = "";
        loginForm.setAttribute("aria-busy", "false");
      }
    });

    rangeSelect.addEventListener("change", loadMetrics);
    document
      .querySelectorAll("[data-weekday-preset]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          filterState.weekdays = new Set(
            presetDays(button.dataset.weekdayPreset)
          );
          renderWeekdays();
          renderMetrics();
        });
      });
    applyButton.addEventListener("click", function () {
      if (!dimensionsReady) return;
      filterState.appliedProviders = Array.from(filterState.draftProviders);
      filterState.appliedOperations = compatibleOperations()
        .filter(function (operation) {
          return filterState.draftOperations.has(operation.key);
        })
        .map(function (operation) {
          return operation.key;
        });
      return loadMetrics();
    });
    document
      .getElementById("filter-reset")
      .addEventListener("click", function () {
        filterState.weekdays = new Set(allWeekdays);
        selectAllDimensions();
        renderWeekdays();
        renderDimensions();
        renderMetrics();
      });
    refreshButton.addEventListener("click", loadMetrics);
    logoutButton.addEventListener("click", async function () {
      if (logoutPending) {
        return;
      }
      logoutPending = true;
      const initializationInterrupted =
        dashboardInitializationGeneration !== null;
      const generation = beginAuthRequest();
      setStatus("로그아웃 중입니다.", false);
      try {
        const response = await mutateSessionCookie("/logout", {
          method: "POST",
        });
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
          if (initializationInterrupted && !dashboardView.hidden) {
            await loadDashboard(generation);
          }
          if (isCurrentAuthRequest(generation) && !dashboardView.hidden) {
            setStatus(
              "로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.",
              true
            );
          }
        }
      } finally {
        logoutPending = false;
      }
    });

    renderWeekdays();
    setDimensionsEnabled(false);
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
    normalizeDimensionCatalog: normalizeDimensionCatalog,
    filterSeriesByWeekdays: filterSeriesByWeekdays,
    summarizeSeries: summarizeSeries,
    buildMetricsQuery: buildMetricsQuery,
    mount: mount,
  };
});
