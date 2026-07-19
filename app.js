/* ============================================================
 * app.js — 상태 관리 + 화면 렌더링 + 촬영/확인 플로우
 * ============================================================ */

const STORE_KEY = "ledger-data-v1";
const CATEGORIES = ["식료품", "외식", "건강·약국", "생활용품", "교통", "쇼핑", "기타"];
const CAT_COLORS = ["#C96F4F", "#B39E7A", "#5E7D54", "#7A8CA3", "#8A6FA3", "#C9A24F", "#8C8878"];
const CAT_GUESS = [
  { re: /(WALMART|COSTCO|SUPERSTORE|NO ?FRILLS|FRESHCO|ZEHRS|SOBEYS|METRO|FOOD ?BASICS|LOBLAW|T&T|GROCER)/i, cat: "식료품" },
  { re: /(SHOPPERS|PHARMA|REXALL|DRUG)/i, cat: "건강·약국" },
  { re: /(TIM ?HORTONS|MCDONALD|STARBUCKS|SUBWAY|PIZZA|RESTAURANT|CAFE|COFFEE|WENDY|A&W|KFC|BURGER)/i, cat: "외식" },
  { re: /(PETRO|SHELL|ESSO|GAS|CANADIAN ?TIRE|UBER|LYFT|GO ?TRANSIT|PRESTO)/i, cat: "교통" },
  { re: /(DOLLARAMA|CANADIAN ?TIRE|HOME ?DEPOT|IKEA|STAPLES)/i, cat: "생활용품" },
  { re: /(AMAZON|BEST ?BUY|WINNERS|MARSHALL|H&M|UNIQLO|SPORT ?CHEK)/i, cat: "쇼핑" },
];

let db = load();
let statsMonth = monthKey(new Date());
let calMonth = monthKey(new Date());
let calSelDay = null;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.entries)) return d;
  } catch (e) {}
  return { entries: [], fixed: [], income: [] };
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }

