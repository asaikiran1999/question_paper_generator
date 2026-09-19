/* ==========================================================================
   Question Paper Generator — app.js
   Optimised build:
     • cached DOM lookups
     • rAF-batched rendering (coalesces rapid input events)
     • memoised question-body HTML
     • binary-search section slicing
     • dirty-checked watermark
     • one-click PDF download (html2pdf.js)
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ------------------------------------------------------------------ *
   *  Cached DOM references  (script is deferred → DOM is ready)
   * ------------------------------------------------------------------ */
  const $ = s => document.querySelector(s);

  const dom = {
    status:       $('#status'),
    sheet:        $('#sheet'),
    watermark:    $('#watermark'),
    sectionsList: $('#sectionsList'),
    mInst:        $('#mInst'),
    fsVal:        $('#fsVal'),
    wmOpVal:      $('#wmOpVal'),
    logoWVal:     $('#logoWVal'),
    pasteArea:    $('#pasteArea'),
    fileInput:    $('#fileInput'),
    logoFile:     $('#logoFile'),
    btnDownload:  $('#btnDownload'),
    btnPrint:     $('#btnPrint')
  };
  // The sheet is the element whose font-size we drive from the Layout slider
  const sheetHost = dom.sheet.parentElement;

  /* ------------------------------------------------------------------ *
   *  Default emblem
   * ------------------------------------------------------------------ */
  const DEFAULT_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#ffffff" stroke="#000000" stroke-width="3"/>
  <circle cx="50" cy="50" r="39" fill="none" stroke="#000000" stroke-width="1.1"/>
  <circle cx="50" cy="34" r="5" fill="#000000"/>
  <g stroke="#000000" stroke-width="2" stroke-linecap="round">
    <line x1="50" y1="19" x2="50" y2="25"/>
    <line x1="37" y1="24" x2="41.5" y2="28.5"/>
    <line x1="63" y1="24" x2="58.5" y2="28.5"/>
  </g>
  <path d="M50 60 C41 53 29 53 21 57 L21 79 C29 75 41 75 50 82 Z" fill="#000000"/>
  <path d="M50 60 C59 53 71 53 79 57 L79 79 C71 75 59 75 50 82 Z" fill="#000000"/>
