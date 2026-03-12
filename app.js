const store = {
  getCity() {
    return localStorage.getItem("labradar_city") || "";
  },
  setCity(city) {
    if (!city) {
      localStorage.removeItem("labradar_city");
      return;
    }
    localStorage.setItem("labradar_city", city);
  }
};

async function loadData() {
  const isAnalizy = window.location.pathname.includes("/analizy/");
  const candidates = isAnalizy
    ? ["../data.json", "data.json", "./data.json"]
    : ["data.json", "./data.json", "../data.json"];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
      lastErr = new Error("HTTP " + res.status + " for " + url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Не удалось загрузить data.json");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function formatRUB(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/ё/g, "е").trim();
}

function findTestId(data, query) {
  const q = normalize(query);
  if (!q) return null;

  for (const t of data.tests || []) {
    if (normalize(t.name).includes(q)) return t.id;
  }

  for (const t of data.tests || []) {
    if ((t.syn || []).some((x) => normalize(x).includes(q) || q.includes(normalize(x)))) {
      return t.id;
    }
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = 0;

  for (const t of data.tests || []) {
    const hay = normalize(t.name + " " + (t.syn || []).join(" "));
    let score = 0;
    for (const tok of tokens) {
      if (hay.includes(tok)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }

  return bestScore ? best : null;
}

function getSuggestions(data, q) {
  const v = normalize(q);
  if (v.length < 1) return [];
  const out = [];

  for (const t of data.tests || []) {
    const hay = normalize(t.name + " " + (t.syn || []).join(" "));
    if (hay.includes(v)) {
      out.push({
        id: t.id,
        title: t.name,
        meta: (t.syn && t.syn[0]) ? t.syn[0] : "анализ"
      });
    }
  }

  return out.slice(0, 8);
}

function computeStats(rows) {
  const prices = rows.map((r) => r.price).filter((p) => typeof p === "number");
  if (!prices.length) return { min: null, max: null, avg: null };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return { min, max, avg };
}

function buildRows(data, city, testId) {
  const priceMap = (((data.prices || {})[city] || {})[testId]) || {};
  const labsById = Object.fromEntries((data.labs || []).map((l) => [l.id, l]));
  return Object.entries(priceMap).map(([labId, price]) => ({
    labId,
    labName: labsById[labId]?.name || labId,
    price: typeof price === "number" ? price : null,
    site: labsById[labId]?.site || "#",
    locations: (labsById[labId]?.locations || []).filter((x) => x.city === city)
  }));
}

window.LabRadar = {
  store,
  loadData,
  escapeHtml,
  formatRUB,
  normalize,
  findTestId,
  getSuggestions,
  computeStats,
  buildRows
};

/* ===== Helpers ===== */
function $(id) {
  return document.getElementById(id);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

function showToast(title, text) {
  const toast = $("toast");
  if (!toast) return;
  const tt = $("toastTitle");
  const tx = $("toastText");
  if (tt) tt.textContent = title || "Готово";
  if (tx) tx.textContent = text || "";
  toast.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

/* ===== Main page controller ===== */
(function initMainPage() {
  document.addEventListener("DOMContentLoaded", async () => {
    const searchInput = $("searchInput");
    const searchBtn = $("searchBtn");
    const suggestions = $("suggestions");
    const cityPill = $("cityPill");
    const cityLabel = $("cityLabel");
    const cityModal = $("cityModal");
    const citySelect = $("citySelect");
    const closeCityModal = $("closeCityModal");
    const saveCityBtn = $("saveCityBtn");
    const detectCityBtn = $("detectCityBtn");

    if (!searchInput || !searchBtn) return;

    let data = null;
    try {
      data = await loadData();
    } catch (e) {
      console.error(e);
      return;
    }

let currentCity = store.getCity();

function detectCityByTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const map = {
      "Europe/Moscow": "Москва",
      "Europe/Samara": "Самара",
      "Europe/Volgograd": "Волгоград",
      "Europe/Kirov": "Киров",
      "Europe/Astrakhan": "Астрахань",
      "Asia/Yekaterinburg": "Екатеринбург",
      "Asia/Omsk": "Омск",
      "Asia/Krasnoyarsk": "Красноярск",
      "Asia/Irkutsk": "Иркутск",
      "Asia/Yakutsk": "Якутск",
      "Asia/Vladivostok": "Владивосток",
      "Asia/Novosibirsk": "Новосибирск"
    };
    return map[tz] || "";
  } catch(e) {
    return "";
  }
}

if (!currentCity) {
  const detected = detectCityByTimezone();
  if (detected && data.cities?.includes(detected)) {
    currentCity = detected;
  } else if (data.cities?.length) {
    currentCity = data.cities[0];
  }
  if (currentCity) store.setCity(currentCity);
}

if (cityLabel) cityLabel.textContent = currentCity || "не выбран";

    if (citySelect && data.cities) {
      citySelect.innerHTML = data.cities
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join("");
      if (currentCity) citySelect.value = currentCity;
    }

    function openCityModal() {
      if (cityModal) cityModal.classList.add("show");
    }
    function closeModal() {
      if (cityModal) cityModal.classList.remove("show");
    }

    if (cityPill) cityPill.addEventListener("click", openCityModal);
    if (closeCityModal) closeCityModal.addEventListener("click", closeModal);
    if (cityModal) {
      cityModal.addEventListener("click", (e) => {
        if (e.target === cityModal) closeModal();
      });
    }

    if (saveCityBtn) {
      saveCityBtn.addEventListener("click", () => {
        const selected = citySelect?.value || "";
        if (!selected) return;
        store.setCity(selected);
        if (cityLabel) cityLabel.textContent = selected;
        closeModal();
      });
    }

    if (detectCityBtn) {
      detectCityBtn.addEventListener("click", () => {
        if (data.cities?.length) {
          const detected = data.cities[0];
          if (citySelect) citySelect.value = detected;
        }
      });
    }

    function doSearch(testTitle) {
      const q = (testTitle || searchInput.value || "").trim();
      const city = store.getCity() || "";
      if (!q) return;
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      params.set("q", q);
      const found = findTestId(data, q);
      if (found) params.set("test", found);
      window.location.href = "search.html?" + params.toString();
    }

    function renderSuggestions(value) {
      const found = getSuggestions(data, value);
      if (!found.length || !value.trim()) {
        suggestions.classList.remove("show");
        suggestions.innerHTML = "";
        return;
      }
      suggestions.innerHTML = found.map((t) => `
        <div class="suggest-item" data-id="${escapeHtml(t.id)}" data-title="${escapeHtml(t.title)}">
          <div style="font-weight:800">${escapeHtml(t.title)}</div>
          <div class="small">${escapeHtml(t.meta)}</div>
        </div>
      `).join("");
      suggestions.classList.add("show");
    }

    searchInput.addEventListener("input", () => renderSuggestions(searchInput.value));
    searchBtn.addEventListener("click", () => doSearch());

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });

    suggestions.addEventListener("click", (e) => {
      const item = e.target.closest(".suggest-item");
      if (!item) return;
      searchInput.value = item.dataset.title || "";
      suggestions.classList.remove("show");
      suggestions.innerHTML = "";
      doSearch(item.dataset.title || "");
    });

    document.addEventListener("click", (e) => {
      if (suggestions && !suggestions.contains(e.target) && e.target !== searchInput) {
        suggestions.classList.remove("show");
      }
    });
  });
})();

/* ===== Search page controller ===== */
(function initSearchPage() {
  document.addEventListener("DOMContentLoaded", async () => {
    if (!$("tbody") || !$("title")) return;

    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") || "").trim();
    const testParam = (params.get("test") || "").trim();
    const urlCity = (params.get("city") || "").trim();

    const titleEl = $("title");
    const subtitleEl = $("subtitle");
    const cityLabel = $("cityLabel");
    const updated = $("updated");
    const cityInline = $("cityInline");
    const kpis = $("kpis");
    const tbody = $("tbody");
    const bestPriceTitle = $("bestPriceTitle");
    const bestPriceValue = $("bestPriceValue");

    const cityPill = $("cityPill");
    const cityModal = $("cityModal");
    const citySelect = $("citySelect");
    const closeCityModal = $("closeCityModal");
    const cancelCityBtn = $("cancelCityBtn");
    const saveCityBtn = $("saveCityBtn");

    const shareBtn = $("shareBtn");
    const sharePopover = $("sharePopover");
    const shareCopy = $("shareCopy");
    const shareQR = $("shareQR");
    const qrModal = $("qrModal");
    const closeQrModal = $("closeQrModal");
    const qrImg = $("qrImg");
    const qrText = $("qrText");
    const qrCopy = $("qrCopy");

    function openCityModal() {
      if (cityModal) cityModal.classList.add("show");
    }
    function closeCityModalFn() {
      if (cityModal) cityModal.classList.remove("show");
    }

    if (cityPill) cityPill.addEventListener("click", openCityModal);
    if (closeCityModal) closeCityModal.addEventListener("click", closeCityModalFn);
    if (cancelCityBtn) cancelCityBtn.addEventListener("click", closeCityModalFn);
    if (cityModal) {
      cityModal.addEventListener("click", (e) => {
        if (e.target === cityModal) closeCityModalFn();
      });
    }

    function openPopover() {
      if (!sharePopover) return;
      sharePopover.style.display = sharePopover.style.display === "block" ? "none" : "block";
    }
    function closePopover() {
      if (!sharePopover) return;
      sharePopover.style.display = "none";
    }
    function openQr() {
      if (!qrModal) return;
      const url = window.location.href;
      qrModal.classList.add("show");
      if (qrText) qrText.textContent = url;
      if (qrImg) {
        const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(url);
        qrImg.onerror = () => { qrImg.style.display = "none"; };
        qrImg.onload = () => { qrImg.style.display = "inline-block"; };
        qrImg.src = qrUrl;
      }
    }
    function closeQr() {
      if (qrModal) qrModal.classList.remove("show");
    }

    if (shareBtn) {
      shareBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openPopover();
      });
      document.addEventListener("click", (e) => {
        if (sharePopover && !sharePopover.contains(e.target) && !shareBtn.contains(e.target)) {
          closePopover();
        }
      });
    }

    if (shareCopy) {
      shareCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(window.location.href);
        if (ok) showToast("✓ Ссылка на сравнение цен скопирована", "Отправьте её пациенту или родственникам");
        closePopover();
      });
    }

    if (shareQR) {
      shareQR.addEventListener("click", () => {
        openQr();
        closePopover();
      });
    }

    if (closeQrModal) closeQrModal.addEventListener("click", closeQr);
    if (qrModal) {
      qrModal.addEventListener("click", (e) => {
        if (e.target === qrModal) closeQr();
      });
    }
    if (qrCopy) {
      qrCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(window.location.href);
        if (ok) showToast("✓ Ссылка на сравнение цен скопирована", "Отправьте её пациенту или родственникам");
      });
    }

    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "toastClose") {
        const toast = $("toast");
        if (toast) toast.style.display = "none";
      }
    });

    let data = null;
    try {
      data = await loadData();
    } catch (e) {
      console.error(e);
      if (titleEl) titleEl.textContent = "Ошибка загрузки данных";
      if (subtitleEl) subtitleEl.textContent = "Проверьте, что data.json доступен на хостинге.";
      return;
    }

    if (urlCity) store.setCity(urlCity);
    let city = store.getCity();
    if (!city && data.cities?.length) {
      city = data.cities[0];
      store.setCity(city);
      params.set("city", city);
      history.replaceState(null, "", window.location.pathname + "?" + params.toString());
    }

    if (cityLabel) cityLabel.textContent = city || "—";
    if (updated) updated.textContent = data.updated_at ? ("Обновлено: " + data.updated_at) : "";

    if (cityInline && data.cities) {
      cityInline.innerHTML = data.cities
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join("");
      if (city) cityInline.value = city;
    }

    if (citySelect && data.cities) {
      citySelect.innerHTML = data.cities
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join("");
      if (city) citySelect.value = city;
    }

    const testId = testParam ? testParam : findTestId(data, q);
    const testObj = (data.tests || []).find((t) => t.id === testId);
    const testName = testObj ? testObj.name : (q || "Анализ");

    if (titleEl) titleEl.textContent = testName;
    if (subtitleEl) subtitleEl.textContent = city ? `Сравнение цен · ${city}` : "Сравнение цен";

    function applyCity(nextCity) {
      city = nextCity;
      store.setCity(city);
      params.set("city", city);
      history.replaceState(null, "", window.location.pathname + "?" + params.toString());
      if (cityLabel) cityLabel.textContent = city;
      if (cityInline) cityInline.value = city;
      if (citySelect) citySelect.value = city;
      render();
    }

    if (cityInline) {
      cityInline.addEventListener("change", () => {
        const selected = cityInline.value;
        if (!selected) return;
        applyCity(selected);
      });
    }

    if (saveCityBtn) {
      saveCityBtn.addEventListener("click", () => {
        const selected = citySelect?.value || "";
        if (!selected) return;
        applyCity(selected);
        closeCityModalFn();
      });
    }

    function render() {
      const rows = (city && testId) ? buildRows(data, city, testId) : [];
      const stats = computeStats(rows);

      if (kpis) {
        kpis.innerHTML = `
          <div class="kpi"><div class="label">Самая низкая цена</div><div class="value">${formatRUB(stats.min)}</div></div>
          <div class="kpi"><div class="label">Средняя цена</div><div class="value">${formatRUB(stats.avg)}</div></div>
          <div class="kpi"><div class="label">Разница</div><div class="value">${stats.min != null && stats.max != null ? formatRUB(stats.max - stats.min) : "—"}</div></div>
        `;
      }

      const first = [...rows].filter((x) => typeof x.price === "number").sort((a, b) => a.price - b.price)[0];
      if (bestPriceTitle) bestPriceTitle.textContent = first ? first.labName : "—";
      if (bestPriceValue) bestPriceValue.textContent = first ? formatRUB(first.price) : "—";

      if (tbody) {
        const minPrice = stats.min;
        tbody.innerHTML = rows.length ? rows.map((r) => {
          const addr = (r.locations && r.locations[0]) ? r.locations[0].address : "—";
          const isBest = minPrice != null && r.price === minPrice;
          const diff = (minPrice != null && typeof r.price === "number") ? (r.price - minPrice) : null;
          const diffText = diff === 0 ? "самая низкая" : (diff != null ? `+${diff} ₽` : "—");
          const diffClass = diff === 0 ? "diff-low" : "diff-up";
          const rowClass = isBest ? "best" : "";

          return `
            <tr class="${rowClass}">
              <td><div style="font-weight:900">${escapeHtml(r.labName)}</div></td>
              <td class="price">${formatRUB(r.price)} ${isBest ? '<span class="badge">самая низкая</span>' : ''}</td>
              <td class="${diffClass}">${diffText}</td>
              <td class="small">${escapeHtml(addr)}</td>
            </tr>
          `;
        }).join("") : `<tr><td colspan="4" class="small">Нет данных по этому анализу в выбранном городе.</td></tr>`;
      }

      drawChart(data, city, testId);
    }

    render();
  });
})();