const $ = (s) => document.querySelector(s);
const fmt = (n) => (n < 0 ? "-$ " : "$ ") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function monthKey(d) {
  if (typeof d === "string") return d.slice(0, 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDateKR(iso) {
  const [y, m, d] = iso.split("-");
  return `${+d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}
function guessCategory(store) {
  for (const g of CAT_GUESS) if (g.re.test(store)) return g.cat;
  return "기타";
}

/* ================= 네비게이션 ================= */
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    $("#page-" + btn.dataset.page).classList.add("active");
    renderAll();
  });
});

/* ================= 렌더: 랜딩 ================= */
function renderLedger() {
  const today = todayISO();
  const todaySum = db.entries.filter((e) => e.date === today).reduce((s, e) => s + e.total, 0);
  $("#today-total").textContent = fmt(todaySum);

  // 수지 카드
  const mk = monthKey(new Date());
  const spent = db.entries.filter((e) => e.date.startsWith(mk)).reduce((s, e) => s + e.total, 0);
  const income = db.income.reduce((s, i) => s + (+i.amount || 0), 0);
  const fixed = db.fixed.reduce((s, i) => s + (+i.amount || 0), 0);
  const bal = income - fixed - spent;
  $("#balance-amount").textContent = fmt(bal);
  const tag = $("#balance-tag");
  if (income === 0 && fixed === 0) {
    tag.textContent = "설정 필요"; tag.className = "balance-tag";
    $("#balance-detail").textContent = "통계 탭에서 왼쪽으로 밀어 수입과 고정 지출을 입력하면 수지가 계산돼요.";
  } else {
    tag.textContent = bal >= 0 ? "흑자" : "적자";
    tag.className = "balance-tag " + (bal >= 0 ? "good" : "bad");
    $("#balance-detail").textContent =
      `수입 ${fmt(income)} − 고정 지출 ${fmt(fixed)} − 이번 달 소비 ${fmt(spent)}`;
  }

  // 날짜별 그룹
  const byDate = {};
  for (const e of db.entries) (byDate[e.date] ||= []).push(e);
  const dates = Object.keys(byDate).sort().reverse();
  const wrap = $("#ledger-list");
  wrap.innerHTML = "";
  $("#ledger-empty").hidden = dates.length > 0;
  for (const d of dates) {
    const card = document.createElement("section");
    card.className = "card day-card";
    card.innerHTML = `<p class="day-date">${fmtDateKR(d)}</p>`;
    byDate[d].forEach((e, i) => {
      const row = document.createElement("button");
      row.className = "entry-row";
      row.innerHTML = `
        <span class="entry-num">${i + 1}</span>
        <span class="entry-store">${esc(e.store || "(상호명 없음)")}
          <small>${e.category}${e.isRefund ? " · 반품" : ""}${e.time ? " · " + e.time : ""}</small>
        </span>
        <span class="entry-amt ${e.total < 0 ? "refund" : ""}">${fmt(e.total)}</span>`;
      row.addEventListener("click", () => openConfirm(e, true));
      card.appendChild(row);
    });
    wrap.appendChild(card);
  }
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

/* ================= 렌더: 통계 ================= */
function shiftMonth(mk, delta) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(mk) {
  const [y, m] = mk.split("-");
  return `${y}년 ${+m}월`;
}

function renderStats() {
  $("#stats-month-label").textContent = monthLabel(statsMonth) + " 통계";
  const entries = db.entries.filter((e) => e.date.startsWith(statsMonth));
  const total = entries.reduce((s, e) => s + e.total, 0);
  $("#donut-total").textContent = fmt(total);

  const byCat = {};
  for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + e.total;
  const cats = Object.entries(byCat)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const catTotal = cats.reduce((s, [, v]) => s + v, 0);

  // 도넛 (SVG stroke-dasharray)
  const svg = $("#donut");
  const R = 74, C = 2 * Math.PI * R;
  let off = 0;
  let segs = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="30"/>`;
  for (const [cat, v] of cats) {
    const frac = catTotal ? v / catTotal : 0;
    const color = CAT_COLORS[CATEGORIES.indexOf(cat)] || CAT_COLORS[6];
    segs += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${color}" stroke-width="30"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}"
      stroke-dashoffset="${(-off * C).toFixed(2)}" transform="rotate(-90 100 100)"/>`;
    off += frac;
  }
  svg.innerHTML = segs;

  // 카테고리 표
  const table = $("#cat-table");
  table.innerHTML = cats.length
    ? cats.map(([cat, v]) => {
        const color = CAT_COLORS[CATEGORIES.indexOf(cat)] || CAT_COLORS[6];
        const pct = catTotal ? ((v / catTotal) * 100).toFixed(1) : "0.0";
        return `<tr><td><span class="cat-dot" style="background:${color}"></span></td>
          <td>${esc(cat)}</td><td>${fmt(v)}</td><td>${pct}%</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" style="color:var(--ink-dim);padding:14px 2px">이 달에는 기록이 없어요.</td></tr>`;

  // 상세 내역
  const bd = $("#stats-breakdown");
  bd.innerHTML = "";
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((e, i) => {
    const row = document.createElement("button");
    row.className = "entry-row";
    row.innerHTML = `<span class="entry-num">${i + 1}</span>
      <span class="entry-store">${esc(e.store || "(상호명 없음)")}<small>${fmtDateKR(e.date)} · ${e.category}</small></span>
      <span class="entry-amt ${e.total < 0 ? "refund" : ""}">${fmt(e.total)}</span>`;
    row.addEventListener("click", () => openConfirm(e, true));
    bd.appendChild(row);
  });
  if (!sorted.length) bd.innerHTML = `<p class="settings-note">기록이 없어요.</p>`;

  renderFx();
}
$("#stats-prev").addEventListener("click", () => { statsMonth = shiftMonth(statsMonth, -1); renderStats(); });
$("#stats-next").addEventListener("click", () => { statsMonth = shiftMonth(statsMonth, 1); renderStats(); });

/* ================= 고정 지출 / 수입 ================= */
function renderFx() {
  const mkRows = (list, kind) => {
    const wrap = $(kind === "income" ? "#income-list" : "#fixed-list");
    wrap.innerHTML = "";
    if (!list.length) {
      wrap.innerHTML = `<p class="settings-note">항목이 없어요. + 추가를 눌러 등록하세요.</p>`;
      return;
    }
    list.forEach((it) => {
      const row = document.createElement("div");
      row.className = "fx-row";
      row.innerHTML = `<input type="text" value="${esc(it.name)}" placeholder="이름">
        <input type="number" inputmode="decimal" step="0.01" value="${it.amount}" placeholder="금액">
        <button class="del-btn" aria-label="삭제">✕</button>`;
      const [nameI, amtI, del] = row.children;
      nameI.addEventListener("change", () => { it.name = nameI.value; save(); renderLedger(); });
      amtI.addEventListener("change", () => { it.amount = +amtI.value || 0; save(); renderFxSummary(); renderLedger(); });
      del.addEventListener("click", () => {
        const arr = kind === "income" ? db.income : db.fixed;
        arr.splice(arr.indexOf(it), 1);
        save(); renderFx(); renderLedger();
      });
      wrap.appendChild(row);
    });
  };
  mkRows(db.income, "income");
  mkRows(db.fixed, "fixed");
  renderFxSummary();
}
function renderFxSummary() {
  const mk = monthKey(new Date());
  const spent = db.entries.filter((e) => e.date.startsWith(mk)).reduce((s, e) => s + e.total, 0);
  const income = db.income.reduce((s, i) => s + (+i.amount || 0), 0);
  const fixed = db.fixed.reduce((s, i) => s + (+i.amount || 0), 0);
  const bal = income - fixed - spent;
  $("#fx-summary").innerHTML = `
    <div class="sum-row"><span>월 수입</span><strong>${fmt(income)}</strong></div>
    <div class="sum-row"><span>고정 지출</span><strong>${fmt(fixed)}</strong></div>
    <div class="sum-row"><span>이번 달 소비</span><strong>${fmt(spent)}</strong></div>
    <div class="sum-row"><span>${bal >= 0 ? "흑자" : "적자"}</span>
      <strong style="color:${bal >= 0 ? "var(--good)" : "var(--bad)"}">${fmt(bal)}</strong></div>`;
}
document.querySelectorAll(".add-btn[data-add]").forEach((b) =>
  b.addEventListener("click", () => {
    (b.dataset.add === "income" ? db.income : db.fixed).push({ id: crypto.randomUUID(), name: "", amount: 0 });
    save(); renderFx();
  })
);

/* ================= 스와이프 페이저 ================= */
(() => {
  const track = $("#pager-track");
  let page = 0, startX = 0, startY = 0, dx = 0, dragging = false, locked = null;
  const apply = () => { track.style.transform = `translateX(${-page * 50}%)`; syncDots(); };
  const syncDots = () => {
    $("#dot0").classList.toggle("on", page === 0);
    $("#dot1").classList.toggle("on", page === 1);
  };
  track.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dragging = true; locked = null;
    track.classList.add("dragging");
  }, { passive: true });
  track.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;
    if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8))
      locked = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    if (locked !== "x") return;
    dx = mx;
    const pct = -page * 50 + (dx / track.parentElement.clientWidth) * 50;
    track.style.transform = `translateX(${Math.max(-50, Math.min(0, pct))}%)`;
  }, { passive: true });
  track.addEventListener("touchend", () => {
    dragging = false;
    track.classList.remove("dragging");
    if (locked === "x" && Math.abs(dx) > 60) page = dx < 0 ? 1 : 0;
    apply();
  });
  apply();
})();

