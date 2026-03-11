
const store = {
  getCity(){ return localStorage.getItem("labradar_city") || ""; },
  setCity(city){
    if(!city){ localStorage.removeItem("labradar_city"); return; }
    localStorage.setItem("labradar_city", city);
  }
};

async function loadData(){
  // Robust loader for different hosting paths (root, subfolder, /analizy/ pages)
  const isAnalizy = window.location.pathname.includes("/analizy/");
  const candidates = isAnalizy
    ? ["../data.json", "data.json", "./data.json"]
    : ["data.json", "./data.json", "../data.json"];
  let lastErr = null;
  for(const url of candidates){
    try{
      const res = await fetch(url, {cache:"no-store"});
      if(res.ok) return await res.json();
      lastErr = new Error("HTTP " + res.status + " for " + url);
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error("Не удалось загрузить data.json");
}


function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatRUB(n){
  if(n === null || n === undefined) return "—";
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

function normalize(s){
  return (s||"").toLowerCase().replace(/ё/g,"е").trim();
}

function findTestId(data, query){
  const q = normalize(query);
  if(!q) return null;
  // direct contains name
  for(const t of data.tests){
    if(normalize(t.name).includes(q)) return t.id;
  }
  // synonyms
  for(const t of data.tests){
    if((t.syn||[]).some(x => normalize(x).includes(q) || q.includes(normalize(x)))) return t.id;
  }
  // partial token match
  const tokens = q.split(/\s+/).filter(Boolean);
  let best = null, bestScore = 0;
  for(const t of data.tests){
    const hay = normalize(t.name + " " + (t.syn||[]).join(" "));
    let score = 0;
    for(const tok of tokens){ if(hay.includes(tok)) score++; }
    if(score > bestScore){ bestScore = score; best = t.id; }
  }
  return bestScore ? best : null;
}

function getSuggestions(data, q){
  const v = normalize(q);
  if(v.length < 2) return [];
  const out = [];
  for(const t of data.tests){
    const hay = normalize(t.name + " " + (t.syn||[]).join(" "));
    if(hay.includes(v)) out.push({id:t.id, title:t.name, meta:(t.syn && t.syn[0]) ? t.syn[0] : "анализ"});
  }
  return out.slice(0, 8);
}

function computeStats(rows){
  const prices = rows.map(r=>r.price).filter(p=>typeof p==="number");
  if(!prices.length) return {min:null, max:null, avg:null};
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
  return {min, max, avg};
}

function buildRows(data, city, testId){
  const priceMap = (((data.prices||{})[city]||{})[testId]) || {};
  const labsById = Object.fromEntries(data.labs.map(l=>[l.id,l]));
  const rows = Object.entries(priceMap).map(([labId, price]) => ({
    labId,
    labName: labsById[labId]?.name || labId,
    price: typeof price === "number" ? price : null,
    site: labsById[labId]?.site || "#",
    locations: (labsById[labId]?.locations || []).filter(x => x.city === city)
  }));
  return rows;
}


// ---- Cart (selected analyses) ----
const cart = {
  key: "labradar_cart",
  get(){
    try{ return JSON.parse(localStorage.getItem(this.key) || "[]"); }catch(e){ return []; }
  },
  set(arr){
    localStorage.setItem(this.key, JSON.stringify(Array.from(new Set(arr))));
    window.dispatchEvent(new CustomEvent("labradar:cart"));
  },
  add(testId){
    const cur = this.get();
    if(!cur.includes(testId)) cur.push(testId);
    this.set(cur);
  },
  remove(testId){
    const cur = this.get().filter(x=>x!==testId);
    this.set(cur);
  },
  clear(){ this.set([]); },
  has(testId){ return this.get().includes(testId); },
  count(){ return this.get().length; }
};
window.LabRadar = { store, loadData, escapeHtml, formatRUB, normalize, findTestId, getSuggestions, computeStats, buildRows, cart };



// ---- Search page controller (embedded) ----
(function(){
  function $(id){ return document.getElementById(id); }

  function showToast(title, text){
    const toast = $("toast");
    if(!toast) return;
    const tt = $("toastTitle"), tx = $("toastText");
    if(tt) tt.textContent = title || "Готово";
    if(tx) tx.textContent = text || "";
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>{ toast.style.display="none"; }, 3500);
  }

  async function copyToClipboard(text){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(e){
      try{
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      }catch(e2){
        return false;
      }
    }
  }

  function initShare(){
    const shareBtn = $("shareBtn");
    const sharePopover = $("sharePopover");
    const shareCopy = $("shareCopy");
    const shareQR = $("shareQR");

    const qrModal = $("qrModal");
    const closeQrModal = $("closeQrModal");
    const qrImg = $("qrImg");
    const qrText = $("qrText");
    const qrCopy = $("qrCopy");

    function openPopover(){
      if(!sharePopover) return;
      sharePopover.style.display = (sharePopover.style.display === "block") ? "none" : "block";
    }
    function closePopover(){
      if(!sharePopover) return;
      sharePopover.style.display = "none";
    }

    if(shareBtn){
      shareBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        openPopover();
      });
      document.addEventListener("click", (e)=>{
        if(sharePopover && !sharePopover.contains(e.target) && !shareBtn.contains(e.target)){
          closePopover();
        }
      });
    }

    function openQr(){
      if(!qrModal) return;
      const url = window.location.href;
      qrModal.classList.add("show");
      if(qrText) qrText.textContent = url;
      if(qrImg){
        const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(url);
        qrImg.onerror = ()=>{ qrImg.style.display="none"; };
        qrImg.onload = ()=>{ qrImg.style.display="inline-block"; };
        qrImg.src = qrUrl;
      }
    }
    function closeQr(){ if(qrModal) qrModal.classList.remove("show"); }

    if(shareCopy){
      shareCopy.addEventListener("click", async ()=>{
        const ok = await copyToClipboard(window.location.href);
        if(ok){
          showToast("✓ Ссылка на сравнение цен скопирована", "Отправьте её пациенту или родственникам");
        }
        closePopover();
      });
    }
    if(shareQR){
      shareQR.addEventListener("click", ()=>{ openQr(); closePopover(); });
    }

    if(closeQrModal) closeQrModal.addEventListener("click", closeQr);
    if(qrModal) qrModal.addEventListener("click", (e)=>{ if(e.target===qrModal) closeQr(); });
    if(qrCopy){
      qrCopy.addEventListener("click", async ()=>{
        const ok = await copyToClipboard(window.location.href);
        if(ok){
          showToast("✓ Ссылка на сравнение цен скопирована", "Отправьте её пациенту или родственникам");
        }
      });
    }

    document.addEventListener("click", (e)=>{
      if(e.target && e.target.id === "toastClose"){
        const toast = $("toast");
        if(toast) toast.style.display="none";
      }
    });
  }

  async function runSearchPage(){
    initShare();

    if(typeof window.LabRadar === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") || "").trim();
    const testParam = (params.get("test") || "").trim();
    const urlCity = (params.get("city") || "").trim();

    let data;
    try{
      data = await window.LabRadar.loadData();
    }catch(e){
      console.error(e);
      const t = $("title"); const s = $("subtitle");
      if(t) t.textContent = "Ошибка загрузки данных";
      if(s) s.textContent = "Проверьте, что data.json доступен на хостинге.";
      return;
    }

    if(urlCity) window.LabRadar.store.setCity(urlCity);
    let city = window.LabRadar.store.getCity();
    if(!city && data.cities && data.cities.length){
      city = data.cities[0];
      window.LabRadar.store.setCity(city);
      params.set("city", city);
      history.replaceState(null, "", window.location.pathname + "?" + params.toString());
    }

    const cityLabel = $("cityLabel");
    if(cityLabel) cityLabel.textContent = city || "—";

    const updated = $("updated");
    if(updated) updated.textContent = data.updated_at ? ("Обновлено: " + data.updated_at) : "";

    const cityInline = $("cityInline");
    if(cityInline && data.cities){
      cityInline.innerHTML = data.cities.map(c => `<option value="${window.LabRadar.escapeHtml(c)}">${window.LabRadar.escapeHtml(c)}</option>`).join("");
      if(city) cityInline.value = city;
      cityInline.addEventListener("change", ()=>{
        const selected = cityInline.value;
        if(!selected) return;
        window.LabRadar.store.setCity(selected);
        params.set("city", selected);
        history.replaceState(null, "", window.location.pathname + "?" + params.toString());
        window.location.reload();
      });
    }

    const sort = $("sort");
    const testId = testParam ? testParam : window.LabRadar.findTestId(data, q);
    const testObj = (data.tests||[]).find(t => t.id === testId);
    const testName = testObj ? testObj.name : (q || "Анализ");

    const title = $("title");
    const subtitle = $("subtitle");
    if(title) title.textContent = testName;
    if(subtitle) subtitle.textContent = city ? (`Сравнение цен · ${city}`) : "Сравнение цен";

    const rows = (city && testId) ? window.LabRadar.buildRows(data, city, testId) : [];
    let current = rows;

    function render(list){
      const stats = window.LabRadar.computeStats(list);
      const kpis = $("kpis");
      if(kpis){
        kpis.innerHTML = `
          <div class="kpi"><div class="label">Самая низкая цена</div><div class="value">${window.LabRadar.formatRUB(stats.min)}</div></div>
          <div class="kpi"><div class="label">Средняя цена</div><div class="value">${window.LabRadar.formatRUB(stats.avg)}</div></div>
          <div class="kpi"><div class="label">Разница</div><div class="value">${stats.min!=null && stats.max!=null ? window.LabRadar.formatRUB(stats.max - stats.min) : "—"}</div></div>
        `;
      }

      const bpTitle = $("bestPriceTitle");
      const bpValue = $("bestPriceValue");
      const first = [...list].filter(x=>typeof x.price==="number").sort((a,b)=>a.price-b.price)[0];
      if(bpTitle) bpTitle.textContent = first ? first.labName : "—";
      if(bpValue) bpValue.textContent = first ? window.LabRadar.formatRUB(first.price) : "—";

      const tbody = $("tbody");
      if(tbody){
        const minPrice = stats.min;
        tbody.innerHTML = list.length ? list.map(r => {
          const addr = (r.locations && r.locations[0]) ? r.locations[0].address : "—";
          const isMin = (minPrice != null && r.price === minPrice);
          return `
            <tr>
              <td><div style="font-weight:900">${window.LabRadar.escapeHtml(r.labName)}</div></td>
              <td class="price">${window.LabRadar.formatRUB(r.price)} ${isMin ? '<span class="badge">самая низкая</span>' : ''}</td>
              <td class="small">${window.LabRadar.escapeHtml(addr)}</td>
            </tr>
          `;
        }).join("") : `<tr><td colspan="3" class="small">Нет данных по этому анализу в выбранном городе.</td></tr>`;
      }

      // Chart: динамика цен по месяцам (если есть данные)
      try{
        const canvas = $("chart");
        if(canvas){
          const ctx = canvas.getContext("2d");

          const monthNames = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
          const rub = (n)=> (typeof n==="number" ? (Math.round(n)).toLocaleString("ru-RU") + " ₽" : "—");

          // Ensure crisp rendering on HiDPI
          const dpr = window.devicePixelRatio || 1;
          const cssW = canvas.clientWidth || 860;
          const cssH = canvas.clientHeight || 240;
          if(canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)){
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
          }
          ctx.setTransform(dpr,0,0,dpr,0,0);

          const hist = (((data.history||{})[city]||{})[testId]) || null;

          // Collect months union
          let months = [];
          if(hist){
            const monthSet = new Set();
            Object.values(hist).forEach(series=> (series||[]).forEach(p=> monthSet.add(p.m)));
            months = Array.from(monthSet).sort(); // YYYY-MM
          }

          // Build series per labId
          const labIds = hist ? Object.keys(hist) : [];
          const seriesByLab = {};
          let allVals = [];
          if(hist && months.length){
            for(const labId of labIds){
              const s = hist[labId] || [];
              const map = new Map(s.map(x=>[x.m, x.p]));
              const arr = months.map(m=>{
                const v = map.get(m);
                if(typeof v === "number") allVals.push(v);
                return (typeof v === "number") ? v : null;
              });
              seriesByLab[labId] = arr;
            }
          }

          // Hover state
          const state = canvas._lrState || (canvas._lrState = {hoverIndex:null, rect:null});
          state.months = months;
          state.labIds = labIds;
          state.seriesByLab = seriesByLab;

          // Colors (minimal but distinct)
          const palette = [
            "rgba(43,165,158,.92)",
            "rgba(235,74,74,.78)",
            "rgba(11,31,30,.68)",
            "rgba(43,165,158,.55)"
          ];
          const labsById = Object.fromEntries((data.labs||[]).map(l=>[l.id,l.name]));

          function draw(){
            ctx.clearRect(0,0,cssW,cssH);

            if(!hist || !months.length || !allVals.length){
              ctx.fillStyle = "rgba(11,31,30,.55)";
              ctx.font = "14px Inter, system-ui, Arial";
              ctx.fillText("Нет данных для динамики.", 16, 40);
              return;
            }

            const padL=56, padR=16, padT=16, padB=48;
            const W = cssW - padL - padR;
            const H = cssH - padT - padB;

            const minY = Math.min(...allVals);
            const maxY = Math.max(...allVals);
            const range = Math.max(1, maxY - minY);
            const xStep = W / Math.max(1, months.length - 1);
            const y = (val)=> padT + (maxY - val) * (H / range);

            // Grid
            ctx.strokeStyle = "rgba(11,31,30,.10)";
            ctx.lineWidth = 1;
            for(let i=0;i<=2;i++){
              const yy = padT + (H/2)*i;
              ctx.beginPath();
              ctx.moveTo(padL, yy);
              ctx.lineTo(padL+W, yy);
              ctx.stroke();
            }

            // Y labels (₽)
            ctx.fillStyle = "rgba(11,31,30,.55)";
            ctx.font = "12px Inter, system-ui, Arial";
            ctx.fillText(rub(maxY), 10, padT+10);
            ctx.fillText(rub(minY), 10, padT+H);

            // helper: smooth curve through points
            function drawSmooth(points){
              if(points.length < 2) return;
              ctx.beginPath();
              ctx.moveTo(points[0].x, points[0].y);
              for(let i=0;i<points.length-1;i++){
                const p0 = points[i-1] || points[i];
                const p1 = points[i];
                const p2 = points[i+1];
                const p3 = points[i+2] || p2;
                // Catmull-Rom to Bezier
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
              }
              ctx.stroke();
            }

            // Draw each lab
            labIds.forEach((labId, idx)=>{
              const arr = seriesByLab[labId] || [];
              const pts = [];
              arr.forEach((v,i)=>{
                if(v==null) return;
                pts.push({x: padL + i*xStep, y: y(v), v, i});
              });
              ctx.strokeStyle = palette[idx % palette.length];
              ctx.lineWidth = 2;
              drawSmooth(pts);

              // Dots
              ctx.fillStyle = palette[idx % palette.length];
              pts.forEach(p=>{
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2.6, 0, Math.PI*2);
                ctx.fill();
              });
            });

            // X labels: full month names (every 2 months + last)
            ctx.fillStyle = "rgba(11,31,30,.55)";
            ctx.font = "12px Inter, system-ui, Arial";
            const labelEvery = months.length > 8 ? 2 : 1;
            months.forEach((m,i)=>{
              const show = (i % labelEvery === 0) || (i === months.length-1);
              if(!show) return;
              const mm = parseInt(m.slice(5),10);
              const label = monthNames[(mm-1+12)%12];
              const xx = padL + i*xStep;
              // keep inside
              const w = ctx.measureText(label).width;
              let tx = xx - w/2;
              tx = Math.max(padL-4, Math.min(padL+W-w+4, tx));
              ctx.fillText(label, tx, padT+H+30);
            });

            // Legend (compact, top-right)
            const lx = padL + W - 190;
            const ly = padT + 2;
            labIds.slice(0,4).forEach((labId, idx)=>{
              const name = labsById[labId] || labId;
              ctx.fillStyle = palette[idx % palette.length];
              ctx.fillRect(lx, ly + idx*16 + 6, 10, 3);
              ctx.fillStyle = "rgba(11,31,30,.72)";
              ctx.fillText(name, lx+14, ly + idx*16 + 10);
            });

            // Hover tooltip
            if(state.hoverIndex != null){
              const i = state.hoverIndex;
              const x = padL + i*xStep;
              // vertical guide
              ctx.strokeStyle = "rgba(11,31,30,.12)";
              ctx.beginPath();
              ctx.moveTo(x, padT);
              ctx.lineTo(x, padT+H);
              ctx.stroke();

              // build tooltip lines for labs that have value
              const lines = [];
              labIds.forEach((labId, idx)=>{
                const v = (seriesByLab[labId]||[])[i];
                if(typeof v === "number"){
                  lines.push({label:(labsById[labId]||labId), value: rub(v), color: palette[idx % palette.length], v});
                }
              });
              const month = months[i];
              const mm = parseInt(month.slice(5),10);
              const head = monthNames[(mm-1+12)%12];

              ctx.font = "12px Inter, system-ui, Arial";
              const pad = 10;
              const lineH = 16;
              const w1 = ctx.measureText(head).width;
              const w2 = Math.max(0, ...lines.map(l=> ctx.measureText(l.label + " " + l.value).width));
              const boxW = Math.max(w1, w2) + pad*2 + 14;
              const boxH = pad*2 + lineH*(1 + lines.length);
              let bx = x + 12;
              if(bx + boxW > padL + W) bx = x - 12 - boxW;
              let by = padT + 12;
              // background
              ctx.fillStyle = "rgba(255,255,255,.92)";
              ctx.strokeStyle = "rgba(11,31,30,.12)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              const r = 12;
              const x0=bx, y0=by, x1=bx+boxW, y1=by+boxH;
              ctx.moveTo(x0+r,y0);
              ctx.arcTo(x1,y0,x1,y0+r,r);
              ctx.arcTo(x1,y1,x1-r,y1,r);
              ctx.arcTo(x0,y1,x0,y1-r,r);
              ctx.arcTo(x0,y0,x0+r,y0,r);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              // text
              ctx.fillStyle = "rgba(11,31,30,.80)";
              ctx.fillText(head, bx+pad, by+pad+12);
              lines.forEach((l, idx)=>{
                const yy = by+pad+12 + lineH*(idx+1);
                ctx.fillStyle = l.color;
                ctx.fillRect(bx+pad, yy-9, 8, 3);
                ctx.fillStyle = "rgba(11,31,30,.78)";
                ctx.fillText(l.label + " " + l.value, bx+pad+12, yy);
              });
            }
          }

          // Mouse move -> update hover index
          if(!canvas._lrBound){
            canvas._lrBound = true;
            const handler = (ev)=>{
              const rect = canvas.getBoundingClientRect();
              state.rect = rect;
              const x = ev.clientX - rect.left;
              // Match draw() pads
              const padL=56, padR=16;
              const W = rect.width - padL - padR;
              if(!months || months.length < 2){ state.hoverIndex=null; draw(); return; }
              const xStep = W / Math.max(1, months.length - 1);
              const i = Math.round((x - padL) / xStep);
              if(i >= 0 && i < months.length) state.hoverIndex = i;
              else state.hoverIndex = null;
              draw();
            };
            canvas.addEventListener("mousemove", handler);
            canvas.addEventListener("mouseleave", ()=>{ state.hoverIndex=null; draw(); });
            // Touch support
            canvas.addEventListener("touchstart", (e)=>{ if(e.touches && e.touches[0]) handler(e.touches[0]); }, {passive:true});
            canvas.addEventListener("touchmove", (e)=>{ if(e.touches && e.touches[0]) handler(e.touches[0]); }, {passive:true});
            canvas.addEventListener("touchend", ()=>{ state.hoverIndex=null; draw(); });
          }

          draw();
        }
      }catch(e){
        // ignore chart errors
      }

    }

    function applySort(){
      const v = sort ? sort.value : "price_asc";
      const copy = [...current];
      if(v === "price_asc") copy.sort((a,b)=>(a.price??1e18)-(b.price??1e18));
      if(v === "price_desc") copy.sort((a,b)=>(b.price??-1)-(a.price??-1));
      if(v === "name_asc") copy.sort((a,b)=>a.labName.localeCompare(b.labName,"ru"));
      render(copy);
    }

    if(sort) sort.addEventListener("change", applySort);
    applySort();
  }

  window.LabRadarSearchInit = runSearchPage;
  document.addEventListener("DOMContentLoaded", ()=>{
    // run only on search page (presence of known elements)
    if($("bestPriceTitle") && $("bestPriceValue") && $("tbody") && $("shareBtn")) runSearchPage();
  });
})();