/* ===== Simple chart ===== */
function drawChart(data, city, testId) {
  const canvas = $("chart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 860;
  const cssH = canvas.clientHeight || 240;

  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const hist = (((data.history || {})[city] || {})[testId]) || null;
  if (!hist) {
    ctx.fillStyle = "rgba(11,31,30,.55)";
    ctx.font = "14px Inter, system-ui, Arial";
    ctx.fillText("Нет данных для динамики.", 16, 40);
    return;
  }

  const monthNames = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  const monthSet = new Set();
  Object.values(hist).forEach((series) => (series || []).forEach((p) => monthSet.add(p.m)));
  const months = Array.from(monthSet).sort();
  if (!months.length) {
    ctx.fillStyle = "rgba(11,31,30,.55)";
    ctx.font = "14px Inter, system-ui, Arial";
    ctx.fillText("Нет данных для динамики.", 16, 40);
    return;
  }

  const labIds = Object.keys(hist);
  const seriesByLab = {};
  const allVals = [];

  for (const labId of labIds) {
    const map = new Map((hist[labId] || []).map((x) => [x.m, x.p]));
    const arr = months.map((m) => {
      const v = map.get(m);
      if (typeof v === "number") allVals.push(v);
      return typeof v === "number" ? v : null;
    });
    seriesByLab[labId] = arr;
  }

  if (!allVals.length) return;

  const padL = 56, padR = 16, padT = 16, padB = 48;
  const W = cssW - padL - padR;
  const H = cssH - padT - padB;

  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const range = Math.max(1, maxY - minY);
  const xStep = W / Math.max(1, months.length - 1);
  const y = (val) => padT + (maxY - val) * (H / range);

  ctx.strokeStyle = "rgba(11,31,30,.10)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const yy = padT + (H / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + W, yy);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(11,31,30,.55)";
  ctx.font = "12px Inter, system-ui, Arial";
  ctx.fillText(formatRUB(maxY), 10, padT + 10);
  ctx.fillText(formatRUB(minY), 10, padT + H);

  const palette = [
    "rgba(43,165,158,.92)",
    "rgba(235,74,74,.78)",
    "rgba(11,31,30,.68)",
    "rgba(43,165,158,.55)"
  ];

  function drawSmooth(points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  labIds.forEach((labId, idx) => {
    const arr = seriesByLab[labId] || [];
    const pts = [];
    arr.forEach((v, i) => {
      if (v == null) return;
      pts.push({ x: padL + i * xStep, y: y(v) });
    });

    ctx.strokeStyle = palette[idx % palette.length];
    ctx.lineWidth = 2;
    drawSmooth(pts);

    ctx.fillStyle = palette[idx % palette.length];
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  ctx.fillStyle = "rgba(11,31,30,.55)";
  ctx.font = "12px Inter, system-ui, Arial";
  months.forEach((m, i) => {
    const mm = parseInt(m.slice(5), 10);
    const label = monthNames[(mm - 1 + 12) % 12];
    const xx = padL + i * xStep;
    const w = ctx.measureText(label).width;
    let tx = xx - w / 2;
    tx = Math.max(padL - 4, Math.min(padL + W - w + 4, tx));
    if (i % 2 === 0 || i === months.length - 1) {
      ctx.fillText(label, tx, padT + H + 30);
    }
  });
}
document.addEventListener("DOMContentLoaded", function(){
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");

  document.querySelectorAll("[data-quick-search]").forEach(el => {
    el.addEventListener("click", function(){
      const value = this.getAttribute("data-quick-search") || "";
      if(input) input.value = value;
      if(btn) btn.click();
    });
  });
});