</svg>`;
  const DEFAULT_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(DEFAULT_LOGO_SVG.trim());

  /* ------------------------------------------------------------------ *
   *  Application state
   * ------------------------------------------------------------------ */
  const state = {
    meta: {
      school  : 'Birla Open Minds International School, Rajahmundry',
      exam    : 'Half Yearly Examination (2026–27)',
      cls     : 'VIII',
      subject : 'Mathematics',
      time    : '3 Hours',
      maxMarks: '80',
      instructions:
`This question paper contains 38 questions.
This question paper is divided into 5 Sections A, B, C, D and E.
Section A: Q.1–18 are multiple choice questions and Q.19–20 are Assertion-Reason based questions of 1 mark each.
Section B: Q.21–25 are Very Short Answer (VSA) type questions carrying 2 marks each.
Section C: Q.26–31 are Short Answer (SA) type questions carrying 3 marks each.
Section D: Q.32–35 are Long Answer (LA) type questions carrying 5 marks each.
Section E: Q.36–38 are Case Study based questions carrying 4 marks each.
All questions are compulsory. Internal choices have been provided in some questions.
Draw neat and clean figures wherever required.
Take π = 22/7 wherever required, if not stated.
Use of calculators is not allowed.`
    },
    logo: { src: '', show: true, width: 22 },
    fill: { show: true, includeDate: true },
    wm:   { show: true, useSchool: true, text: '', opacity: 0.55 },
    questions: [],
    sections : [],
    opts: { fontSize: 13, showMarks: true, showInstructions: true }
  };

  /* ================================================================== *
   *  RENDER SCHEDULER  (rAF batching)
   * ================================================================== */
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;                    // already queued → nothing to do
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderPaper();
    });
  }

  /* ================================================================== *
   *  META FIELDS
   * ================================================================== */
  const META_FIELDS = [
    ['mSchool',  'school'],
    ['mExam',    'exam'],
    ['mCls',     'cls'],
    ['mSubject', 'subject'],
    ['mTime',    'time'],
    ['mMax',     'maxMarks']
  ];
  META_FIELDS.forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.value = state.meta[key];
    el.addEventListener('input', () => {
      state.meta[key] = el.value;
      scheduleRender();
    });
  });

  dom.mInst.value = state.meta.instructions;
  dom.mInst.addEventListener('input', () => {
    state.meta.instructions = dom.mInst.value;
    scheduleRender();
  });

  /* ================================================================== *
   *  OPTIONS WIRING
   * ================================================================== */
  $('#showInst').addEventListener('change', e => {
    state.opts.showInstructions = e.target.checked;
    scheduleRender();
  });
  $('#showMarks').addEventListener('change', e => {
    state.opts.showMarks = e.target.checked;
    scheduleRender();
  });
  $('#fontSize').addEventListener('input', e => {
    state.opts.fontSize = parseFloat(e.target.value);
    dom.fsVal.textContent = state.opts.fontSize;
    scheduleRender();
  });

  /* ================================================================== *
   *  STUDENT-DETAILS WIRING
   * ================================================================== */
  $('#showFill').addEventListener('change', e => {
    state.fill.show = e.target.checked;
    scheduleRender();
  });
  $('#fillDate').addEventListener('change', e => {
    state.fill.includeDate = e.target.checked;
    scheduleRender();
  });

  /* ================================================================== *
   *  WATERMARK WIRING
   * ================================================================== */
  $('#wmShow').addEventListener('change', e => {
    state.wm.show = e.target.checked;
    scheduleRender();
  });
  $('#wmUseSchool').addEventListener('change', e => {
    state.wm.useSchool = e.target.checked;
    scheduleRender();
  });
  $('#wmText').addEventListener('input', e => {
    state.wm.text = e.target.value;
    scheduleRender();
  });
  $('#wmOpacity').addEventListener('input', e => {
    state.wm.opacity = parseFloat(e.target.value) / 100;
    dom.wmOpVal.textContent = e.target.value;
    scheduleRender();
  });

  /* ================================================================== *
   *  LOGO WIRING
   * ================================================================== */
  $('#logoShow').addEventListener('change', e => {
    state.logo.show = e.target.checked;
    scheduleRender();
  });
  $('#logoWidth').addEventListener('input', e => {
    state.logo.width = parseFloat(e.target.value);
    dom.logoWVal.textContent = e.target.value;
    scheduleRender();
  });
  $('#logoReset').addEventListener('click', () => {
    state.logo.src = '';
    dom.logoFile.value = '';
    scheduleRender();
  });
  dom.logoFile.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      state.logo.src = ev.target.result;
      scheduleRender();
    };
    r.readAsDataURL(f);
  });

  /* ================================================================== *
   *  DELIMITED-TEXT PARSING
   * ================================================================== */
  function parseDelimited(text) {
    const delim = text.indexOf('\t') > -1 ? '\t' : ',';
    const rows = [];
    let cur = [], field = '', inQ = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { cur.push(field); field = ''; }
        else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    cur.push(field);
    rows.push(cur);
    return rows;
  }

  /* ================================================================== *
   *  COLUMN DETECTION
   * ================================================================== */
  function guessCols(rows) {
    const nCols = Math.max(...rows.map(r => r.length));
    const stats = [];
    for (let c = 0; c < nCols; c++) {
      let numCount = 0, lenSum = 0, cnt = 0;
      rows.forEach(r => {
        const v = String(r[c] == null ? '' : r[c]).trim();
        if (v === '') return;
        cnt++; lenSum += v.length;
        if (/^\d+[\.\)]?$/.test(v)) numCount++;
      });
      stats.push({ c, cnt, avg: cnt ? lenSum / cnt : 0, numRatio: cnt ? numCount / cnt : 0 });
    }
    if (!stats.length) return { q: 0, t: 1, m: -1, s: -1 };

    const qCol = stats.find(s => s.numRatio > 0.7 && s.avg < 6);
    const sorted = stats.slice().sort((a, b) => b.avg - a.avg);
    const tCol = sorted[0] || stats[0];
    const mCol = stats.find(s => (!qCol || s.c !== qCol.c) && s.c !== tCol.c &&
                                  s.numRatio > 0.6 && s.avg < 6);
    return { q: qCol ? qCol.c : 0, t: tCol.c, m: mCol ? mCol.c : -1, s: -1 };
  }

  /* ================================================================== *
   *  BUILD QUESTION ARRAY FROM ROWS
   * ================================================================== */
  function buildQuestions(rows) {
    rows = (rows || []).map(r => (r || []).map(c => c == null ? '' : String(c)));
    rows = rows.filter(r => r.join('').trim() !== '');
    if (!rows.length) return [];

    let hIdx = -1, C = { q: -1, t: -1, m: -1, s: -1 };
    const lim = Math.min(rows.length, 10);
    for (let i = 0; i < lim; i++) {
      const low = rows[i].map(c => c.trim().toLowerCase());
      const q = low.findIndex(c => /^(q\s*\.?\s*no\.?|qno|q\.no\.?|ques\.?\s*no\.?|question\s*no\.?|question\s*number|s\.?\s*no\.?|sl\.?\s*no\.?|q)$/.test(c));
      const t = low.findIndex(c => /^(question|questions|question\s*text|text|content|question\s*description|description)$/.test(c));
      const m = low.findIndex(c => /^(marks?|max\.?\s*marks?|mark)$/.test(c));
      const s = low.findIndex(c => /^(section|sec\.?|section\s*name)$/.test(c));
      if (q > -1 && t > -1 && q !== t) { hIdx = i; C = { q, t, m, s }; break; }
    }

    let data;
    if (hIdx > -1) data = rows.slice(hIdx + 1);
    else { data = rows; C = guessCols(rows); }

    const out = [];
    data.forEach(r => {
      const qRaw = String(r[C.q] == null ? '' : r[C.q]).trim();
      const tRaw = String(r[C.t] == null ? '' : r[C.t]).trim();
      if (!tRaw) return;
      const digits = qRaw.replace(/[^\d]/g, '');
      if (!digits) return;
      const marks = C.m > -1 ? String(r[C.m] == null ? '' : r[C.m]).trim().replace(/[^\d.]/g, '') : '';
      const sec   = C.s > -1 ? String(r[C.s] == null ? '' : r[C.s]).trim() : '';
      out.push({ no: parseInt(digits, 10), text: tRaw, marks, section: sec });
    });

    out.sort((a, b) => a.no - b.no);
    return out;
  }

  /* ================================================================== *
   *  SECTIONS  —  auto-detect
   * ================================================================== */
  function autoDetect() {
    const qs = state.questions;
    if (!qs.length) { state.sections = []; renderSections(); return; }

    const groups = [];
    qs.forEach(q => {
      const key = (q.section || '') + '|' + (q.marks || '');
      const last = groups[groups.length - 1];
      if (last && last.key === key && q.no === last.to + 1) last.to = q.no;
      else groups.push({ key, from: q.no, to: q.no, marks: q.marks, letter: q.section || '' });
    });

    state.sections = groups.map((g, i) => {
      const count = g.to - g.from + 1;
      const letter = g.letter || String.fromCharCode(65 + i);
      const mk = g.marks || '';
      const isFirst = i === 0, isLast = i === groups.length - 1;
      let noun = 'questions';
      if (isFirst && Number(mk) === 1) noun = 'multiple choice questions';
      else if (isLast && Number(mk) === 4) noun = 'case study based questions';

      let desc = `Section ${letter} consists of ${count} ${noun}`;
      if (mk) desc += ` of ${mk} mark${Number(mk) === 1 ? '' : 's'} each`;
      desc += '.';

      return {
        id: uid(), name: letter, from: g.from, to: g.to,
        marks: String(mk), desc, grid: isFirst
      };
    });

    renderSections();
  }

  /* ================================================================== *
   *  SECTIONS  —  sidebar list
   * ================================================================== */
  function renderSections() {
    const wrap = dom.sectionsList;
    if (!state.sections.length) {
      wrap.innerHTML = '<p class="hint">No sections yet. Load question data and press <b>Auto-detect</b>, or add one manually.</p>';
      return;
    }
    const parts = [];
    state.sections.forEach(s => {
      parts.push(
        '<div class="sec-card" data-id="' + s.id + '">' +
          '<div class="sec-card-head">' +
            '<span class="chip">' + (esc(s.name) || '?') + '</span>' +
            '<input class="sec-name" data-f="desc" value="' + esc(s.desc) + '" title="Section description">' +
            '<button class="icon-btn" data-act="del" title="Remove section">✕</button>' +
          '</div>' +
          '<div class="row">' +
            '<label>Section name<input data-f="name" value="' + esc(s.name) + '"></label>' +
            '<label>From Q<input data-f="from" type="number" value="' + esc(s.from) + '"></label>' +
            '<label>To Q<input data-f="to" type="number" value="' + esc(s.to) + '"></label>' +
            '<label>Marks<input data-f="marks" placeholder="auto" value="' + esc(s.marks) + '"></label>' +
          '</div>' +
          '<label class="chk"><input type="checkbox" data-f="grid"' + (s.grid ? ' checked' : '') + '> Two-column option layout</label>' +
        '</div>'
      );
    });
    wrap.innerHTML = parts.join('');
  }

  dom.sectionsList.addEventListener('input', e => {
    const inp = e.target.closest('[data-f]');
    if (!inp) return;
    const card = e.target.closest('.sec-card');
    const sec = state.sections.find(s => s.id === card.dataset.id);
    if (!sec) return;
    const f = inp.dataset.f;
    sec[f] = inp.type === 'checkbox' ? inp.checked : inp.value;
    scheduleRender();
  });

  dom.sectionsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-act="del"]');
    if (!btn) return;
    const card = e.target.closest('.sec-card');
    state.sections = state.sections.filter(s => s.id !== card.dataset.id);
    renderSections();
    scheduleRender();
  });

  $('#btnAuto').addEventListener('click', () => {
    autoDetect();
    scheduleRender();
  });

  $('#btnAddSec').addEventListener('click', () => {
    const last = state.sections[state.sections.length - 1];
    const lastQ = state.questions[state.questions.length - 1];
    const from = last ? Number(last.to) + 1 : 1;
    const to   = lastQ ? Math.min(from + 4, lastQ.no) : from + 4;
    const letter = String.fromCharCode(65 + state.sections.length);
    state.sections.push({
      id: uid(), name: letter, from, to, marks: '', grid: false,
      desc: `Section ${letter} consists of ${to - from + 1} questions.`
    });
    renderSections();
    scheduleRender();
  });

  /* ================================================================== *
   *  QUESTION-BODY RENDERING  (memoised)
   * ================================================================== */
  const bodyCache = new Map();
  const BODY_CACHE_MAX = 500;

  function splitChoice(text) {
    let s = String(text);
    s = s.replace(/\|\|OR\|\|/gi, '\n@@OR@@\n');
    s = s.replace(/(^|\n)[ \t]*OR[ \t]*(\n|$)/g, '\n@@OR@@\n');
    s = s.replace(/[ \t]+OR[ \t]+/g, '\n@@OR@@\n');
    return s.split('@@OR@@').map(x => x.trim()).filter(Boolean);
  }

  const OPT_RE = /^\(?([a-dA-D])[\).]\s*(.*)$/;

  function expandLines(seg) {
    const lines = seg.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    lines.forEach(l => {
      const startsWithOpt = OPT_RE.test(l);
      const matches = l.match(/(?:^|\s)\(?[a-dA-D][\).]\s/g);
      if (!startsWithOpt && matches && matches.length >= 3) {
        l.split(/(?=\s*\(?[a-dA-D][\).]\s)/).map(x => x.trim()).filter(Boolean)
         .forEach(p => out.push(p));
      } else {
        out.push(l);
      }
    });
    return out;
  }

  function renderSegment(seg, useGrid) {
    const lines = expandLines(seg);
    const optIdx = lines.map((l, i) => OPT_RE.test(l) ? i : -1).filter(i => i > -1);

    if (useGrid && optIdx.length === 4 && optIdx[0] > 0) {
      const stem = lines.slice(0, optIdx[0]);
      const opts = lines.slice(optIdx[0], optIdx[0] + 4);
      const rest = lines.slice(optIdx[0] + 4);
      let h = '';
      if (stem.length) h += '<div class="q-line">' + stem.map(esc).join('<br>') + '</div>';
      h += '<div class="q-opts">' + opts.map(o => {
        const m = o.match(OPT_RE);
        return '<div class="q-opt"><span class="k">' + esc(m[1]) + ')</span><span>' + esc(m[2]) + '</span></div>';
      }).join('') + '</div>';
      if (rest.length) h += '<div class="q-line">' + rest.map(esc).join('<br>') + '</div>';
      return h;
    }
    return lines.map(l => '<div class="q-line">' + esc(l) + '</div>').join('');
  }

  function buildBody(text, useGrid) {
    const segs = splitChoice(text);
    const parts = [];
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) parts.push('<div class="q-or">OR</div>');
      parts.push(renderSegment(segs[i], useGrid));
    }
    return parts.join('');
  }

  function renderBody(text, useGrid) {
    const key = (useGrid ? '1|' : '0|') + text;
    let html = bodyCache.get(key);
    if (html === undefined) {
      html = buildBody(text, useGrid);
      if (bodyCache.size >= BODY_CACHE_MAX) bodyCache.clear();
      bodyCache.set(key, html);
    }
    return html;
  }

  /* ================================================================== *
   *  STUDENT-DETAILS RENDER
   * ================================================================== */
  function renderStudentFill() {
    if (!state.fill.show) return '';
    let h = '<div class="p-fill">';
    h += '<div class="f-item name"><span class="f-label">Name:</span><span class="f-line"></span></div>';
    h += '<div class="f-item div"><span class="f-label">Div:</span><span class="f-line"></span></div>';
    h += '<div class="f-item roll"><span class="f-label">Roll No.:</span><span class="f-line"></span></div>';
    if (state.fill.includeDate) {
      h += '<div class="f-item date"><span class="f-label">Date:</span><span class="f-line" style="flex:0 0 40%"></span></div>';
    }
    h += '</div>';
    return h;
  }

  /* ================================================================== *
   *  WATERMARK RENDER  (dirty-checked)
   * ================================================================== */
  const wmCache = { show: null, text: null, opacity: null };

  function renderWatermark() {
    const el = dom.watermark;
    if (!el) return;

    if (!state.wm.show) {
      if (wmCache.show !== false) {
        el.style.display = 'none';
        el.textContent = '';
        wmCache.show = false;
        wmCache.text = '';
      }
      return;
    }

    const text = (state.wm.useSchool ? state.meta.school : state.wm.text) || '';
    const trimmed = text.trim();

    if (!trimmed) {
      if (wmCache.text !== '') {
        el.style.display = 'none';
        el.textContent = '';
        wmCache.text = '';
        wmCache.show = true;
      }
      return;
    }

    const opacity = state.wm.opacity;
    if (wmCache.show === true && wmCache.text === trimmed && wmCache.opacity === opacity) return;

    /* scale font down for longer names so it never spills out of the sheet */
    const len = trimmed.length;
    let em = 4.4;
    if (len > 34) em = 2.5;
    else if (len > 26) em = 3.1;
    else if (len > 20) em = 3.7;
    else if (len > 14) em = 4.0;

    el.style.display = 'block';
    el.style.fontSize = em + 'em';
    el.style.opacity = opacity;
    if (wmCache.text !== trimmed) el.textContent = trimmed;

    wmCache.show = true;
    wmCache.text = trimmed;
    wmCache.opacity = opacity;
  }

  /* ================================================================== *
   *  BINARY SEARCH  —  first index with questions[i].no >= no
   * ================================================================== */
  function lowerBoundByNo(arr, no) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].no < no) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /* ================================================================== *
   *  PAPER RENDER
   * ================================================================== */
  function renderPaper() {
    const m = state.meta;
    const sheet = dom.sheet;

    sheetHost.style.fontSize = state.opts.fontSize + 'px';

    renderWatermark();

    const h = [];

    /* ---------- header with LEFT-aligned logo ---------- */
    if (state.logo.show) {
      const src = state.logo.src || DEFAULT_LOGO;
      h.push('<div class="p-head with-logo" style="--logo-w:' + state.logo.width + 'mm">');
      h.push('<img class="p-logo" src="' + src + '" alt="School Logo">');
    } else {
      h.push('<div class="p-head">');
    }
    if (m.school) h.push('<div class="p-school">' + esc(m.school) + '</div>');
    if (m.exam)   h.push('<div class="p-exam">'   + esc(m.exam)   + '</div>');
    h.push('<div class="p-meta"><span>Class: '   + esc(m.cls)     + '</span><span>Subject: '   + esc(m.subject) + '</span></div>');
    h.push('<div class="p-meta"><span>Time: '    + esc(m.time)    + '</span><span>Max. Marks: ' + esc(m.maxMarks) + '</span></div>');
    h.push('</div>');

    /* ---------- student fill-in row ---------- */
    h.push(renderStudentFill());

    /* ---------- general instructions ---------- */
    if (state.opts.showInstructions && String(m.instructions).trim()) {
      const lines = String(m.instructions).split('\n')
        .map(s => s.trim().replace(/^\d+[\.\)]\s*/, ''))
        .filter(Boolean);
      h.push('<div class="p-inst"><div class="p-inst-title">General Instructions:</div><ol>');
      lines.forEach(l => h.push('<li>' + esc(l) + '</li>'));
      h.push('</ol></div>');
    }

    /* ---------- sections ---------- */
    if (!state.sections.length) {
      h.push('<div class="p-empty">— No sections defined. Load question data and click “Auto-detect”. —</div>');
    }

    const qs = state.questions;
    const showMkCol = state.opts.showMarks;

    state.sections.forEach(sec => {
      const from = Number(sec.from), to = Number(sec.to);
      const totalCols = showMkCol ? 3 : 2;

      h.push('<table class="q-table ' + (showMkCol ? 'with-marks' : 'no-marks') + '">');
      h.push('<colgroup><col class="c-no"><col class="c-q">');
      if (showMkCol) h.push('<col class="c-mk">');
      h.push('</colgroup>');

      h.push('<thead><tr>');
      h.push('<th class="t-sec" colspan="2">SECTION ' + esc(String(sec.name).toUpperCase()) + '</th>');
      if (showMkCol) h.push('<th class="t-mk-h">Marks</th>');
      h.push('</tr>');
      if (sec.desc) {
        h.push('<tr><td class="t-desc" colspan="' + totalCols + '">' + esc(sec.desc) + '</td></tr>');
      }
      h.push('</thead><tbody>');

      // Binary-search the slice of questions that fall in [from, to]
      let i = lowerBoundByNo(qs, from);
      let emitted = 0;

      while (i < qs.length && qs[i].no <= to) {
        const q = qs[i];
        const mk = String(sec.marks).trim() !== '' ? sec.marks : (q.marks || '');
        h.push('<tr>');
        h.push('<td class="t-no">' + esc(q.no) + '.</td>');
        h.push('<td class="t-q">'  + renderBody(q.text, !!sec.grid) + '</td>');
        if (showMkCol) h.push('<td class="t-mk">' + esc(mk) + '</td>');
        h.push('</tr>');
        emitted++;
        i++;
      }

      if (!emitted) {
        h.push('<tr><td class="p-empty" colspan="' + totalCols + '">— no questions in range ' +
               esc(sec.from) + '–' + esc(sec.to) + ' —</td></tr>');
      }

      h.push('</tbody></table>');
    });

    sheet.innerHTML = h.join('');
  }

  /* ================================================================== *
   *  DATA LOADING
   * ================================================================== */
  function setQuestions(qs, keepSections) {
    // Defensive sort guarantees the binary search invariant
    state.questions = qs.slice().sort((a, b) => a.no - b.no);
    dom.status.textContent = qs.length ? qs.length + ' questions loaded' : 'No data loaded';
    if (!keepSections) autoDetect();
    renderSections();
    scheduleRender();
  }

  dom.fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (typeof XLSX === 'undefined') {
      alert('Excel library not available (offline?). Please paste your data into the text box instead.');
      return;
    }
    const reader = new FileReader();
    const isCSV = /\.csv$/i.test(f.name);

    reader.onload = ev => {
      try {
        const wb = isCSV
          ? XLSX.read(ev.target.result, { type: 'string' })
          : XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
        const qs = buildQuestions(rows);
        if (!qs.length) {
          alert('No questions found. Make sure the sheet has Qno and Question columns.');
          return;
        }
        setQuestions(qs, false);
      } catch (err) {
        console.error(err);
        alert('Could not read the file: ' + err.message);
      }
    };

    if (isCSV) reader.readAsText(f);
    else reader.readAsArrayBuffer(f);
  });

  $('#btnPaste').addEventListener('click', () => {
    const txt = dom.pasteArea.value.trim();
    if (!txt) { alert('Paste some rows first.'); return; }
    const qs = buildQuestions(parseDelimited(txt));
    if (!qs.length) {
      alert('Could not detect questions. Expected columns: Qno, Question, Marks.');
      return;
    }
    setQuestions(qs, false);
  });

  $('#btnClear').addEventListener('click', () => {
    dom.pasteArea.value = '';
    dom.fileInput.value = '';
    state.questions = [];
    state.sections = [];
    dom.status.textContent = 'No data loaded';
    renderSections();
    scheduleRender();
  });

  /* ================================================================== *
   *  EXPORT  —  Print  &  Download PDF
   * ================================================================== */
  dom.btnPrint.addEventListener('click', () => window.print());

  dom.btnDownload.addEventListener('click', function () {
    if (typeof html2pdf === 'undefined') {
      alert('PDF library not loaded (offline?). Use “Print / Save PDF” instead.');
      return;
    }
    if (!state.sections.length) {
      alert('Nothing to export yet. Load questions and define sections first.');
      return;
    }

    const btn = this;
    const sheet = document.querySelector('.sheet');

    // Filename derived from the Examination field
    const raw  = (state.meta.exam || state.meta.subject || 'question-paper');
    const safe = raw.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80);

    const opts = {
      margin: 0,
      filename: (safe || 'question-paper') + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,                    // 2× DPI for crisp text
        useCORS: true,
        backgroundColor: '#ffffff',
        // strip the on-screen drop-shadow so it doesn't bake into the PDF
        onclone: doc => {
          const s = doc.querySelector('.sheet');
          if (s) s.style.boxShadow = 'none';
        }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // existing @media print break rules drive pagination
      pagebreak: { mode: ['css', 'legacy'] }
    };

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = '⏳ Generating…';

    html2pdf()
      .set(opts)
      .from(sheet)
      .save()
      .then(() => {
        btn.disabled = false;
        btn.textContent = originalLabel;
      })
      .catch(err => {
        console.error(err);
        btn.disabled = false;
        btn.textContent = originalLabel;
        alert('PDF generation failed: ' + err.message);
      });
  });

  /* ================================================================== *
   *  INIT
   * ================================================================== */
  dom.wmOpVal.textContent = Math.round(state.wm.opacity * 100);
  renderSections();
  renderPaper();          // synchronous first paint — no rAF delay
})();