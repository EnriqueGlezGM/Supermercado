import { Modal } from 'bootstrap';
import { detectStore, extractTicketTotal, filterProductsSection, parseProducts } from './ticketParser';

let initialized = false;
let pdfJsLoadPromise = null;
let tesseractLoadPromise = null;
let html2canvasLoadPromise = null;

async function loadPdfJs() {
  if (!pdfJsLoadPromise) {
    pdfJsLoadPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfJsLoadPromise;
}

async function loadTesseract() {
  if (!tesseractLoadPromise) {
    tesseractLoadPromise = import('tesseract.js').then((mod) => mod.default || mod);
  }
  return tesseractLoadPromise;
}

async function loadHtml2canvas() {
  if (!html2canvasLoadPromise) {
    html2canvasLoadPromise = import('html2canvas').then((mod) => mod.default || mod);
  }
  return html2canvasLoadPromise;
}

export function initTicketApp() {
  if (initialized) return;
  initialized = true;

  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(e){
    if (e.matches) document.documentElement.setAttribute('data-bs-theme','dark');
    else document.documentElement.removeAttribute('data-bs-theme');
  }
  if (mq){ applyTheme(mq); mq.addEventListener('change', applyTheme); }

  document.body.classList.add('bg-light');

  /* ------------ ELEMENTOS Y ESTADO ------------ */
  const $file = document.getElementById('file');
  const $tblEl = document.getElementById('tbl');
  const $progress = document.getElementById('progress');
  const $meta = document.getElementById('meta');
  const $check = document.getElementById('check');
  const $catsum = document.getElementById('catsum');
  const $btnExport = document.getElementById('btnExport');
  const $exportRoot = document.getElementById('export-root');
  const $catAddBtn = document.getElementById('catAddBtn');
  const $btnToggleHidden = document.getElementById('btnToggleHidden');

  if (!$file || !$tblEl || !$progress || !$meta || !$check || !$catsum || !$btnExport || !$exportRoot) {
    return;
  }
  const $tbl = $tblEl.querySelector('tbody');

  let lastCheckOk = null;
  let lastExpected = NaN;
  let showHidden = false;
  let lastCalc = NaN;
  let lastFilename = '';
  let lastStore = '';
  let manualExpectedTotal = NaN;
  let ticketExpectedTotal = NaN;
  let manualTotalSuggestions = [];

  /* Reparto por fila (item.id -> [{id,pct}]) */
  const allocationMap = new Map();
  let currentItems = [];
  let itemsByKey = new Map();
  function itemKey(it) {
    return String(it?.id || '');
  }
  function assignItemIds(items, prefix = 'item'){
    (items || []).forEach((it, idx) => {
      if (!it.id) it.id = `${prefix}-${idx}`;
    });
  }

  /* Líneas manuales y base */
  let manualItems = [];
  let baseItems = [];

  /* Orden */
  let sortMode = 'alpha';

  /* -------- CATEGORÍAS DINÁMICAS (NAVBAR) -------- */
  let categories = [];
  let activeCategoryId = null;

  // Estado edición de categoría
  let catEditId = null;
  let catEditMode = 'edit';
  let catEditModal = null;
  let splitEditKey = null;
  let splitModal = null;
  let rowEditKey = null;
  let rowEditModal = null;

  function getCategoryById(id){ return categories.find(c => c.id === id); }
  function slugifyName(name){
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,'-').replace(/[^a-z0-9-]/gi,'')
      .slice(0, 40);
  }
  function hexToRGBA(hex, alpha=0.2){
    hex = String(hex||'').trim();
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if(!m) return `rgba(0,0,0,${alpha})`;
    const i = parseInt(m[1],16);
    const r = (i>>16)&255, g=(i>>8)&255, b=i&255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function defaultCategories(){
    return [
    {id:'alberto', name:'Alberto', color:'#dc3545', locked:true},
    {id:'kike',    name:'Kike',    color:'#0d6efd', locked:true},
    {id:'comun',   name:'Común',   color:'#ffc107', locked:true, noSplit:true}
    ];
  }
  function normalizeStoredCategories(value){
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const clean = [];
    for (const raw of source){
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || '').trim().slice(0, 40);
      if (!name) continue;
      const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? String(raw.color) : '#22c55e';
      let id = String(raw.id || slugifyName(name) || `cat-${clean.length + 1}`).trim();
      id = slugifyName(id) || slugifyName(name) || `cat-${clean.length + 1}`;
      let unique = id;
      let n = 2;
      while (seen.has(unique)) unique = `${id}-${n++}`;
      seen.add(unique);
      clean.push({
        id: unique,
        name,
        color,
        locked: !!raw.locked,
        noSplit: !!raw.noSplit,
        masked: !!raw.masked
      });
    }
    return clean.length ? clean : defaultCategories();
  }
  function loadCategories(){
    try{
      const raw = localStorage.getItem('mc_cats');
      const act = localStorage.getItem('mc_cats_active');
      categories = normalizeStoredCategories(raw ? JSON.parse(raw) : defaultCategories());
      activeCategoryId = categories.some(c => c.id === act) ? act : (categories[0]?.id || null);
    }catch{
      categories = defaultCategories();
      activeCategoryId = categories[0]?.id || null;
    }
  }
  function saveCategories(){
    try {
      localStorage.setItem('mc_cats', JSON.stringify(categories));
      if (activeCategoryId !== null) localStorage.setItem('mc_cats_active', activeCategoryId);
    } catch {
      void 0;
    }
  }
  function setActiveCategory(id){
    activeCategoryId = id || null;
    saveCategories();
    renderCatBar();
  }

  function allocationTotal(list){
    return (list || []).reduce((acc, a) => acc + (Number(a.pct) || 0), 0);
  }
  function formatPercent(n){
    const val = isFinite(n) ? n : 0;
    const hasDecimals = Math.abs(val % 1) > 0.001;
    return val.toLocaleString('es-ES', {
      minimumFractionDigits: hasDecimals ? 1 : 0,
      maximumFractionDigits: 2
    });
  }
  function parsePercentInput(val){
    if (typeof val !== 'string') val = String(val ?? '');
    val = val.trim().replace('%','').replace(/\s+/g,'').replace(',', '.');
    const n = Number(val);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }
  function normalizeAllocations(list){
    const byId = new Map();
    for (const entry of (list || [])){
      if (!entry) continue;
      const id = String(entry.id || '').trim();
      if (!id) continue;
      if (!categories.some(c => c.id === id)) continue;
      let pct = Number(entry.pct);
      if (!isFinite(pct) || pct <= 0) continue;
      if (pct > 100) pct = 100;
      byId.set(id, (byId.get(id) || 0) + pct);
    }
    const out = [];
    for (const c of categories){
      const pct = byId.get(c.id);
      if (pct && pct > 0.001) out.push({ id: c.id, pct: Number(pct.toFixed(2)) });
    }
    return out;
  }
  function setAllocations(key, list){
    const clean = normalizeAllocations(list);
    if (!clean.length) allocationMap.delete(key);
    else allocationMap.set(key, clean);
  }
  function getAllocations(key){
    return allocationMap.get(key) || [];
  }
  function isAllocationComplete(key){
    const list = getAllocations(key);
    if (!list.length) return false;
    return Math.abs(allocationTotal(list) - 100) <= 0.2;
  }
  function getPrimaryAllocation(key){
    const list = getAllocations(key);
    if (!list.length) return null;
    let best = list[0];
    for (const a of list){
      if ((a.pct || 0) > (best.pct || 0)) best = a;
    }
    return best;
  }
  function replaceCategoryId(oldId, newId){
    if (!oldId || !newId) return;
    for (const [key, list] of Array.from(allocationMap.entries())){
      let changed = false;
      const next = list.map(a => {
        if (a.id === oldId){ changed = true; return { id: newId, pct: a.pct }; }
        return a;
      });
      if (changed) setAllocations(key, next);
    }
  }
  function removeCategoryId(id){
    if (!id) return;
    for (const [key, list] of Array.from(allocationMap.entries())){
      const next = list.filter(a => a.id !== id);
      if (!next.length){
        allocationMap.delete(key);
        continue;
      }
      const total = allocationTotal(next);
      if (total > 0){
        const scaled = next.map(a => ({ id: a.id, pct: (a.pct / total) * 100 }));
        setAllocations(key, scaled);
      } else {
        allocationMap.delete(key);
      }
    }
  }

  /* ---------- Footer spacer dinámico ---------- */
  function updateNavSpacer(){
    const nav = document.querySelector('.glass-nav.fixed-bottom');
    const sp = document.getElementById('nav-spacer');
    if (!nav || !sp) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const safeRaw = rootStyles.getPropertyValue('--safe-bottom') || '16';
    const safe = parseFloat(safeRaw) || 16;
    const extra = Math.max(12, safe * 0.5);
    const h = nav.offsetHeight + extra;
    sp.style.height = h + 'px';
    document.body.style.paddingBottom = h + 'px';
  }

  /* ---------- Render footer categorías ---------- */
  function renderCatBar(){
    const bar = document.getElementById('catBar');
    if (!bar) return;
    if (!categories.length){
      bar.innerHTML = `<span class="text-muted small">Añade categorías con el botón “+”.</span>`;
      updateNavSpacer();
      return;
    }
    const htmlCats = categories.map((c) => `
      <button type="button" class="catbtn ${activeCategoryId===c.id?'active':''}" data-cat-id="${c.id}" style="color:${c.color}">
        <span class="cat-swatch" style="background:${c.color}"></span>
        <span class="name">${escapeHtml(c.name)}</span>
      </button>`).join('');
    bar.innerHTML = htmlCats;

    bar.querySelectorAll('.catbtn').forEach((b)=>{
      b.addEventListener('click', ()=>{
        const id = b.getAttribute('data-cat-id');
        if (!id) return;
        if (id === activeCategoryId) {
          openCategoryEditor(id, 'edit');
        } else {
          setActiveCategory(id);
        }
      });
    });
    updateNavSpacer();
  }

  /* ---------- Editor categoría ---------- */
  function openCategoryEditor(id, mode='edit'){
    const isCreate = mode === 'create';
    catEditMode = isCreate ? 'create' : 'edit';
    catEditId = isCreate ? null : (id || activeCategoryId);
    const cat = isCreate ? null : getCategoryById(catEditId);
    if (!isCreate && !cat) return;

    const $name = document.getElementById('catEditName');
    const $color = document.getElementById('catEditColor');
    const $noSplit = document.getElementById('catEditNoSplit');
    const $mask = document.getElementById('catEditMask');
    const $title = document.getElementById('catEditLabel');
    const $hint = document.getElementById('catEditHint');
    const $save = document.getElementById('catEditSave');

    if ($name) $name.value = isCreate ? '' : (cat.name || '');
    if ($color) $color.value = isCreate
      ? '#22c55e'
      : (/^#[0-9a-f]{6}$/i.test(cat?.color || '') ? cat.color : '#22c55e');
    if ($noSplit) $noSplit.checked = isCreate ? false : !!cat.noSplit;
    if ($mask) $mask.checked = isCreate ? false : !!cat.masked;

    if ($title) $title.textContent = isCreate ? 'Nueva categoría' : 'Editar categoría';
    if ($hint) $hint.textContent = isCreate
      ? 'Pulsa “Crear” para añadir la nueva categoría.'
      : 'Pulsa “Guardar” para aplicar los cambios.';
    if ($save) $save.textContent = isCreate ? 'Crear' : 'Guardar';

    updateCatEditDeleteBtn();

    if (!catEditModal){
      const $modal = document.getElementById('catEditModal');
      catEditModal = new Modal($modal, { backdrop: true, focus: true, keyboard: true });
    }
    catEditModal.show();
    // Enfocar el campo nombre tras abrir (evita quedarse "bloqueado" por falta de foco)
    setTimeout(()=>{ try{ document.getElementById('catEditName')?.focus(); }catch{ void 0; } }, 50);
  }

  function updateCatEditDeleteBtn(){
    const delBtn = document.getElementById('catEditDelete');
    if (!delBtn) return;
    const isCreate = (catEditMode === 'create');
    // Ocultar en modo crear o si quedarían menos de 2 categorías tras borrar
    if (isCreate || categories.length <= 2){
      delBtn.classList.add('d-none');
      return;
    }
    delBtn.classList.remove('d-none');
  }

  function saveCategoryEditor(){
    const $name = document.getElementById('catEditName');
    const $color = document.getElementById('catEditColor');
    const $noSplit = document.getElementById('catEditNoSplit');
    const $mask = document.getElementById('catEditMask');
    if (!$name || !$color) return;

    const newName = String($name.value || '').trim();
    const newColor = String($color.value || '').trim();

    if (!newName){ alert('Pon un nombre.'); return; }
    if (!/^#[0-9a-f]{6}$/i.test(newColor)){ alert('Color inválido.'); return; }

    if (catEditMode === 'create'){
      const baseId = slugifyName(newName) || ('cat-' + Date.now().toString(36));
      let unique = baseId, k = 2;
      while (categories.some(c => c.id === unique)) unique = `${baseId}-${k++}`;
      const newCat = {
        id: unique,
        name: newName,
        color: newColor,
        locked: false,
        noSplit: !!$noSplit?.checked,
        masked: !!$mask?.checked
      };
      categories.push(newCat);
      activeCategoryId = newCat.id;
    } else {
      if (!catEditId) return;
      const cat = getCategoryById(catEditId);
      if (!cat) return;

      const oldId = cat.id;
      cat.name = newName;
      cat.color = newColor;
      cat.noSplit = !!$noSplit?.checked;
      cat.masked = !!$mask?.checked;

      // Permitimos renombrar incluso si era "locked"
      const proposed = slugifyName(newName) || oldId;
      if (proposed !== oldId){
        let unique = proposed, k=2;
        while (categories.some(c => c.id === unique && c !== cat)) unique = proposed + '-' + (k++);
        if (unique !== oldId){
          cat.id = unique;
          replaceCategoryId(oldId, unique);
          if (activeCategoryId === oldId) activeCategoryId = unique;
        }
      }
    }

    saveCategories();
    renderCatBar();
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
    renderManualCatDropdown();
    updateNavSpacer();

    if (catEditModal) catEditModal.hide();
    catEditId = null;
    catEditMode = 'edit';
  }

  function deleteCategoryEditor(){
    if (!catEditId) return;
    const cat = getCategoryById(catEditId);
    if (!cat) return;

    // Regla: no permitir que queden menos de 2 categorías
    if (categories.length <= 2){
      alert('Debe haber al menos 2 categorías. No se puede eliminar más.');
      return;
    }

    const used = Array.from(allocationMap.values()).some(list => list.some(a => a.id === cat.id));
    const msg = used
      ? `La categoría "${cat.name}" está asignada a algunas filas.\nSe eliminarán esas asignaciones. ¿Seguro que quieres eliminarla?`
      : `¿Eliminar la categoría "${cat.name}"?`;
    if (!confirm(msg)) return;

    // Eliminar asignaciones a esta categoría
    removeCategoryId(cat.id);
    // Quitar de la lista de categorías (incluye originales si toca)
    categories = categories.filter(c => c.id !== cat.id);

    // Ajustar activa
    if (activeCategoryId === cat.id){
      activeCategoryId = categories[0] ? categories[0].id : null;
    }

    saveCategories();
    renderCatBar();
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
    renderManualCatDropdown();
    updateNavSpacer();

    if (catEditModal) catEditModal.hide();
    catEditId = null;
    catEditMode = 'edit';
  }

  // Guardar / Eliminar desde el modal
  document.addEventListener('click', (ev)=>{
    const saveBtn = ev.target.closest('#catEditSave');
    if (saveBtn){ saveCategoryEditor(); return; }
    const delBtn = ev.target.closest('#catEditDelete');
    if (delBtn){ deleteCategoryEditor(); return; }
  });

  document.addEventListener('click', (ev)=>{
    const saveBtn = ev.target.closest('#splitSave');
    if (saveBtn){ saveSplitEditor(); return; }
    const clearBtn = ev.target.closest('#splitClear');
    if (clearBtn){ clearSplitEditor(); return; }
  });
  document.addEventListener('click', (ev)=>{
    const saveBtn = ev.target.closest('#rowEditSave');
    if (saveBtn){ saveRowEditor(); return; }
    const delBtn = ev.target.closest('#rowEditDelete');
    if (delBtn){ deleteRowEditor(); return; }
    const splitBtn = ev.target.closest('#rowEditSplit');
    if (splitBtn){
      if (rowEditKey) {
        if (rowEditModal) rowEditModal.hide();
        openSplitEditor(rowEditKey);
      }
      return;
    }
  });

  /* ------------ NUMÉRICO / FORMATO ------------ */
  const toNumberEUR = (s) => {
    if (typeof s === "number") return isFinite(s) ? s : NaN;
    if (typeof s !== "string") s = String(s ?? "");
    s = s.replace(/[−–—]/g, '-');
    s = s.replace(/\s+/g,"").replace(/[€\u0080]/g,"").replace(/\./g,"").replace(",",".");
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  };
  const toEUR = (n) => isFinite(n) ? n.toLocaleString("es-ES",{minimumFractionDigits:2, maximumFractionDigits:2}) : "0,00";
  function nearlyEqual(a,b,eps=0.01){ return isFinite(a)&&isFinite(b)&&Math.abs(a-b) <= eps; }
  function sanitizeAmountInput(str){
    if (typeof str !== 'string') str = String(str ?? '');
    str = str.trim().replace(/[€\s]/g,'').replace(/\./g,'').replace(',', '.');
    const n = Number(str);
    return isFinite(n) ? n : NaN;
  }

  /* ------------ PROGRESO / VALIDACIÓN ------------ */
  function setProgress(msg){ $progress.textContent = msg || ""; }
  function parseFilenameTotal(name){
    const m = String(name||"").match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
    return m ? toNumberEUR(m[1]) : NaN;
  }
  function extractManualTotalSuggestions(lines){
    const detectedTotal = extractTicketTotal(lines);
    const tokens = String((lines || []).join('\n')).match(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g) || [];
    const seen = new Set();
    const values = [];
    if (isFinite(detectedTotal) && detectedTotal > 0) {
      seen.add(detectedTotal.toFixed(2));
      values.push(Number(detectedTotal.toFixed(2)));
    }
    for (const token of tokens){
      const n = toNumberEUR(token);
      if (!isFinite(n) || n <= 0) continue;
      const key = n.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(Number(key));
    }
    values.sort((a, b) => b - a);
    return values.slice(0, 3);
  }
  function renderManualTotalSuggestions(){
    if (!manualTotalSuggestions.length) return '';
    return `<div class="mt-2">
      <div class="small text-muted mb-1">Sugerencias del ticket</div>
      <div class="d-flex flex-wrap gap-2">
        ${manualTotalSuggestions.map((val) => `
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary manual-total-suggestion"
            data-total="${val.toFixed(2)}"
          >${escapeHtml(toEUR(val))} €</button>
        `).join('')}
      </div>
    </div>`;
  }
  function setCheckNone(){ $check.innerHTML = '<span class="text-muted">— Validación pendiente —</span>'; }
  function expectedSourceLabel(filenameExpected, expected){
    if (isFinite(filenameExpected)) return `archivo: ${toEUR(filenameExpected)}`;
    if (isFinite(manualExpectedTotal)) return `manual: ${toEUR(expected)}`;
    if (isFinite(ticketExpectedTotal)) return `ticket: ${toEUR(expected)}`;
    return `manual: ${toEUR(expected)}`;
  }
  function setCheck(filename, totalCalc){
    const filenameExpected = parseFilenameTotal(filename);
    const expected = isFinite(filenameExpected)
      ? filenameExpected
      : (isFinite(manualExpectedTotal) ? manualExpectedTotal : ticketExpectedTotal);
    const hiddenTotal = getHiddenTotal(baseItems.concat(manualItems));
    const adjustedExpected = isFinite(expected) ? Number((expected - hiddenTotal).toFixed(2)) : NaN;
    let html = '';
    if (!isFinite(expected)) {
      html = `<div class="alert alert-secondary py-2 my-2" role="alert">
        <div class="fw-semibold mb-2">No se encontró importe en el nombre del archivo.</div>
        <form id="manualTotalForm" class="row g-2 align-items-end">
          <div class="col-12 col-sm-7">
            <label for="manualTotalInput" class="form-label small mb-1">Total del ticket</label>
            <div class="input-group">
              <span class="input-group-text">€</span>
              <input
                id="manualTotalInput"
                type="text"
                class="form-control mono"
                inputmode="decimal"
                autocomplete="off"
                placeholder="Ej. 44,66"
                value=""
              />
            </div>
          </div>
          <div class="col-12 col-sm-5">
            <button type="submit" class="btn btn-primary w-100">Usar este total</button>
          </div>
        </form>
        ${renderManualTotalSuggestions()}
      </div>`;
      lastCheckOk = null; lastExpected = NaN; lastCalc = Number(totalCalc)||NaN; lastFilename = filename || '';
    } else if (nearlyEqual(adjustedExpected, totalCalc)) {
      const sourceLabel = expectedSourceLabel(filenameExpected, expected);
      html = `<div class="alert alert-success fw-bold my-2" role="alert" style="font-size:1.05rem">
        ✅ Coincide — <span class="fw-normal">${sourceLabel}${hiddenTotal ? ` • ocultos: ${toEUR(hiddenTotal)}` : ''} • esperado: ${toEUR(adjustedExpected)} • calculado: ${toEUR(totalCalc)}</span>
      </div>`;
      lastCheckOk = true; lastExpected = Number(adjustedExpected); lastCalc = Number(totalCalc); lastFilename = filename || '';
    } else {
      const sourceLabel = expectedSourceLabel(filenameExpected, expected);
      html = `<div class="alert alert-danger fw-bold my-2" role="alert" style="font-size:1.05rem">
        ❌ No coincide — <span class="fw-normal">${sourceLabel}${hiddenTotal ? ` • ocultos: ${toEUR(hiddenTotal)}` : ''} • esperado: ${toEUR(adjustedExpected)} • calculado: ${toEUR(totalCalc)}</span>
      </div>`;
      if (!isFinite(filenameExpected)) {
        html += `<form id="manualTotalForm" class="row g-2 align-items-end mt-1">
          <div class="col-12 col-sm-7">
            <label for="manualTotalInput" class="form-label small mb-1">Corregir total del ticket</label>
            <div class="input-group">
              <span class="input-group-text">€</span>
              <input
                id="manualTotalInput"
                type="text"
                class="form-control mono"
                inputmode="decimal"
                autocomplete="off"
                value="${escapeHtml(toEUR(expected))}"
              />
            </div>
          </div>
          <div class="col-12 col-sm-5">
            <button type="submit" class="btn btn-outline-primary w-100">Actualizar total</button>
          </div>
        </form>`;
        html += renderManualTotalSuggestions();
      }
      lastCheckOk = false; lastExpected = Number(adjustedExpected); lastCalc = Number(totalCalc); lastFilename = filename || '';
    }
    $check.innerHTML = html;
    updateManualFixUI();
  }

  /* ------------ HELPERS TEXTO / BÚSQUEDA ------------ */
  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function normalizeDescKey(s){
    s = String(s||'').toLowerCase();
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); // tildes
    s = s.replace(/\s{2,}/g,' ').trim();
    return s;
  }
  function buildSearchURL(desc){
    const store = lastStore ? ` ${lastStore}` : '';
    const q = encodeURIComponent(`${String(desc||'').trim()}${store}`);
    return `https://www.google.com/search?tbm=isch&q=${q}`;
  }

  /* ------------ ICONOS PRECIO POR DESCRIPCIÓN ------------ */
  function priceFlagForRole(role){
    switch(role){
      case 'low': return '<span class="price-flag pf-low" title="Más barato">▼</span>';
      case 'high': return '<span class="price-flag pf-high" title="Más caro">▲</span>';
      case 'mid': return '<span class="price-flag pf-mid" title="Precio intermedio">●</span>';
      case 'eq': return '<span class="price-flag pf-eq" title="Mismo precio">⚖️</span>';
      default: return '';
    }
  }
  function getItemDiscountAmount(it){
    const n = Number(it && it.discountAmount);
    return isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0;
  }
  function hasItemDiscount(it){
    return getItemDiscountAmount(it) > 0.004;
  }
  function getItemBaseAmount(it){
    if (!it) return NaN;
    const base = Number(it.baseAmount);
    if (isFinite(base) && base >= 0) return Number(base.toFixed(2));
    const amount = Number(it.amount) || 0;
    const discount = getItemDiscountAmount(it);
    return Number((amount + discount).toFixed(2));
  }
  function getDiscountLabels(it){
    if (!it || !Array.isArray(it.discountLabels)) return [];
    return it.discountLabels.filter(Boolean);
  }
  function getDiscountSummaryLabel(it){
    const labels = Array.from(new Set(getDiscountLabels(it)));
    if (!labels.length) return 'Descuento';
    return labels.join(' + ');
  }
  function getDiscountBadgeLabel(it){
    const label = getDiscountSummaryLabel(it);
    if (/lidl\s*plus/i.test(label)) return 'Lidl Plus';
    if (/promo/i.test(label)) return 'Promo';
    return 'Desc.';
  }
  function renderDiscountBadge(it){
    if (!hasItemDiscount(it)) return '';
    const title = `${getDiscountSummaryLabel(it)}: -${toEUR(getItemDiscountAmount(it))} €`;
    return `<span class="discount-badge" title="${escapeHtml(title)}">${escapeHtml(getDiscountBadgeLabel(it))}</span>`;
  }
  function renderDiscountMeta(it){
    if (!hasItemDiscount(it)) return '';
    const label = escapeHtml(getDiscountSummaryLabel(it));
    const base = getItemBaseAmount(it);
    const baseInfo = isFinite(base)
      ? ` <span class="discount-base">antes ${toEUR(base)} €</span>`
      : '';
    return `<div class="discount-note">${label}: -${toEUR(getItemDiscountAmount(it))} €${baseInfo}</div>`;
  }
  function renderAmountCell(it){
    const amount = Number(it && it.amount) || 0;
    if (!hasItemDiscount(it)) return toEUR(amount);
    const base = getItemBaseAmount(it);
    return `<div class="amount-stack">
      <div class="amount-final">${toEUR(amount)}</div>
      ${isFinite(base) ? `<div class="amount-base">antes ${toEUR(base)} €</div>` : ''}
    </div>`;
  }

  function renderAllocationsCell(allocs){
    if (!allocs || !allocs.length) return '—';
    const byId = new Map(allocs.map(a => [a.id, a.pct]));
    const parts = categories
      .filter(c => byId.has(c.id))
      .map(c => {
        const pct = byId.get(c.id);
        const showPct = allocs.length > 1 || Math.abs((pct || 0) - 100) > 0.2;
        return `<div class="cat-split-item">
          <span class="cat-dot" style="background:${c.color}"></span>
          <span class="cat-name">${escapeHtml(c.name)}</span>
          ${showPct ? `<span class="cat-pct">${escapeHtml(formatPercent(pct))}%</span>` : ''}
        </div>`;
      });
    if (!parts.length) return '—';
    return `<div class="cat-split-list">${parts.join('')}</div>`;
  }

  /* ------------ RENDER TABLA ------------ */
  function getHiddenTotal(items){
    return (items || []).reduce((acc, it) => {
      if (!it || !it.hidden) return acc;
      return acc + (Number(it.amount) || 0);
    }, 0);
  }
  function isHidden(it){ return !!(it && it.hidden); }
  function updateHiddenToggle(count){
    if (!$btnToggleHidden) return;
    if (!count){
      $btnToggleHidden.disabled = true;
      $btnToggleHidden.classList.add('d-none');
      $btnToggleHidden.textContent = 'Mostrar ocultos';
      return;
    }
    $btnToggleHidden.classList.remove('d-none');
    $btnToggleHidden.disabled = false;
    $btnToggleHidden.innerHTML = showHidden
      ? `👁️‍🗨️✖ Ocultar (${count})`
      : `👁️ Mostrar (${count})`;
  }
  function setTable(items){
    items = (items || []).slice();
    if (Array.isArray(manualItems) && manualItems.length){
      items = items.concat(manualItems);
    }
    assignItemIds(items);
    const hiddenCount = items.filter(it => isHidden(it)).length;
    const hiddenTotal = getHiddenTotal(items);
    const visibleItems = items.filter(it => !isHidden(it));
    const renderItems = showHidden ? items : visibleItems;
    if(!renderItems || renderItems.length===0){
      const msg = hiddenCount
        ? `Todas las líneas están ocultas (${hiddenCount}).`
        : 'No se detectaron líneas de producto.';
      $tbl.innerHTML = `<tr><td colspan="4" class="text-muted">${msg}</td></tr>`;
      setCheckNone();
      $catsum.textContent = '';
      currentItems = [];
      itemsByKey = new Map();
      allocationMap.clear();
      updateExportButtonState();
      updateHiddenToggle(hiddenCount);
      return 0;
    }

    currentItems = visibleItems.slice();

    // Agrupar por descripción y asignar roles de precio
    const groups = new Map(); // descKey -> [{ key, amount }]
    const roleByKey = new Map(); // key -> 'low'|'high'|'mid'|'eq'
    for (const r of currentItems){
      const key = itemKey(r);
      const dkey = normalizeDescKey(r.description);
      if (!groups.has(dkey)) groups.set(dkey, []);
      groups.get(dkey).push({ key, amount: Number(r.amount)||0 });
    }
    for (const [, arr] of groups.entries()){
      if (arr.length <= 1){ roleByKey.set(arr[0].key, ''); continue; }
      let min = Infinity, max = -Infinity;
      for (const it of arr){ if (it.amount < min) min = it.amount; if (it.amount > max) max = it.amount; }
      const allEq = isFinite(min) && isFinite(max) && Math.abs(max - min) < 0.001;
      if (allEq){ for (const it of arr) roleByKey.set(it.key, 'eq'); }
      else {
        for (const it of arr){
          if (Math.abs(it.amount - min) < 0.001) roleByKey.set(it.key, 'low');
          else if (Math.abs(it.amount - max) < 0.001) roleByKey.set(it.key, 'high');
          else roleByKey.set(it.key, 'mid');
        }
      }
    }

    // Orden
    let sorted;
    if (sortMode === 'ticket') {
      sorted = renderItems.slice().sort((a,b) => {
        const oa = isFinite(a.origIndex) ? a.origIndex : Number.POSITIVE_INFINITY;
        const ob = isFinite(b.origIndex) ? b.origIndex : Number.POSITIVE_INFINITY;
        if (oa !== ob) return oa - ob;
        const da = normalizeDescKey(a.description);
        const db = normalizeDescKey(b.description);
        return da.localeCompare(db, 'es', { sensitivity:'base' });
      });
    } else {
      sorted = renderItems.slice().sort((a,b) => {
        const da = normalizeDescKey(a.description);
        const db = normalizeDescKey(b.description);
        const cmp = da.localeCompare(db, 'es', { sensitivity:'base' });
        if (cmp !== 0) return cmp;
        return (Number(a.amount)||0) - (Number(b.amount)||0);
      });
    }

    itemsByKey = new Map();
    let html = "";
    let total = 0;
    for (const r of currentItems){ total += Number(r.amount) || 0; }
    for(const r of sorted){
      const key = itemKey(r);
      itemsByKey.set(key, r);
      const hidden = isHidden(r);
      const allocs = hidden ? [] : getAllocations(key);
      const primaryAlloc = getPrimaryAllocation(key);
      const catObj = primaryAlloc ? getCategoryById(primaryAlloc.id) : null;
      const color = catObj ? catObj.color : '';
      const bg = color ? hexToRGBA(color, 0.22) : '';
      const style = color ? `style="--cat-color:${color}; --cat-bg:${bg}"` : '';
      const rowClassBase = allocs.length ? `row-assigned${allocs.length > 1 ? ' row-split' : ''}` : '';
      const rowClass = hidden ? `row-hidden${rowClassBase ? ' ' + rowClassBase : ''}` : rowClassBase;
      const role = (roleByKey.get(key) || '');
      const flag = priceFlagForRole(role);
      const discountBadge = renderDiscountBadge(r);
      const discountMeta = renderDiscountMeta(r);
      const catCell = hidden ? '<span class="text-muted">Oculto</span>' : renderAllocationsCell(allocs);

      html += `<tr data-key="${escapeHtml(key)}"
                 data-manual-id="${r.manualId ? escapeHtml(String(r.manualId)) : ''}"
                 data-cat-id="${primaryAlloc ? escapeHtml(primaryAlloc.id) : ''}"
                 data-hidden="${hidden ? '1' : '0'}"
                 class="${rowClass}"
                 ${style}>
        <td class="mono">
          <div class="qty-cell">
            <button type="button" class="btn btn-sm btn-outline-secondary btn-split" title="Editar producto" aria-label="Editar producto">✏️</button>
            <span class="qty-val">${escapeHtml(String(r.quantity))}</span>
            ${r.manualId
              ? `<button type="button" class="btn btn-sm btn-outline-danger btn-del" title="Eliminar línea manual">✖</button>`
              : ''
            }
          </div>
        </td>
        <td class="td-desc">
          <div class="desc-content">
            <a class="desc-link" href="${buildSearchURL(r.description)}" target="_blank" rel="noopener">
              ${flag}<span class="desc-text">${escapeHtml(r.description)}</span>
            </a>
            ${discountBadge}
          </div>
          ${discountMeta}
        </td>
      <td class="cat-cell">
        ${catCell}
      </td>
      <td class="text-end mono">${renderAmountCell(r)}</td>
    </tr>`;
    }
  html += `<tr class="table-light">
    <td></td>
    <td class="fw-bold">TOTAL</td>
    <td></td>
    <td class="text-end mono fw-bold">${toEUR(total)}</td>
  </tr>`;
  if (hiddenTotal){
    html += `<tr class="table-light">
      <td></td>
      <td class="fw-bold">Ocultos</td>
      <td></td>
      <td class="text-end mono fw-bold">${toEUR(hiddenTotal)}</td>
    </tr>`;
  }
  $tbl.innerHTML = html;

  updateCategorySummary();
  updateExportButtonState();
  updateHiddenToggle(hiddenCount);
  return total;
}

  /* ------------ RESUMEN Y COPIAR TOTALES ------------ */
  function updateCategorySummary() {
    const sums = {};
    for (const c of categories) sums[c.id] = { n:0, total:0, color:c.color, name:c.name };
    for (const [key, allocs] of allocationMap.entries()) {
      const it = itemsByKey.get(key);
      if (!it) continue;
      const amount = Number(it.amount) || 0;
      for (const a of allocs){
        if (!(a.id in sums)) continue;
        sums[a.id].n += 1;
        sums[a.id].total += amount * (Number(a.pct) || 0) / 100;
      }
    }
    const parts = categories.map(c=>{
      const s = sums[c.id];
      return `<span class="tag" data-total="${toEUR(s.total)}" title="Click para copiar total de ${escapeHtml(c.name)}" style="border-color:${c.color}22;">
                <span class="cat-swatch" style="background:${c.color}"></span>
                <strong style="color:${c.color}">${escapeHtml(c.name)}</strong>
                <span class="n">(${s.n}) ${toEUR(s.total)}</span>
              </span>`;
    }).join('');
    $catsum.innerHTML = '<div class="catsum-grid">' + parts + '</div>';
  }
  $catsum.addEventListener('click', async (ev) => {
    const tag = ev.target.closest('.tag');
    if (!tag) return;
    const val = tag.getAttribute('data-total') || '';
    try {
      await navigator.clipboard.writeText(val);
      const old = tag.innerHTML;
      tag.innerHTML = old + ' <span class="ms-1">📋</span>';
      setTimeout(() => { tag.innerHTML = old; }, 1000);
    } catch {
      alert('No se pudo copiar al portapapeles');
    }
  });

  /* ------------ EXPORTAR COMO IMAGEN ------------ */
  function buildExportCard(catObj, items) {
    const wrap = document.createElement('div');
    wrap.className = 'export-card';
    const total = items.reduce((a,b)=> a + (Number(b.amount)||0), 0);
    if (catObj.masked) {
      wrap.innerHTML = `
      <h2 style="color:${catObj.color}">Lista ${escapeHtml(catObj.name)}</h2>
      <div class="meta">Productos: ${items.length}</div>
      <table>
        <tbody>
          <tr>
            <td class="total">TOTAL</td>
            <td class="right mono total">${toEUR(total)}</td>
          </tr>
        </tbody>
      </table>
    `;
    } else {
      wrap.innerHTML = `
      <h2 style="color:${catObj.color}">Lista ${escapeHtml(catObj.name)}</h2>
      <table>
        <thead>
          <tr>
            <th style="width:100px;">Nº</th>
            <th>Producto</th>
            <th class="right" style="width:150px;">Importe (€)</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => {
            const pctLabel = (isFinite(it.pct) && Math.abs(it.pct - 100) > 0.2)
              ? ` (${formatPercent(it.pct)}%)`
              : '';
            return `
            <tr>
              <td class="mono">${escapeHtml(String(it.quantity))}</td>
              <td>${escapeHtml(String(it.description))}${pctLabel}</td>
              <td class="right mono">${toEUR(Number(it.amount))}</td>
            </tr>
            `;
          }).join('')}
          <tr>
            <td></td>
            <td class="total">TOTAL</td>
            <td class="right mono total">${toEUR(total)}</td>
          </tr>
        </tbody>
      </table>
    `;
    }
    return wrap;
  }
  async function exportCategoryImages() {
    const html2canvas = await loadHtml2canvas();
    if (!html2canvas) { alert('No se pudo cargar html2canvas.'); return; }
    if (lastCheckOk === false) {
      const msg = `⚠️ El total calculado (${toEUR(lastCalc)}) NO coincide con el del archivo (${toEUR(lastExpected)}).\n\n¿Quieres exportar igualmente?`;
      if (!confirm(msg)) return;
    }
    const byCat = {};
    for (const c of categories) byCat[c.id] = [];
    for (const [key, allocs] of allocationMap.entries()) {
      const it = itemsByKey.get(key);
      if (!it) continue;
      const amount = Number(it.amount) || 0;
      for (const alloc of allocs){
        if (!byCat[alloc.id]) continue;
        const partAmt = amount * (Number(alloc.pct) || 0) / 100;
        if (!isFinite(partAmt) || partAmt <= 0) continue;
        byCat[alloc.id].push({ ...it, amount: partAmt, pct: alloc.pct });
      }
    }
    const wrapper = document.createElement('div');
    wrapper.style.width = '980px';
    wrapper.style.background = '#fff';
    wrapper.style.padding = '16px';
    wrapper.style.border = '1px solid #e5e7eb';
    wrapper.style.borderRadius = '12px';
    wrapper.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';

    const title = document.createElement('h1');
    title.textContent = 'Resumen por categorías';
    title.style.fontSize = '22px';
    title.style.margin = '0 0 10px';
    wrapper.appendChild(title);

    const meta = document.createElement('div');
    meta.textContent = new Date().toLocaleString('es-ES');
    meta.style.color = '#6b7280';
    meta.style.fontSize = '12px';
    meta.style.marginBottom = '12px';
    wrapper.appendChild(meta);

    let added = 0;
    for (const c of categories) {
      const arr = byCat[c.id] || [];
      if (!arr.length) continue;
      const card = buildExportCard(c, arr);
      card.style.marginBottom = '16px';
      wrapper.appendChild(card);
      added++;
    }
    if (!added) { alert('No hay categorías con elementos para exportar.'); return; }

    let url = '';
    try {
      $exportRoot.appendChild(wrapper);
      const canvas = await html2canvas(wrapper, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      url = URL.createObjectURL(blob);
      const win = window.open();
      if (win) {
        const objectUrl = url;
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '0 auto';
        url = '';
        win.document.title = 'Resumen de categorías';
        win.document.body.style.margin = '0';
        win.document.body.style.background = '#fff';
        win.document.body.appendChild(img);
      } else {
        alert('El navegador bloqueó la ventana emergente. Permite pop-ups para ver la imagen.');
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      wrapper.remove();
    }
  }

  /* ------------ ESTADO EXPORT & ENLACE DESC ------------ */
  function updateExportButtonState() {
    if (!currentItems.length) {
      $btnExport.disabled = true;
      $btnExport.title = 'No hay productos para exportar';
      return;
    }
    let assigned = 0;
    for (const it of currentItems) {
      const key = itemKey(it);
      if (key && isAllocationComplete(key)) assigned++;
    }
    const allAssigned = assigned === currentItems.length;
    $btnExport.disabled = !allAssigned;
    $btnExport.title = allAssigned
      ? 'Exportar una única imagen con todas las categorías'
      : 'Asigna categoría a todas las filas para exportar';
  }

  // Evitar que el clic en el enlace de la descripción asigne categoría
  document.getElementById('tbl').addEventListener('click', (ev) => {
    const a = ev.target.closest('.td-desc a.desc-link');
    if (a){
      ev.stopPropagation(); // deja que el enlace funcione sin asignar fila
      return;
    }
  }, true);

  // Abrir editor de producto
  document.getElementById('tbl').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.btn-split');
    if (!btn) return;
    ev.stopPropagation();
    const tr = btn.closest('tr[data-key]');
    if (!tr) return;
    const key = tr.getAttribute('data-key');
    if (!key) return;
    openRowEditor(key);
  });

  /* ------------ CLIC EN FILA (asignación) ------------ */
  document.getElementById('tbl').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-key]');
    if (!tr) return;
    if (tr.getAttribute('data-hidden') === '1') return;
    if (ev.target.closest('.btn-del')) return;
    if (ev.target.closest('.btn-split')) return;
    if (ev.target.closest('a.desc-link')) return;
    const key = tr.getAttribute('data-key');
    if (!key) return;

    if (!activeCategoryId) {
      if (allocationMap.has(key)) allocationMap.delete(key);
    } else {
      const prev = getAllocations(key);
      const isSingleActive = prev.length === 1
        && prev[0].id === activeCategoryId
        && Math.abs((prev[0].pct || 0) - 100) <= 0.2;
      if (isSingleActive) allocationMap.delete(key);
      else setAllocations(key, [{ id: activeCategoryId, pct: 100 }]);
    }
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
  });
  document.getElementById('tbl').addEventListener('dblclick', (ev) => {
    const tr = ev.target.closest('tr[data-key]');
    if (!tr) return;
    if (ev.target.closest('.btn-del')) return;
    if (ev.target.closest('.btn-split')) return;
    if (ev.target.closest('a.desc-link')) return;
    const key = tr.getAttribute('data-key');
    if (!key) return;
    if (allocationMap.has(key)) allocationMap.delete(key);
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
  });

  // Eliminar línea manual
  document.getElementById('tbl').addEventListener('click', (ev) => {
    const del = ev.target.closest('.btn-del');
    if (!del) return;
    const tr = del.closest('tr');
    if (!tr) return;
    const mid = tr.getAttribute('data-manual-id');
    if (!mid) return;

    const idx = manualItems.findIndex(it => String(it.manualId) === String(mid));
    if (idx === -1) return;
    const it = manualItems[idx];
    const k = itemKey(it);
    if (allocationMap.has(k)) allocationMap.delete(k);
    manualItems.splice(idx, 1);
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
  }, true);

  /* ------------ PDF -> TEXTO ------------ */
  async function pdfToTextLines(buf){
    const { getDocument } = await loadPdfJs();
    const pdf = await getDocument({data: buf}).promise;
    const lines = [];
    let textItems = 0;
    for(let p=1;p<=pdf.numPages;p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      textItems += (content.items||[]).length;
      const byY = new Map();
      for(const it of content.items){
        const str = it.str || "";
        const tr = it.transform; const y = tr ? tr[5] : 0; const x = tr ? tr[4] : 0;
        const key = Math.round(y/2);
        if(!byY.has(key)) byY.set(key, []);
        byY.get(key).push({x, text: str});
      }
      const ys = Array.from(byY.keys()).sort((a,b)=>b-a);
      for(const y of ys){
        const chunks = byY.get(y).sort((a,b)=>a.x-b.x).map(c=>c.text);
        const line = chunks.map(c=>String(c||"").trim()).join(" ").replace(/\s{2,}/g," ").trim();
        if(line) lines.push(line);
      }
    }
    return {lines, textItems};
  }

  /* ------------ OCR (fallback) ------------ */
  async function pdfToTextLinesOCR(buf){
    const { getDocument } = await loadPdfJs();
    const Tesseract = await loadTesseract();
    if(!Tesseract) throw new Error("No se cargó Tesseract.js");
    const pdf = await getDocument({data: buf}).promise;
    const lines = [];
    for(let p=1;p<=pdf.numPages;p++){
      setProgress(`OCR página ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({scale: 2});
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({canvasContext:ctx, viewport}).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const res = await Tesseract.recognize(dataUrl, 'spa+eng', { logger: () => {} });
      const text = res.data && res.data.text ? res.data.text : "";
      const pageLines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      lines.push(...pageLines);
    }
    return lines;
  }

  function fileToDataURL(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  async function imageToTextLines(file){
    const Tesseract = await loadTesseract();
    if(!Tesseract) throw new Error("No se cargó Tesseract.js");
    setProgress("OCR imagen…");
    const dataUrl = await fileToDataURL(file);
    const res = await Tesseract.recognize(dataUrl, 'spa+eng', { logger: () => {} });
    const text = res.data && res.data.text ? res.data.text : "";
    return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  }

  function extractMeta(lines, store){
    const txt = lines.join("\n");
    const date = (txt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)||[])[1] || "";
    const time = (txt.match(/\b(\d{2}:\d{2})\b/)||[])[1] || "";
    const tienda = store || (txt.match(/LIDL/i) ? "Lidl" : (txt.match(/MERCADONA/i) ? "Mercadona" : ""));
    $meta.textContent = [tienda && `Comercio: ${tienda}`, (date||time) && `Fecha/Hora: ${date} ${time}`].filter(Boolean).join("\n");
  }

  /* ------------ PROCESO PRINCIPAL ------------ */
  async function processSelectedFile(){
    const f = $file.files && $file.files[0];
    if(!f){ return; }
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isImage = /^image\//i.test(f.type || '') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(f.name);
    if(!isPdf && !isImage){ alert("Debe ser un PDF o imagen."); return; }
    try{
      manualExpectedTotal = NaN;
      ticketExpectedTotal = NaN;
      manualTotalSuggestions = [];
      let lines = [];
      if (isPdf){
        setProgress("Cargando PDF...");
        const buf = new Uint8Array(await f.arrayBuffer());
        const {lines: lns, textItems} = await pdfToTextLines(buf);
        lines = lns;
        if(!lines.length || textItems===0){
          setProgress("Sin texto embebido. Haciendo OCR…");
          lines = await pdfToTextLinesOCR(buf);
        }
      } else {
        setProgress("Cargando imagen...");
        lines = await imageToTextLines(f);
      }
      setProgress("Extrayendo productos…");
      lastStore = detectStore(lines, f.name);
      ticketExpectedTotal = extractTicketTotal(lines);
      manualTotalSuggestions = extractManualTotalSuggestions(lines);
      extractMeta(lines, lastStore);
      const section = filterProductsSection(lines);
      const items = parseProducts(section, { store: lastStore });
      allocationMap.clear();
      manualItems = [];
      baseItems = items.slice();
      baseItems.forEach((it, idx) => {
        it.id = `base-${idx}`;
        it.origIndex = idx;
      });
      const total = setTable(baseItems);
      setCheck(f.name, total);
      setProgress("");
    } catch (e){
      console.error(e);
      alert("No se pudo procesar el archivo.");
      setProgress("");
    }
  }

  /* ------------ UI CORRECCIÓN MANUAL ------------ */
  function getRemaining(){
    if (!isFinite(lastExpected) || !isFinite(lastCalc)) return 0;
    return lastExpected - lastCalc;
  }
  function updateManualFixUI(){
    const box = document.getElementById('manualFix');
    const msg = document.getElementById('diffMsg');
    const amtInput = document.getElementById('mfAmount');
    const canCompare = isFinite(lastExpected) && isFinite(lastCalc);
    if (!box || !msg || !amtInput) return;
    if (!canCompare){
      box.classList.add('d-none');
      return;
    }
    const diff = getRemaining();
    const abs = Math.abs(diff);
    const falta = diff > 0.005;
    const sobra = diff < -0.005;

    if (falta) {
      msg.innerHTML = `<div class="alert alert-warning py-2 my-0" role="alert">
        Falta <strong>${toEUR(abs)}</strong> para cuadrar con el total del archivo.
      </div>`;
      amtInput.value = toEUR(abs);
      document.getElementById('btnAddManual').disabled = false;
      box.classList.remove('d-none');
    } else if (sobra) {
      msg.innerHTML = `<div class="alert alert-danger py-2 my-0" role="alert">
        Sobra <strong>${toEUR(abs)}</strong> respecto al total del archivo. Revisa las líneas detectadas.
      </div>`;
      amtInput.value = toEUR(0);
      document.getElementById('btnAddManual').disabled = true;
      box.classList.remove('d-none');
    } else {
      box.classList.add('d-none');
      return;
    }
  }

  /* ------------ Dropdown manual con colores ------------ */
  function renderManualCatDropdown(){
    const wrap = document.getElementById('mfCatWrap');
    const hidden = document.getElementById('mfCatVal');
    if (!wrap || !hidden) return;

    const def = activeCategoryId || (categories[0] && categories[0].id) || '';
    const defObj = categories.find(c => c.id === def) || categories[0] || {id:'', name:'', color:'#888'};
    hidden.value = defObj.id;

    wrap.innerHTML = `
      <button class="btn btn-outline-secondary dropdown-toggle cat-dd-btn" type="button" data-bs-toggle="dropdown" aria-expanded="false">
        <span class="cat-dd-label">
          <span class="cat-dd-dot" style="background:${defObj.color}"></span>
          <span class="cat-dd-name">${escapeHtml(defObj.name)}</span>
        </span>
      </button>
      <ul class="dropdown-menu w-100">
        ${categories.map(c => `
          <li>
            <button type="button" class="dropdown-item cat-dd-item" data-id="${c.id}" data-color="${c.color}">
              <span class="cat-dd-dot" style="background:${c.color}"></span>
              <span>${escapeHtml(c.name)}</span>
            </button>
          </li>
        `).join('')}
      </ul>
    `;

    wrap.querySelectorAll('.cat-dd-item').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-id');
        const color = btn.getAttribute('data-color');
        const name = btn.textContent.trim();
        hidden.value = id;
        const lab = wrap.querySelector('.cat-dd-name');
        const dot = wrap.querySelector('.cat-dd-dot');
        if (lab) lab.textContent = name;
        if (dot) dot.style.background = color;
      });
    });
  }

  /* ------------ Reparto porcentual ------------ */
  function initSplitModal(){
    if (splitModal) return;
    const $modal = document.getElementById('splitModal');
    if (!$modal) return;
    splitModal = new Modal($modal, { backdrop: true, focus: true, keyboard: true });
    $modal.addEventListener('hidden.bs.modal', () => { splitEditKey = null; });
  }
  function updateSplitTotal(){
    const inputs = Array.from(document.querySelectorAll('#splitList .split-input'));
    let total = 0;
    for (const input of inputs){
      total += parsePercentInput(input.value);
    }
    const totalEl = document.getElementById('splitTotal');
    if (totalEl) totalEl.textContent = `${formatPercent(total)}%`;
    const warn = document.getElementById('splitWarn');
    const ok = Math.abs(total - 100) <= 0.2;
    if (warn) warn.classList.toggle('d-none', ok || total === 0);
    if (totalEl){
      totalEl.classList.toggle('text-success', ok);
      totalEl.classList.toggle('text-danger', !ok && total > 0);
    }
  }
  function readSplitAllocations(){
    const inputs = Array.from(document.querySelectorAll('#splitList .split-input'));
    const list = [];
    for (const input of inputs){
      const id = input.getAttribute('data-cat-id');
      const pct = parsePercentInput(input.value);
      if (pct > 0) list.push({ id, pct });
    }
    return list;
  }
  function openSplitEditor(key){
    const it = itemsByKey.get(key);
    if (!it) return;
    splitEditKey = key;
    initSplitModal();
    if (!splitModal) return;

    const meta = document.getElementById('splitItemMeta');
    if (meta) {
      meta.innerHTML = `<div class="fw-semibold">${escapeHtml(it.description)}</div>
        <div class="small text-muted">Importe: ${toEUR(it.amount)}</div>`;
    }

    const list = document.getElementById('splitList');
    const allocs = getAllocations(key);
    const byId = new Map(allocs.map(a => [a.id, a.pct]));
    if (list){
      list.innerHTML = categories
        .filter(c => !c.noSplit)
        .map(c => {
        const pct = byId.get(c.id) || 0;
        const value = pct > 0 ? formatPercent(pct) : '';
        return `<div class="split-row">
          <div class="split-label">
            <span class="cat-dot" style="background:${c.color}"></span>
            <span class="name">${escapeHtml(c.name)}</span>
          </div>
          <div class="input-group input-group-sm split-input-group">
            <input type="text" class="form-control split-input" data-cat-id="${c.id}" inputmode="decimal" value="${value}" placeholder="0">
            <span class="input-group-text">%</span>
          </div>
        </div>`;
      }).join('');
      list.querySelectorAll('.split-input').forEach((input) => {
        input.addEventListener('input', updateSplitTotal);
        input.addEventListener('blur', () => {
          const n = parsePercentInput(input.value);
          input.value = n > 0 ? formatPercent(n) : '';
          updateSplitTotal();
        });
      });
    }

    const clearBtn = document.getElementById('splitClear');
    if (clearBtn) clearBtn.disabled = allocs.length === 0;
    updateSplitTotal();
    splitModal.show();
  }
  function saveSplitEditor(){
    if (!splitEditKey) return;
    const list = readSplitAllocations();
    const locked = getAllocations(splitEditKey).filter(a => {
      const c = getCategoryById(a.id);
      return c && c.noSplit;
    });
    const total = allocationTotal(list);
    if (total <= 0.2){
      if (locked.length) setAllocations(splitEditKey, locked);
      else allocationMap.delete(splitEditKey);
    } else if (Math.abs(total - 100) > 0.2){
      const warn = document.getElementById('splitWarn');
      if (warn) warn.classList.remove('d-none');
      return;
    } else {
      setAllocations(splitEditKey, list.concat(locked));
    }
    const totalCalc = setTable(baseItems);
    lastCalc = totalCalc;
    setCheck(lastFilename || '', totalCalc);
    if (splitModal) splitModal.hide();
  }
  function clearSplitEditor(){
    if (!splitEditKey) return;
    allocationMap.delete(splitEditKey);
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
    if (splitModal) splitModal.hide();
  }

  /* ------------ EDITAR PRODUCTO ------------ */
  function initRowEditModal(){
    if (rowEditModal) return;
    const $modal = document.getElementById('rowEditModal');
    if (!$modal) return;
    rowEditModal = new Modal($modal, { backdrop: true, focus: true, keyboard: true });
    $modal.addEventListener('hidden.bs.modal', () => { rowEditKey = null; });
  }
  function openRowEditor(key){
    const it = itemsByKey.get(key);
    if (!it) return;
    rowEditKey = key;
    initRowEditModal();
    if (!rowEditModal) return;

    const nameInput = document.getElementById('rowEditName');
    const amtInput = document.getElementById('rowEditAmount');
    if (nameInput) nameInput.value = it.description || '';
    if (amtInput) amtInput.value = toEUR(Number(it.amount) || 0);
    const discountWrap = document.getElementById('rowEditDiscountWrap');
    const discountInfo = document.getElementById('rowEditDiscount');
    if (discountWrap && discountInfo) {
      if (hasItemDiscount(it)) {
        const label = escapeHtml(getDiscountSummaryLabel(it));
        const base = getItemBaseAmount(it);
        discountInfo.innerHTML = `${label}: <strong>-${toEUR(getItemDiscountAmount(it))} €</strong>${isFinite(base) ? ` <span class="text-muted">sobre ${toEUR(base)} €</span>` : ''}`;
        discountWrap.classList.remove('d-none');
      } else {
        discountInfo.textContent = '';
        discountWrap.classList.add('d-none');
      }
    }
    const delBtn = document.getElementById('rowEditDelete');
    if (delBtn) {
      delBtn.disabled = false;
      delBtn.textContent = it.hidden ? '👁️ Mostrar' : '👁️‍🗨️✖ Ocultar';
      delBtn.classList.toggle('btn-outline-danger', !it.hidden);
      delBtn.classList.toggle('btn-outline-success', !!it.hidden);
    }
    rowEditModal.show();
  }
  function hideItemByKey(key){
    const it = itemsByKey.get(key);
    if (!it) return false;
    it.hidden = true;
    if (allocationMap.has(key)) allocationMap.delete(key);
    return true;
  }
  function unhideItemByKey(key){
    const it = itemsByKey.get(key);
    if (!it) return false;
    it.hidden = false;
    return true;
  }
  function saveRowEditor(){
    if (!rowEditKey) return;
    const it = itemsByKey.get(rowEditKey);
    if (!it) return;

    const nameInput = document.getElementById('rowEditName');
    const amtInput = document.getElementById('rowEditAmount');
    const nextName = nameInput ? nameInput.value.trim() : '';
    const nextAmt = amtInput ? sanitizeAmountInput(amtInput.value) : NaN;
    if (!nextName) { alert('Introduce una descripción.'); return; }
    if (!isFinite(nextAmt)) { alert('Importe inválido.'); return; }

    const oldKey = rowEditKey;
    it.description = nextName;
    it.amount = Number(nextAmt.toFixed(2));
    if (hasItemDiscount(it)) {
      it.baseAmount = Number((it.amount + getItemDiscountAmount(it)).toFixed(2));
    }
    if (isFinite(it.quantity) && it.quantity > 0){
      it.unit = Number((it.amount / it.quantity).toFixed(2));
    }

    const newKey = itemKey(it);
    if (newKey !== oldKey){
      const prev = getAllocations(oldKey);
      if (prev.length) setAllocations(newKey, prev);
      if (allocationMap.has(oldKey)) allocationMap.delete(oldKey);
      rowEditKey = newKey;
    }

    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
    if (rowEditModal) rowEditModal.hide();
  }
  function deleteRowEditor(){
    if (!rowEditKey) return;
    const it = itemsByKey.get(rowEditKey);
    if (!it) return;
    if (it.hidden) {
      if (!unhideItemByKey(rowEditKey)) return;
    } else {
      const ok = confirm('¿Ocultar esta línea del ticket?');
      if (!ok) return;
      if (!hideItemByKey(rowEditKey)) return;
    }
    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);
    if (rowEditModal) rowEditModal.hide();
  }

  /* ------------ EVENTOS ------------ */
  $file.addEventListener('change', processSelectedFile);
  $check.addEventListener('submit', (ev) => {
    const form = ev.target.closest('#manualTotalForm');
    if (!form) return;
    ev.preventDefault();
    const input = form.querySelector('#manualTotalInput');
    const nextTotal = input ? sanitizeAmountInput(input.value) : NaN;
    if (!isFinite(nextTotal) || nextTotal <= 0) {
      if (input) input.classList.add('is-invalid');
      return;
    }
    manualExpectedTotal = Number(nextTotal.toFixed(2));
    const total = isFinite(lastCalc) ? lastCalc : 0;
    setCheck(lastFilename || '', total);
  });
  $check.addEventListener('input', (ev) => {
    const input = ev.target.closest('#manualTotalInput');
    if (!input) return;
    input.classList.remove('is-invalid');
  });
  $check.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.manual-total-suggestion');
    if (!btn) return;
    const nextTotal = Number(btn.getAttribute('data-total'));
    if (!isFinite(nextTotal) || nextTotal <= 0) return;
    manualExpectedTotal = Number(nextTotal.toFixed(2));
    const total = isFinite(lastCalc) ? lastCalc : 0;
    setCheck(lastFilename || '', total);
  });
  $check.addEventListener('blur', (ev) => {
    const input = ev.target.closest('#manualTotalInput');
    if (!input) return;
    const n = sanitizeAmountInput(input.value);
    if (isFinite(n) && n > 0) input.value = toEUR(n);
  }, true);
  if ($btnToggleHidden){
    $btnToggleHidden.addEventListener('click', () => {
      showHidden = !showHidden;
      const total = setTable(baseItems);
      lastCalc = total;
      setCheck(lastFilename || '', total);
    });
  }

  // Saneo en vivo del importe manual
  const $mfAmount = document.getElementById('mfAmount');
  $mfAmount.addEventListener('input', () => {
    const n = sanitizeAmountInput($mfAmount.value);
    const rem = getRemaining();
    const over = isFinite(n) && n - rem > 0.005;
    $mfAmount.classList.toggle('is-invalid', !!over);
  });
  $mfAmount.addEventListener('blur', () => {
    const n = sanitizeAmountInput($mfAmount.value);
    if (isFinite(n) && n > 0) $mfAmount.value = toEUR(n);
  });

  const $rowEditAmount = document.getElementById('rowEditAmount');
  if ($rowEditAmount){
    $rowEditAmount.addEventListener('blur', () => {
      const n = sanitizeAmountInput($rowEditAmount.value);
      if (isFinite(n)) $rowEditAmount.value = toEUR(n);
    });
  }

  // Añadir línea manual
  document.getElementById('manualForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const desc = document.getElementById('mfDesc').value.trim();
    const cat = document.getElementById('mfCatVal').value;
    const amtStr = document.getElementById('mfAmount').value;
    const amtNum = sanitizeAmountInput(amtStr);
    const rem = getRemaining();

    if (!desc) { alert('Introduce una descripción.'); return; }
    if (!isFinite(amtNum) || amtNum <= 0){ alert('Importe inválido.'); return; }
    if (!(rem > 0.005)) { alert('Ahora mismo no falta importe (o sobra).'); return; }
    if ((amtNum - rem) > 0.005) {
      alert(`El importe supera lo que falta por ajustar (${toEUR(rem)}).`);
      return;
    }

    const it = {
      id: 'manual-' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      quantity: 1,
      description: desc,
      unit: amtNum,
      amount: amtNum,
      manualId: Date.now() + '_' + Math.random().toString(36).slice(2,7),
      origIndex: Number.POSITIVE_INFINITY
    };
    manualItems.push(it);

    const key = itemKey(it);
    if (cat) setAllocations(key, [{ id: cat, pct: 100 }]);

    const total = setTable(baseItems);
    lastCalc = total;
    setCheck(lastFilename || '', total);

    document.getElementById('mfDesc').value = '';
    const newRem = getRemaining();
    document.getElementById('mfAmount').value = newRem > 0.005 ? toEUR(newRem) : toEUR(0);
    document.getElementById('mfDesc').focus();
  });

  // Export
  $btnExport.addEventListener('click', exportCategoryImages);

    loadCategories();
    renderCatBar();
    updateManualFixUI();
    renderManualCatDropdown();
    updateNavSpacer();
    window.addEventListener('resize', updateNavSpacer);

    if ($catAddBtn) $catAddBtn.addEventListener('click', () => openCategoryEditor(null, 'create'));

    // Botón de orden en cabecera
    const $btnSort = document.getElementById('btnSort');
    if ($btnSort) {
      const refreshLabel = () => { $btnSort.textContent = (sortMode === 'alpha') ? 'A→Z' : 'Ticket'; };
      refreshLabel();
      $btnSort.addEventListener('click', () => {
        sortMode = (sortMode === 'alpha') ? 'ticket' : 'alpha';
        refreshLabel();
        const total = setTable(baseItems);
        lastCalc = total;
        setCheck(lastFilename || '', total);
      });
    }
}
