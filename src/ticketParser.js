export const toNumberEUR = (s) => {
  if (typeof s === 'number') return isFinite(s) ? s : NaN;
  if (typeof s !== 'string') s = String(s ?? '');
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/\s+/g, '').replace(/[€\u0080]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
};

function getItemDiscountAmount(it) {
  const n = Number(it && it.discountAmount);
  return isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0;
}

function hasItemDiscount(it) {
  return getItemDiscountAmount(it) > 0.004;
}

function getItemBaseAmount(it) {
  if (!it) return NaN;
  const base = Number(it.baseAmount);
  if (isFinite(base) && base >= 0) return Number(base.toFixed(2));
  const amount = Number(it.amount) || 0;
  const discount = getItemDiscountAmount(it);
  return Number((amount + discount).toFixed(2));
}

function applyDiscountToItem(it, discount, label) {
  if (!it) return false;
  let discountNum = Number(discount);
  if (!isFinite(discountNum) || Math.abs(discountNum) < 0.001) return false;
  if (discountNum > 0) discountNum = -discountNum;
  const currentAmount = Number(it.amount) || 0;
  if (Math.abs(discountNum) > Math.abs(currentAmount) * 1.05) return false;
  const nextAmount = Number((currentAmount + discountNum).toFixed(2));
  if (nextAmount < -0.01) return false;
  const baseAmount = hasItemDiscount(it) ? getItemBaseAmount(it) : currentAmount;
  it.baseAmount = Number(baseAmount.toFixed(2));
  it.discountAmount = Number((getItemDiscountAmount(it) + Math.abs(discountNum)).toFixed(2));
  const labels = Array.isArray(it.discountLabels) ? it.discountLabels.slice() : [];
  if (label) labels.push(String(label).trim());
  it.discountLabels = Array.from(new Set(labels.filter(Boolean)));
  it.amount = nextAmount;
  if (isFinite(it.quantity) && it.quantity > 0) {
    it.unit = Number((it.amount / it.quantity).toFixed(2));
  }
  return true;
}

export function normalizeLine(s) {
  s = String(s || '');
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/[×]/g, 'x');
  s = s.replace(/(\d)[oO](\d)/g, '$10$2');
  s = s.replace(/,(\d)[sS]\b/g, ',$15');
  s = s.replace(/,(\d)[oO]\b/g, ',$10');
  s = s.replace(/\s*[€\u0080]\s*/g, ' €');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function normalizeAmountToken(val) {
  let out = String(val || '');
  out = out.replace(/[−–—]/g, '-');
  if (/,\d$/.test(out)) out = out + '0';
  return out;
}

function findLastPrice(str) {
  const s = normalizeLine(str);
  const m = s.match(/(-?\d{1,3}(?:\.\d{3})*,\d{1,2})(?:\s*[€\u0080])?(?!.*\d)/);
  if (!m) return null;
  return normalizeAmountToken(m[1]);
}

function nextNonEmpty(arr, i) {
  let j = i + 1;
  while (j < arr.length) {
    const s = String(arr[j] || '').trim();
    if (s) return { index: j, text: s };
    j++;
  }
  return { index: -1, text: '' };
}