/* ================= 달력 ================= */
function renderCalendar() {
  $("#cal-month-label").textContent = monthLabel(calMonth);
  const [y, m] = calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const grid = $("#cal-grid");
  grid.innerHTML = "";
  for (let i = 0; i < first.getDay(); i++) grid.appendChild(document.createElement("span"));
  const today = todayISO();
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const sum = db.entries.filter((e) => e.date === iso).reduce((s, e) => s + e.total, 0);
    const cell = document.createElement("button");
    cell.className = "cal-cell" + (iso === today ? " today" : "") + (iso === calSelDay ? " sel" : "");
    cell.innerHTML = `<span class="d">${d}</span>` +
      (sum !== 0 ? `<span class="amt ${sum < 0 ? "pos" : ""}">${sum < 0 ? "+" : ""}${Math.abs(sum).toFixed(0)}</span>` : "");
    cell.addEventListener("click", () => { calSelDay = iso; renderCalendar(); });
    grid.appendChild(cell);
  }
  const dayCard = $("#cal-day-card");
  if (calSelDay && calSelDay.startsWith(calMonth)) {
    const list = db.entries.filter((e) => e.date === calSelDay);
    dayCard.hidden = false;
    $("#cal-day-label").textContent = fmtDateKR(calSelDay);
    const wrap = $("#cal-day-list");
    wrap.innerHTML = list.length ? "" : `<p class="settings-note">이 날의 기록이 없어요.</p>`;
    list.forEach((e, i) => {
      const row = document.createElement("button");
      row.className = "entry-row";
      row.innerHTML = `<span class="entry-num">${i + 1}</span>
        <span class="entry-store">${esc(e.store || "(상호명 없음)")}<small>${e.category}</small></span>
        <span class="entry-amt ${e.total < 0 ? "refund" : ""}">${fmt(e.total)}</span>`;
      row.addEventListener("click", () => openConfirm(e, true));
      wrap.appendChild(row);
    });
  } else dayCard.hidden = true;
}
$("#cal-prev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); calSelDay = null; renderCalendar(); });
$("#cal-next").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); calSelDay = null; renderCalendar(); });

