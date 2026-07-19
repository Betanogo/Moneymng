/* ============================================================
 * parser.js — OCR 결과(단어+좌표) → 구조화된 영수증 데이터
 *   PARSER.parseReceipt(ocrResult) -> {
 *     store, date, time, items:[{name, price}], total, isRefund
 *   }
 *   PARSER.mergeParts([part1, part2, ...]) -> 병합된 items
 * ============================================================ */

const PARSER = (() => {
  const PRICE_RE = /^-?\(?\$?\d{1,4}[.,]\d{2}\)?-?[A-Z]{0,2}$/;
  const SKIP_WORDS =
    /^(SUBTOTAL|SUB-TOTAL|SUB|TOTAL|TAX|HST|GST|PST|QST|CASH|CHANGE|DUE|TEND|VISA|DEBIT|MASTERCARD|MC|AMEX|INTERAC|BALANCE|APPROVED|AUTH|ACCT|CARD|PAYMENT|SAVINGS?|POINTS?|REWARDS?|OPTIMUM|LOYALTY|INVOICE|CASHIER|TERM|REF|SEQ|MERCHANT|CUSTOMER|COPY|THANK|MERCI)/i;
  const REFUND_RE = /(REFUND|RETURN|CREDIT\s*NOTE|VOID)/i;

  const DATE_RES = [
    // 2026-04-09 / 2026/04/09
    { re: /\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/, fn: (m) => iso(m[1], m[2], m[3]) },
    // 04/09/2026 (북미 MM/DD/YYYY 가정)
    { re: /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/, fn: (m) => iso(m[3], m[1], m[2]) },
    // 04/09/26
    { re: /\b(\d{1,2})[\/](\d{1,2})[\/](\d{2})\b/, fn: (m) => iso("20" + m[3], m[1], m[2]) },
    // Apr 9, 2026 / APR 09 26
    {
      re: /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/i,
      fn: (m) => {
        const mm = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
          .indexOf(m[1].slice(0, 3).toUpperCase()) + 1;
        const y = m[3].length === 2 ? "20" + m[3] : m[3];
        return iso(y, mm, m[2]);
      },
    },
  ];
  const TIME_RE = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?\b/i;

  function iso(y, m, d) {
    m = String(m).padStart(2, "0");
    d = String(d).padStart(2, "0");
    if (+m > 12 || +d > 31) return null;
    return `${y}-${m}-${d}`;
  }

  function parsePrice(t) {
    const neg = /-|\(/.test(t);
    const n = parseFloat(t.replace(/[^\d.,]/g, "").replace(",", "."));
    if (isNaN(n)) return null;
    return neg ? -n : n;
  }

  /* 단어들을 y좌표 근접도로 줄 단위 그룹핑 */
  function toLines(words) {
    const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const w of sorted) {
      const cy = w.y + w.h / 2;
      let line = lines.find((L) => Math.abs(L.cy - cy) < Math.max(10, w.h * 0.6));
      if (!line) {
        line = { cy, words: [] };
        lines.push(line);
      }
      line.words.push(w);
      line.cy = line.words.reduce((s, x) => s + x.y + x.h / 2, 0) / line.words.length;
    }
    return lines.map((L) => {
      L.words.sort((a, b) => a.x - b.x);
      return { words: L.words, text: L.words.map((w) => w.text).join(" ") };
    });
  }

  function parseReceipt(ocr) {
    const lines = toLines(ocr.words);
    const out = { store: "", date: null, time: null, items: [], total: null, isRefund: false };
    const fullText = lines.map((l) => l.text).join("\n");

    if (REFUND_RE.test(fullText)) out.isRefund = true;

    // 날짜/시간
    for (const l of lines) {
      if (!out.date) {
        for (const { re, fn } of DATE_RES) {
          const m = l.text.match(re);
          if (m) { const d = fn(m); if (d) { out.date = d; break; } }
        }
      }
      if (!out.time) {
        const m = l.text.match(TIME_RE);
        if (m) {
          let h = +m[1];
          const ap = (m[3] || "").toUpperCase();
          if (ap.startsWith("P") && h < 12) h += 12;
          if (ap.startsWith("A") && h === 12) h = 0;
          if (h < 24) out.time = `${String(h).padStart(2, "0")}:${m[2]}`;
        }
      }
    }

    // 상호명: 상단 4줄 중 가격/날짜/주소가 아닌 첫 알파벳 줄
    for (const l of lines.slice(0, 4)) {
      const t = l.text;
      if (/\d{3,}/.test(t) && !/[A-Za-z]{3,}/.test(t)) continue;
      if (PRICE_RE.test(t.replace(/\s/g, ""))) continue;
      if (/[A-Za-z]{3,}/.test(t)) { out.store = t.replace(/[^\w\s&'.-]/g, "").trim(); break; }
    }

    // 품목: "왼쪽 텍스트 + 우측 정렬 가격" 패턴
    const pageW = ocr.width;
    for (const l of lines) {
      const last = l.words[l.words.length - 1];
      if (!last || !PRICE_RE.test(last.text)) continue;
      if (last.x + last.w < pageW * 0.5) continue; // 가격은 오른쪽 절반에 있어야 함
      const nameWords = l.words.slice(0, -1);
      const name = nameWords.map((w) => w.text).join(" ")
        .replace(/^\d{6,}\s*/, "") // 앞자리 바코드/PLU 제거
        .trim();
      const price = parsePrice(last.text);
      if (price === null || !name) continue;

      if (SKIP_WORDS.test(name)) {
        if (/^(TOTAL|BALANCE)/i.test(name) && !/SUB/i.test(name)) out.total = Math.abs(price);
        continue;
      }
      if (Math.abs(price) > 5000) continue; // 카드번호 등 오인식 컷
      out.items.push({ name, price });
    }

    // 반품 영수증이면 품목 가격을 음수로 통일
    if (out.isRefund) {
      out.items = out.items.map((it) => ({ ...it, price: -Math.abs(it.price) }));
      if (out.total != null) out.total = -Math.abs(out.total);
    } else if (out.items.length && out.items.every((it) => it.price < 0)) {
      // 키워드는 없지만 전부 음수면 반품으로 간주
      out.isRefund = true;
      if (out.total != null) out.total = -Math.abs(out.total);
    }

    if (out.total == null) {
      out.total = round2(out.items.reduce((s, it) => s + it.price, 0));
    }
    return out;
  }

  /* ---------- 분할 촬영 병합 ---------- */

  function norm(s) {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  function sim(a, b) {
    a = norm(a); b = norm(b);
    if (!a.length || !b.length) return 0;
    const la = a.length, lb = b.length;
    const dp = Array.from({ length: la + 1 }, (_, i) => [i, ...Array(lb).fill(0)]);
    for (let j = 0; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++)
      for (let j = 1; j <= lb; j++)
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
    return 1 - dp[la][lb] / Math.max(la, lb);
  }
  function itemsMatch(a, b) {
    return Math.abs(a.price - b.price) < 0.005 && sim(a.name, b.name) >= 0.72;
  }

  /* A의 꼬리와 B의 머리에서 가장 긴 겹침 구간을 찾아 이어 붙인다.
     "같은 물건 2개 구매"와 "중복 촬영"을 구분하기 위해
     연속된 시퀀스 일치를 요구한다. */
  function mergeTwo(aItems, bItems) {
    const maxK = Math.min(aItems.length, bItems.length);
    for (let k = maxK; k >= 1; k--) {
      const tail = aItems.slice(aItems.length - k);
      const head = bItems.slice(0, k);
      let all = true;
      for (let i = 0; i < k; i++) {
        if (!itemsMatch(tail[i], head[i])) { all = false; break; }
      }
      if (all) return [...aItems, ...bItems.slice(k)];
    }
    return [...aItems, ...bItems]; // 겹침 없음 → 그냥 연결
  }

  function mergeParts(parts) {
    if (!parts.length) return { store: "", date: null, time: null, items: [], total: null, isRefund: false };
    const merged = { ...parts[0], items: [...parts[0].items] };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      merged.items = mergeTwo(merged.items, p.items);
      merged.store = merged.store || p.store;
      merged.date = merged.date || p.date;
      merged.time = merged.time || p.time;
      merged.isRefund = merged.isRefund || p.isRefund;
      // TOTAL은 보통 마지막 파트에만 찍힘
      if (p.total != null) merged.total = p.total;
    }
    const sum = round2(merged.items.reduce((s, it) => s + it.price, 0));
    // 인식된 TOTAL과 품목 합이 크게 다르면 품목 합을 신뢰(세금 별도 매장 감안해 느슨하게)
    if (merged.total == null) merged.total = sum;
    return merged;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  return { parseReceipt, mergeParts };
})();