export function filterProductsSection(lines) {
  const L = lines.map((s) => normalizeLine(String(s || '').trim()));
  const looksLikeProduct = (s, next) => {
    const row = s || '';
    const nxt = next || '';
    if (/^(TOTAL|ENTREGA|IMP\.|IVA|BASE IMPONIBLE|CUOTA)\b/i.test(row)) return false;
    if (/^\s*\d+\s+.+\s+\d+,\d{2}(?:\s+\d+,\d{2})?\s*$/.test(row)) return true;
    if (/\d{1,3}(?:\.\d{3})*,\d{1,2}\s*x\s*\d+(?:[.,]\d+)?/i.test(row)) return true;
    if (/^\D{2,}$/.test(row) && /\b(kg|g|l)\b.*\d+,\d{2}.*\d+,\d{2}/i.test(nxt)) return true;
    if (/^\s*\d+\s+\D+/.test(row) && /\b(kg|g|l)\b.*\d+,\d{2}.*\d+,\d{2}/i.test(nxt)) return true;
    if (/^\s*\d+\s+\D+/.test(row) && !!findLastPrice(nxt)) return true;
    if (/^[A-ZÁÉÍÓÚÑ].*\d{1,3}(?:\.\d{3})*,\d{2}\s*(?:[A-Z])?\s*$/i.test(row)) return true;
    if (/\bDESC(?:UENTO)?\.?/i.test(row) && /-?\d{1,3}(?:\.\d{3})*,\d{2}/.test(row)) return true;
    return false;
  };

  let start = -1;
  let end = L.length;
  for (let i = 0; i < L.length; i++) {
    const s = L[i] && L[i].trim();
    if (!s) continue;
    if (/^TOTAL\b/i.test(s) || /^TOTAL\s*[:€]/i.test(s) || /^TOTAL\s+(\d+|\d{1,3}(\.\d{3})*,\d{2})/i.test(s)) {
      end = i;
      break;
    }
  }
  for (let i = 0; i < end; i++) {
    const s = L[i] && L[i].trim();
    if (!s) continue;
    const { text: next } = nextNonEmpty(L, i);
    if (looksLikeProduct(s, next)) {
      start = i;
      break;
    }
  }
  if (start >= 0) return L.slice(start, end).filter(Boolean);
  return L.filter(Boolean);
}

export function detectStore(lines, filename) {
  const txt = `${(lines || []).join('\n')}\n${String(filename || '')}`;
  if (/LIDL/i.test(txt)) return 'Lidl';
  if (/MERCADONA/i.test(txt)) return 'Mercadona';
  return '';
}

function amountTokens(str) {
  return String(str || '').match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
}

function parseLastAmount(str) {
  const tokens = amountTokens(str);
  if (!tokens.length) return NaN;
  return toNumberEUR(tokens[tokens.length - 1]);
}

function isAmountOnlyLine(str) {
  return /^\s*-?\d{1,3}(?:\.\d{3})*,\d{2}\s*(?:€|EUR)?\s*$/i.test(String(str || ''));
}

function isPaymentOrSummaryLine(str) {
  return /\b(ENTREGA|ENTREGADO|EFECTIVO|CAMBIO|TARJ|MASTERCARD|VISA)\b/i.test(str)
    || /\b(OFERTA|CUPON|CUPÓN|DESC\.?\s*TOTAL|TOTAL\s+OFERTA|TOTAL\s+EN\s+COMPRA|TOTAL\s+COMPRA)\b/i.test(str);
}

export function extractTicketTotal(lines) {
  const L = (lines || []).map((line) => normalizeLine(line)).filter(Boolean);

  for (let i = 0; i < L.length; i++) {
    const row = L[i];
    if (!/^TOTAL\b/i.test(row)) continue;
    if (isPaymentOrSummaryLine(row)) continue;

    const sameLineTotal = parseLastAmount(row);
    if (isFinite(sameLineTotal) && sameLineTotal > 0) return Number(sameLineTotal.toFixed(2));

    for (let j = i + 1; j < Math.min(i + 3, L.length); j++) {
      if (!isAmountOnlyLine(L[j])) continue;
      const splitLineTotal = parseLastAmount(L[j]);
      if (isFinite(splitLineTotal) && splitLineTotal > 0) return Number(splitLineTotal.toFixed(2));
    }
  }

  const ivaHeaderIndex = L.findIndex((row) => /\bIVA\b/i.test(row) && /\bPVP\b/i.test(row));
  if (ivaHeaderIndex >= 0) {
    for (let i = ivaHeaderIndex + 1; i < Math.min(ivaHeaderIndex + 6, L.length); i++) {
      if (!/^SUMA\b/i.test(L[i])) continue;
      const taxSummaryTotal = parseLastAmount(L[i]);
      if (isFinite(taxSummaryTotal) && taxSummaryTotal > 0) return Number(taxSummaryTotal.toFixed(2));
    }
  }

  return NaN;
}

