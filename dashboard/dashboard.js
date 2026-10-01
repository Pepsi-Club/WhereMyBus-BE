(function (root, factory) {
  const dashboard = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = dashboard;
  }
  if (root && root.document) {
    root.addEventListener("DOMContentLoaded", function () {
      dashboard.mount(root.document, root.fetch.bind(root));
    });
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  "use strict";

  const API_BASE = "/api/dashboard";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function formatCount(value) {
    return new Intl.NumberFormat("ko-KR").format(safeNumber(value));
  }

  function buildLinePath(series, width, height) {
    return buildChartPoints(series, width, height)
      .map(function (point, index) {
        return `${
          index === 0 ? "M" : "L"
        } ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`;
      })
      .join(" ");
  }

  function buildChartPoints(series, width, height) {
    if (!Array.isArray(series) || series.length === 0) {
      return [];
    }
    const counts = series.map(function (point) {
      return safeNumber(point.requestCount);
    });
    const timestamps = series.map(function (point) {
      return Date.parse(point.start);
    });
    const hasValidTimestamps = timestamps.every(Number.isFinite);
    const firstTimestamp = hasValidTimestamps
      ? Math.min.apply(null, timestamps)
      : 0;
    const lastTimestamp = hasValidTimestamps
      ? Math.max.apply(null, timestamps)
      : 0;
    const max = Math.max.apply(null, counts);

    return series.map(function (point, index) {
      let x = width / 2;
      if (series.length > 1) {
        x =
          hasValidTimestamps && lastTimestamp > firstTimestamp
            ? ((timestamps[index] - firstTimestamp) /
                (lastTimestamp - firstTimestamp)) *
              width
            : (index / (series.length - 1)) * width;
      }
      const count = counts[index];
      return {
        x: x,
        y: max === 0 ? height : height - (count / max) * height,
        start: typeof point.start === "string" ? point.start : "",
        requestCount: count,
      };
    });
  }

  function formatCoordinate(value) {
    return Number(value.toFixed(2)).toString();
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

  function mount(document, fetchFn) {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");
    const loginForm = document.getElementById("login-form");
    const accessCode = document.getElementById("access-code");
    const rangeSelect = document.getElementById("range-select");
    const logoutButton = document.getElementById("logout-button");
    const statusMessage = document.getElementById("status-message");
    const refreshButton = document.getElementById("refresh-button");
    let metricRequestGeneration = 0;

    function setStatus(message, isError) {
      statusMessage.textContent = message || "";
      statusMessage.dataset.state = isError ? "error" : "normal";
    }

    function showLogin(message) {
      metricRequestGeneration += 1;
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

      renderChart(document, metrics.series);
    }

    function renderChart(document, series) {
      const svg = document.getElementById("request-chart");
      const width = 800;
      const height = 240;
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

      const pathValue = buildLinePath(series, width, height);
      if (!pathValue) {
        const message = document.createElementNS(SVG_NS, "text");
        message.setAttribute("x", String(width / 2));
        message.setAttribute("y", String(height / 2));
        message.setAttribute("text-anchor", "middle");
        message.textContent = "선택 기간에 수집된 데이터가 없습니다.";
        svg.appendChild(message);
        svg.setAttribute("aria-label", "수집 데이터 없음");
        return;
      }

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathValue);
      path.setAttribute("class", "request-line");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(path);

      const points = buildChartPoints(series, width, height);
      points.forEach(function (point) {
        const marker = document.createElementNS(SVG_NS, "circle");
        marker.setAttribute("cx", formatCoordinate(point.x));
        marker.setAttribute("cy", formatCoordinate(point.y));
        marker.setAttribute("r", "4");
        marker.setAttribute("class", "request-point");
        const title = document.createElementNS(SVG_NS, "title");
        title.textContent = `${point.start || "시각 정보 없음"}: ${formatCount(
          point.requestCount
        )}건`;
        marker.appendChild(title);
        svg.appendChild(marker);
      });
      svg.setAttribute(
        "aria-label",
        `선택 기간 요청 추이: ${points
          .map(function (point) {
            return `${
              point.start || "시각 정보 없음"
            } ${formatCount(point.requestCount)}건`;
          })
          .join(", ")}`
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
      try {
        const response = await apiFetch("/session");
        if (response.ok) {
          showDashboard();
          await loadMetrics();
          return;
        }
        showLogin("");
      } catch (error) {
        showLogin("서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
      }
    }

    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const code = accessCode.value;
      setStatus("인증 중입니다.", false);
      try {
        const response = await apiFetch("/auth", {
          method: "POST",
          body: JSON.stringify({ code: code }),
        });
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
        accessCode.value = "";
        setStatus("로그인 요청에 실패했습니다. 잠시 후 다시 시도하세요.", true);
      }
    });

    rangeSelect.addEventListener("change", loadMetrics);
    refreshButton.addEventListener("click", loadMetrics);
    logoutButton.addEventListener("click", async function () {
      setStatus("로그아웃 중입니다.", false);
      try {
        const response = await apiFetch("/logout", { method: "POST" });
        if (!response.ok) {
          throw new Error("logout request failed");
        }
        showLogin("");
        setStatus("로그아웃했습니다.", false);
      } catch (error) {
        setStatus("로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.", true);
      }
    });

    checkSession();
  }

  return {
    formatCount: formatCount,
    buildLinePath: buildLinePath,
    normalizeMetrics: normalizeMetrics,
    mount: mount,
  };
});