/* ================= 촬영 세션 ================= */
let session = { photos: [] };

$("#btn-capture").addEventListener("click", () => { openCaptureSheet(); $("#file-camera").click(); });
$("#btn-gallery").addEventListener("click", () => { openCaptureSheet(); $("#file-gallery").click(); });
$("#btn-add-photo").addEventListener("click", () => $("#file-gallery").click());
$("#btn-cancel-capture").addEventListener("click", closeCaptureSheet);

function openCaptureSheet() {
  session = { photos: [] };
  renderThumbs();
  $("#ocr-progress").hidden = true;
  $("#capture-sheet").hidden = false;
}
function closeCaptureSheet() { $("#capture-sheet").hidden = true; }

$("#file-camera").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
$("#file-gallery").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });

function addPhotos(files) {
  for (const f of files) session.photos.push(f);
  renderThumbs();
}
function renderThumbs() {
  const wrap = $("#capture-thumbs");
  wrap.innerHTML = "";
  session.photos.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    const rm = document.createElement("button");
    rm.className = "rm"; rm.textContent = "✕";
    rm.addEventListener("click", () => { session.photos.splice(i, 1); renderThumbs(); });
    div.append(img, rm);
    wrap.appendChild(div);
  });
  $("#btn-run-ocr").disabled = !session.photos.length;
}

$("#btn-run-ocr").addEventListener("click", async () => {
  const n = session.photos.length;
  if (!n) return;
  $("#ocr-progress").hidden = false;
  $("#btn-run-ocr").disabled = true;
  const parts = [];
  try {
    for (let i = 0; i < n; i++) {
      $("#ocr-msg").textContent = `인식 중… (${i + 1}/${n})`;
      const res = await OCR.recognizeText(session.photos[i], (p) => {
        $("#ocr-fill").style.width = ((i + p) / n) * 100 + "%";
      });
      parts.push(PARSER.parseReceipt(res));
    }
    const merged = PARSER.mergeParts(parts);
    closeCaptureSheet();
    openConfirm({
      id: crypto.randomUUID(),
      store: merged.store,
      date: merged.date || todayISO(),
      time: merged.time || "",
      category: guessCategory(merged.store),
      isRefund: merged.isRefund,
      items: merged.items,
      total: merged.total,
    }, false);
  } catch (err) {
    $("#ocr-msg").textContent = "인식에 실패했어요. 밝은 곳에서 다시 찍어보세요. (" + err.message + ")";
    $("#btn-run-ocr").disabled = false;
  }
});

/* ================= 확인 / 수정 시트 ================= */
let editing = null; // {entry, isExisting}