export function parseProducts(lines, options = {}) {
  const store = String(options.store || '');
  const isNoise = (s) => /(\bIVA\b|BASE IMPONIBLE|CUOTA\b|TARJ|MASTERCARD|EFECTIVO|FACTURA|SE ADMITEN DEVOLUCIONES|CAMBIO|ENTREGA|RECIBO|AUTORIZ|IMP\.|DEVOLUCION|DEVOLUCIONES|HORARIO|ATENCION|GRACIAS)/i.test(s);
  const isLidlPlusPromoLine = (s) => /\bPROMO\s+LIDL\s+PLUS\b/i.test(s);
  const isDiscountLine = (s) => /\b(?:DESC(?:UENTO)?\.?|PROMO\s+LIDL\s+PLUS)\b/i.test(s);
  const isWeightLine = (s) => /\b(kg|g|l)\b.*?(?:x|×)\s*-?\d{1,3}(?:\.\d{3})*,\d{2}/i.test(s);
  const matchWeightLine = (s) => String(s || '').match(/^\s*([\d.,]+)\s*(kg|g|l)\b.*?(?:x|×)\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const shouldAttachDiscount = () => store.toLowerCase() === 'lidl';
  const getDiscountLineLabel = (row) => isLidlPlusPromoLine(row) ? 'Promo Lidl Plus' : 'Descuento';
  const parseDiscountPercent = (row) => {
    const m = String(row || '').match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    if (!m) return NaN;
    const n = Number(m[1].replace(',', '.'));
    return isFinite(n) ? n : NaN;
  };
  const parseWeightQty = (raw, unit) => {
    let qty = Number(String(raw || '').replace(',', '.'));
    if (!isFinite(qty)) return NaN;
    const u = String(unit || '').toLowerCase();
    if (u === 'g') qty = qty / 1000;
    return qty;
  };
  const extractDiscountAmount = (row) => {
    if (/total/i.test(row)) return NaN;
    const p = findLastPrice(row);
    if (!p) return NaN;
    let amountNum = toNumberEUR(p);
    if (amountNum > 0 && !/[-−–—]/.test(p)) amountNum = -amountNum;
    return amountNum;
  };
  const clean = (s) => String(s || '').replace(/\s{2,}/g, ' ').trim();

  const out = [];
  const push = (q, d, u, a, lineIndex) => {
    const quantity = Number(String(q).replace(',', '.'));
    const amount = (typeof a === 'number') ? a : toNumberEUR(a);
    let unit = (u !== null && u !== undefined) ? toNumberEUR(u) : NaN;
    if (!isFinite(unit) || unit <= 0) unit = quantity > 0 ? amount / quantity : amount;
    if (!isFinite(quantity) || quantity <= 0 || !isFinite(amount)) return null;
    if (!d || d.length < 2) return null;
    const item = { quantity, description: d, unit: Number(unit.toFixed(2)), amount: Number(amount.toFixed(2)), _lineIndex: lineIndex };
    out.push(item);
    return item;
  };

  const attachDiscountToRecent = (amountNum, lineIndex, row, optionsForDiscount = {}) => {
    if (!out.length) return false;
    const immediateOnly = !!optionsForDiscount.immediateOnly;
    const startIndex = out.length - 1;
    for (let k = out.length - 1; k >= 0; k--) {
      if (immediateOnly && k !== startIndex) break;
      const it = out[k];
      const idx = Number(it._lineIndex);
      if (!immediateOnly && isFinite(idx) && (lineIndex - idx) > 4) break;
      if (!isFinite(idx)) continue;
      if (immediateOnly || (lineIndex - idx) <= 4) {
        const pct = parseDiscountPercent(row);
        let discount = amountNum;
        const currentAmount = Number(it.amount) || 0;
        if (!isFinite(discount) && isFinite(pct)) {
          discount = -Number((currentAmount * pct / 100).toFixed(2));
        }
        if (!isFinite(discount)) return false;
        if (discount > 0) discount = -discount;
        if (Math.abs(discount) > Math.abs(currentAmount) * 1.05 && isFinite(pct)) {
          discount = -Number((currentAmount * pct / 100).toFixed(2));
        }
        return applyDiscountToItem(it, discount, getDiscountLineLabel(row));
      }
    }
    return false;
  };

  const parseCombinedDiscountRow = (row, lineIndex) => {
    if (!isDiscountLine(row)) return false;
    if (/total/i.test(row)) return false;
    const prices = row.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (!prices || prices.length < 2) return false;
    const discountToken = normalizeAmountToken(prices[prices.length - 1]);
    let discount = toNumberEUR(discountToken);
    if (discount > 0 && !/[-−–—]/.test(discountToken)) discount = -discount;
    let baseToken = null;
    for (const t of prices) {
      const tok = normalizeAmountToken(t);
      const val = toNumberEUR(tok);
      if (isFinite(val) && val > 0) {
        baseToken = tok;
        break;
      }
    }
    if (!baseToken) baseToken = normalizeAmountToken(prices[0]);
    const baseVal = toNumberEUR(baseToken);
    if (!isFinite(baseVal)) return false;
    const pct = parseDiscountPercent(row);
    if (Math.abs(discount) > Math.abs(baseVal) * 1.05 && isFinite(pct)) {
      discount = -Number((baseVal * pct / 100).toFixed(2));
    }
    if (Math.abs(discount) > Math.abs(baseVal) * 1.05) return false;
    let cut = row.indexOf(baseToken);
    if (cut < 0) cut = row.lastIndexOf(baseToken);
    let desc = row.substring(0, cut).trim();
    let qty = 1;
    const leadQty = desc.match(/^\s*(\d+)\s+/);
    if (leadQty) {
      qty = Number(leadQty[1]);
      desc = desc.substring(leadQty[0].length).trim();
    }
    if (!desc || desc.length < 2) return false;
    const amount = Number((baseVal + discount).toFixed(2));
    const item = push(qty, desc, null, amount, lineIndex);
    if (item && Math.abs(discount) > 0.001) {
      item.baseAmount = Number(baseVal.toFixed(2));
      item.discountAmount = Number(Math.abs(discount).toFixed(2));
      item.discountLabels = [getDiscountLineLabel(row)];
    }
    return true;
  };

  const parseUnitTimesQtyRow = (row, lineIndex) => {
    if (isWeightLine(row)) return false;
    let m = row.match(/^\s*(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{1,2})(?:\s*[A-Z])?\s*$/i);
    if (m) {
      const unit = normalizeAmountToken(m[2]);
      const qty = Number(String(m[3]).replace(',', '.'));
      const amount = normalizeAmountToken(m[4]);
      if (isFinite(qty) && qty > 0) return !!push(qty, m[1].trim(), unit, amount, lineIndex);
    }

    m = row.match(/^\s*(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*[A-Z])?\s*$/i);
    if (!m) return false;
    const unit = normalizeAmountToken(m[2]);
    const unitNum = toNumberEUR(unit);
    const qty = Number(String(m[3]).replace(',', '.'));
    if (!isFinite(unitNum) || !isFinite(qty) || qty <= 0) return false;
    const amount = Number((unitNum * qty).toFixed(2));
    return !!push(qty, m[1].trim(), unit, amount, lineIndex);
  };

  const N = lines.map(clean).map(normalizeLine).filter(Boolean);

  let skipIdx = -1;
  for (let i = 0; i < N.length; i++) {
    if (i === skipIdx) {
      skipIdx = -1;
      continue;
    }
    const row = N[i];
    if (/^TOTAL\b/i.test(row) || /^TOTAL\s*[:€]/i.test(row)) break;
    const isDiscount = isDiscountLine(row);
    if (isNoise(row) && !isDiscount) continue;
    if (parseUnitTimesQtyRow(row, i)) continue;
    if (isWeightLine(row)) continue;
    if (shouldAttachDiscount() && parseCombinedDiscountRow(row, i)) continue;
    if (isDiscount && shouldAttachDiscount()) {
      const isLidlPlusPromo = isLidlPlusPromoLine(row);
      let amountNum = extractDiscountAmount(row);
      if (!isFinite(amountNum)) {
        const { index: j, text: next } = nextNonEmpty(N, i);
        if (j !== -1 && /^[^a-zA-Z]*-?\d{1,3}(?:\.\d{3})*,\d{1,2}\s*(?:[€\u0080])?\s*$/.test(next)) {
          amountNum = extractDiscountAmount(next);
          skipIdx = j;
        }
      }
      if (attachDiscountToRecent(amountNum, i, row, { immediateOnly: isLidlPlusPromo })) continue;
      if (isLidlPlusPromo) continue;
    }

    let m = row.match(/^\s*(\d+)\s+(.+?)\s+(\d+,\d{2})(?:\s*[€\u0080])?\s+(\d+,\d{2})(?:\s*[€\u0080])?.*$/);
    if (m) {
      push(m[1], m[2], m[3], m[4], i);
      continue;
    }

    m = row.match(/^\s*(\d+)\s+(.+?)\s+(\d+,\d{2})(?:\s*[€\u0080])?.*$/);
    if (m) {
      push(m[1], m[2], null, m[3], i);
      continue;
    }

    if (/^\D{2,}$/.test(row)) {
      const { index: j, text: next } = nextNonEmpty(N, i);
      if (j !== -1) {
        const m2 = next.match(/^\s*([\d.,]+)\s*(kg|g|l)\b.*?(\d+,\d{2}).*?(\d+,\d{2})\s*$/i);
        if (m2) {
          const qtyW = Number(m2[1].replace(',', '.'));
          push(qtyW, row, m2[3], m2[4], i);
          i = j;
          continue;
        }
      }
    }

    m = row.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (m) {
      const desc = m[2];
      const { index: j, text: next } = nextNonEmpty(N, i);
      if (j !== -1) {
        const m2 = next.match(/^\s*([\d.,]+)\s*(kg|g|l)\b.*?(\d+,\d{2}).*?(\d+,\d{2})\s*$/i);
        if (m2) {
          const qtyW = Number(m2[1].replace(',', '.'));
          push(qtyW, desc, m2[3], m2[4], i);
          i = j;
          continue;
        }
      }
    }

    m = row.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (m) {
      const qty = m[1];
      const desc = m[2];
      const { index: j, text: next } = nextNonEmpty(N, i);
      if (j !== -1) {
        const p = findLastPrice(next);
        if (p) {
          push(qty, desc, null, p, i);
          i = j;
          continue;
        }
      }
    }

    if (!/^\s*\d+\s+/.test(row)) {
      m = row.match(/^\s*(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:[A-Z])?\s*$/i);
      if (m) {
        const desc = m[1].trim();
        const amountToken = normalizeAmountToken(m[2]);
        let amountNum = toNumberEUR(amountToken);
        if (isDiscount && amountNum > 0 && !/[-−–—]/.test(m[2])) amountNum = -amountNum;
        const { index: j, text: next } = nextNonEmpty(N, i);
        const m2 = j !== -1 ? matchWeightLine(next) : null;
        if (m2) {
          const qtyW = parseWeightQty(m2[1], m2[2]);
          if (isFinite(qtyW) && qtyW > 0) {
            push(qtyW, desc, m2[3], amountNum, i);
            i = j;
            continue;
          }
        }
        push(1, desc, null, amountNum, i);
        continue;
      }
    }

    const euros = row.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (euros && euros.length >= 1) {
      const amountToken = normalizeAmountToken(euros[euros.length - 1]);
      let amountNum = toNumberEUR(amountToken);
      if (isDiscount && amountNum > 0 && !/[-−–—]/.test(amountToken)) amountNum = -amountNum;
      const unit = euros.length >= 2 ? normalizeAmountToken(euros[euros.length - 2]) : null;
      const leadQty = row.match(/^\s*(\d+)\s+/);
      const qty = leadQty ? Number(leadQty[1]) : 1;
      const cut = row.lastIndexOf(amountToken);
      let desc = row.substring(leadQty ? leadQty[0].length : 0, cut).trim();
      if (!desc) desc = row.replace(new RegExp(amountToken + '\\s*$'), '').trim();
      if (/^(TOTAL|IVA|BASE IMPONIBLE|CUOTA)\b/i.test(desc)) continue;
      push(qty, desc, unit, amountNum, i);
      continue;
    }

    const p = findLastPrice(row);
    if (p) {
      let amountNum = toNumberEUR(p);
      if (isDiscount && amountNum > 0 && !/[-−–—]/.test(p)) amountNum = -amountNum;
      const leadQty = row.match(/^\s*(\d+)\s+/);
      const qty = leadQty ? Number(leadQty[1]) : 1;
      const cut = row.lastIndexOf(p);
      let desc = row.substring(leadQty ? leadQty[0].length : 0, cut).trim();
      if (!desc) desc = row.replace(new RegExp(p + '\\s*$'), '').trim();
      if (!/^(TOTAL|IVA|BASE IMPONIBLE|CUOTA)\b/i.test(desc)) {
        push(qty, desc, null, amountNum, i);
      }
    }
  }
  return out;
}