function openConfirm(entry, isExisting) {
  editing = { entry: JSON.parse(JSON.stringify(entry)), isExisting };
  $("#f-store").value = entry.store || "";
  $("#f-date").value = entry.date || todayISO();
  $("#f-time").value = entry.time || "";
  $("#f-refund").checked = !!entry.isRefund;
  const sel = $("#f-category");
  sel.innerHTML = CATEGORIES.map((c) => `<option ${c === entry.category ? "selected" : ""}>${c}</option>`).join("");
  renderItemRows();
  $("#btn-discard").textContent = isExisting ? "삭제" : "버리기";
  $("#confirm-sheet").hidden = false;
}
function renderItemRows() {
  const wrap = $("#f-items");
  wrap.innerHTML = "";
  editing.entry.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<input type="text" value="${esc(it.name)}" placeholder="품목명">
      <input type="number" class="price" inputmode="decimal" step="0.01" value="${it.price}">
      <button class="del-btn" aria-label="삭제">✕</button>`;
    const [nameI, priceI, del] = row.children;
    nameI.addEventListener("input", () => (it.name = nameI.value));
    priceI.addEventListener("input", () => { it.price = +priceI.value || 0; syncTotal(); });
    del.addEventListener("click", () => { editing.entry.items.splice(i, 1); renderItemRows(); });
    wrap.appendChild(row);
  });
  syncTotal();
}
function syncTotal() {
  const sum = editing.entry.items.reduce((s, it) => s + (+it.price || 0), 0);
  editing.entry.total = Math.round(sum * 100) / 100;
  $("#f-total").textContent = fmt(editing.entry.total);
}
$("#btn-add-item").addEventListener("click", () => {
  editing.entry.items.push({ name: "", price: 0 });
  renderItemRows();
});
$("#f-refund").addEventListener("change", () => {
  const on = $("#f-refund").checked;
  editing.entry.items = editing.entry.items.map((it) => ({ ...it, price: on ? -Math.abs(it.price) : Math.abs(it.price) }));
  editing.entry.isRefund = on;
  renderItemRows();
});
$("#btn-save").addEventListener("click", () => {
  const e = editing.entry;
  e.store = $("#f-store").value.trim();
  e.date = $("#f-date").value || todayISO();
  e.time = $("#f-time").value;
  e.category = $("#f-category").value;
  e.isRefund = $("#f-refund").checked;
  const idx = db.entries.findIndex((x) => x.id === e.id);
  if (idx >= 0) db.entries[idx] = e; else db.entries.push(e);
  save();
  $("#confirm-sheet").hidden = true;
  renderAll();
});
$("#btn-discard").addEventListener("click", () => {
  if (editing.isExisting) {
    if (!confirm("이 기록을 삭제할까요?")) return;
    db.entries = db.entries.filter((x) => x.id !== editing.entry.id);
    save();
  }
  $("#confirm-sheet").hidden = true;
  renderAll();
});

/* ================= 설정 ================= */
$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ledger-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#btn-import").addEventListener("click", () => $("#file-import").click());
$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.entries)) throw new Error("형식 오류");
    if (confirm("현재 데이터를 백업 파일 내용으로 교체할까요?")) {
      db = { entries: d.entries, fixed: d.fixed || [], income: d.income || [] };
      save(); renderAll();
    }
  } catch (err) {
    alert("불러오기에 실패했어요: " + err.message);
  }
  e.target.value = "";
});
$("#btn-wipe").addEventListener("click", () => {
  if (confirm("모든 기록·설정을 삭제할까요? 되돌릴 수 없어요.")) {
    db = { entries: [], fixed: [], income: [] };
    save(); renderAll();
  }
});

/* ================= 초기화 ================= */
function renderAll() { renderLedger(); renderStats(); renderCalendar(); }
renderAll();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    fetch("sw.js").then((r) => r.text()).then((t) => {
      const m = t.match(/CACHE_VERSION\s*=\s*"([^"]+)"/);
      if (m) $("#cache-ver").textContent = m[1];
    }).catch(() => {});
  }).catch(() => {});
}
