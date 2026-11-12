(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage-wrap');
  const empty = $('#empty');
  const countEl = $('#count');
  const fitBtn = $('#fit-btn');
  const hintEl = $('#hint');
  const sizeInput = $('#size');
  const sizeVal = $('#size-val');
  const paletteEl = $('#palette');
  const spotOpts = $('#spot-opts');
  const toolsEl = $('#tools');
  const fileInput = $('#file-input');
  const modal = $('#modal');
  const preview = $('#preview');
  const downloadLink = $('#download-link');

  // State
  let img = null;
  let items = [];       // {t:'strip'|'cove'|'spot', x,y, ...}
  let hist = [];
  let tool = 'strip';
  let selected = null;
  let view = { s: 1, x: 0, y: 0 };
  let dpr = 1;
  let pens = {
    strip: { c: '#ffffff', w: 3 },
    cove:  { c: '#f5b82e', w: 3 }
  };
  let spotSet = { k: 5, sh: 'round', ty: 'single', an: 0 };
  let glow = 0;
  let ruler = { on: false, placed: false, x: 0, y: 0, a: 0, L: 300 };
  let drawing = null;   // current stroke being drawn
  let pointers = new Map();
  let lastPinch = null;
  let clearArmed = false;
  let clearTimer = 0;
  let DB = null;

  const palette = [
    '#ffffff', '#fff0b8', '#f5b82e', '#ff7a1a', '#ff3b3b',
    '#000000', '#a35bff', '#3d8bff', '#3ddc6a'
  ];

  // ---------- IndexedDB persistence ----------
  function dbOpen(cb) {
    try {
      const req = indexedDB.open('kell-lighting', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { DB = req.result; if (cb) cb(); };
      req.onerror = () => {};
    } catch (e) {}
  }
  function dbPut(k, v) {
    try {
      if (DB) DB.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    } catch (e) {}
  }
  function dbGet(k, cb) {
    try {
      if (!DB) return cb(null);
      const r = DB.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => cb(r.result || null);
      r.onerror = () => cb(null);
    } catch (e) { cb(null); }
  }
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!img) return;
      dbPut('state', {
        items, pens, spotSet, glow,
        stripW: pens.strip.w, coveW: pens.cove.w
      });
    }, 600);
  }

  // ---------- Helpers ----------
  function snap() {
    hist.push(JSON.stringify(items));
    if (hist.length > 50) hist.shift();
  }

  function updateCounts() {
    let s = 0, p = 0;
    items.forEach(it => {
      if (it.t === 'strip' || it.t === 'cove') s++;
      else if (it.t === 'spot') p++;
    });
    $('#c-strip').textContent = s;
    $('#c-spot').textContent = p;
  }

  function setHint() {
    const msgs = {
      strip: 'Draw continuous strip lighting lines',
      cove: 'Draw cove / linear accent lighting',
      spot: 'Tap to place spotlights',
      erase: 'Drag over items to erase them',
      edit: 'Tap an item to select, then adjust',
      move: 'Drag to pan the photo',
      glow: 'Drag up/down to adjust overall glow',
      ruler: 'Drag to place a measuring ruler',
      undo: '',
      clear: ''
    };
    hintEl.textContent = msgs[tool] || '';
  }

  function currentColor() {
    if (tool === 'strip' || tool === 'cove') return pens[tool].c;
    if (tool === 'spot') return '#ffffff';
    return '#ffffff';
  }

  function setActiveTool(name) {
    tool = name;
    toolsEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
    spotOpts.classList.toggle('visible', name === 'spot' || (name === 'edit' && selected != null && items[selected]?.t === 'spot'));
    setHint();
    draw();
  }

  // ---------- Drawing ----------
  function resize() {
    const rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    if (img) fit();
    draw();
  }

  function fit() {
    if (!img) return;
    const rect = stage.getBoundingClientRect();
    const sx = rect.width / img.width;
    const sy = rect.height / img.height;
    view.s = Math.min(sx, sy) * 0.96;
    view.x = (rect.width - img.width * view.s) / 2;
    view.y = (rect.height - img.height * view.s) / 2;
  }

  function toImage(px, py) {
    return {
      x: (px - view.x) / view.s,
      y: (py - view.y) / view.s
    };
  }

  function paintItems(c, scale) {
    // glow overlay first
    if (glow > 0.05) {
      c.save();
      c.globalAlpha = Math.min(0.55, glow * 0.45);
      c.fillStyle = '#fff8e0';
      c.fillRect(0, 0, img.width, img.height);
      c.restore();
    }

    items.forEach((it, idx) => {
      const isSel = selected === idx;
      if (it.t === 'strip' || it.t === 'cove') {
        if (!it.pts || it.pts.length < 2) return;
        c.beginPath();
        c.moveTo(it.pts[0].x, it.pts[0].y);
        for (let i = 1; i < it.pts.length; i++) {
          c.lineTo(it.pts[i].x, it.pts[i].y);
        }
        c.strokeStyle = it.c;
        c.lineWidth = Math.max(1.5, (it.w || 3) * img.width * 0.0018);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.globalAlpha = isSel ? 1 : 0.95;
        c.stroke();
        if (isSel) {
          c.strokeStyle = '#0a6ebd';
          c.lineWidth = c.lineWidth + 3;
          c.globalAlpha = 0.4;
          c.stroke();
        }
        c.globalAlpha = 1;
      } else if (it.t === 'spot') {
        const r = Math.max(6, (it.k || 5) * img.width * 0.0016);
        const heads = [];
        if (it.ty === 'double') {
          const a = (it.an || 0) * Math.PI / 180;
          const d = r * 1.1;
          heads.push(
            { x: it.x - Math.cos(a) * d, y: it.y - Math.sin(a) * d },
            { x: it.x + Math.cos(a) * d, y: it.y + Math.sin(a) * d }
          );
        } else {
          heads.push({ x: it.x, y: it.y });
        }
        heads.forEach(h => {
          c.beginPath();
          if (it.sh === 'square') {
            c.save();
            c.translate(h.x, h.y);
            c.rotate((it.an || 0) * Math.PI / 180);
            c.rect(-r, -r, r * 2, r * 2);
            c.restore();
          } else {
            c.arc(h.x, h.y, r, 0, Math.PI * 2);
          }
          c.fillStyle = it.c || '#ffffff';
          c.globalAlpha = 0.92;
          c.fill();
          if (isSel) {
            c.strokeStyle = '#0a6ebd';
            c.lineWidth = 3;
            c.globalAlpha = 0.7;
            c.stroke();
          }
          // soft glow
          c.beginPath();
          c.arc(h.x, h.y, r * 2.2, 0, Math.PI * 2);
          c.fillStyle = it.c || '#ffffff';
          c.globalAlpha = 0.18;
          c.fill();
        });
        c.globalAlpha = 1;
      }
    });

    // current drawing stroke
    if (drawing && drawing.pts && drawing.pts.length > 1) {
      c.beginPath();
      c.moveTo(drawing.pts[0].x, drawing.pts[0].y);
      for (let i = 1; i < drawing.pts.length; i++) {
        c.lineTo(drawing.pts[i].x, drawing.pts[i].y);
      }
      c.strokeStyle = drawing.c;
      c.lineWidth = Math.max(1.5, drawing.w * img.width * 0.0018);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.stroke();
    }

    // ruler
    if (ruler.on && ruler.placed) {
      const a = ruler.a * Math.PI / 180;
      const x2 = ruler.x + Math.cos(a) * ruler.L;
      const y2 = ruler.y + Math.sin(a) * ruler.L;
      c.save();
      c.strokeStyle = '#ff3b3b';
      c.lineWidth = Math.max(2, img.width * 0.003);
      c.setLineDash([8, 6]);
      c.beginPath();
      c.moveTo(ruler.x, ruler.y);
      c.lineTo(x2, y2);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ff3b3b';
      c.beginPath();
      c.arc(ruler.x, ruler.y, 6, 0, Math.PI * 2);
      c.arc(x2, y2, 6, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#e8eaed';
    ctx.fillRect(0, 0, w, h);

    if (!img) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(view.x, view.y);
    ctx.scale(view.s, view.s);

    ctx.drawImage(img, 0, 0);
    paintItems(ctx, 1);

    ctx.restore();
  }

  // ---------- Hit testing ----------
  function hitTest(ix, iy) {
    // reverse order so top items win
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.t === 'strip' || it.t === 'cove') {
        if (!it.pts) continue;
        const thresh = Math.max(8, (it.w || 3) * img.width * 0.004);
        for (let j = 1; j < it.pts.length; j++) {
          const a = it.pts[j - 1], b = it.pts[j];
          const d = distToSegment(ix, iy, a.x, a.y, b.x, b.y);
          if (d < thresh) return i;
        }
      } else if (it.t === 'spot') {
        const r = Math.max(10, (it.k || 5) * img.width * 0.003);
        if (it.ty === 'double') {
          const a = (it.an || 0) * Math.PI / 180;
          const d = r * 1.1;
          const h1 = { x: it.x - Math.cos(a) * d, y: it.y - Math.sin(a) * d };
          const h2 = { x: it.x + Math.cos(a) * d, y: it.y + Math.sin(a) * d };
          if (Math.hypot(ix - h1.x, iy - h1.y) < r * 1.4 ||
              Math.hypot(ix - h2.x, iy - h2.y) < r * 1.4) return i;
        } else if (Math.hypot(ix - it.x, iy - it.y) < r * 1.5) {
          return i;
        }
      }
    }
    return null;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ---------- Pointer handling ----------
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function onPointerDown(e) {
    if (!img) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // pinch start
      const pts = Array.from(pointers.values());
      lastPinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2
      };
      drawing = null;
      return;
    }

    const p = getPos(e);
    const ip = toImage(p.x, p.y);

    if (tool === 'move') {
      drawing = { mode: 'pan', lx: p.x, ly: p.y };
      return;
    }

    if (tool === 'glow') {
      drawing = { mode: 'glow', ly: p.y, start: glow };
      return;
    }

    if (tool === 'ruler') {
      ruler.on = true;
      ruler.placed = true;
      ruler.x = ip.x;
      ruler.y = ip.y;
      ruler.a = 0;
      ruler.L = Math.max(img.width, img.height) * 0.25;
      drawing = { mode: 'ruler', lx: ip.x, ly: ip.y };
      draw();
      return;
    }

    if (tool === 'erase') {
      const idx = hitTest(ip.x, ip.y);
      if (idx != null) {
        snap();
        items.splice(idx, 1);
        selected = null;
        updateCounts();
        saveSoon();
        draw();
      }
      drawing = { mode: 'erase' };
      return;
    }

    if (tool === 'edit') {
      const idx = hitTest(ip.x, ip.y);
      selected = idx;
      if (idx != null) {
        drawing = { mode: 'drag', idx, ox: ip.x - (items[idx].x || items[idx].pts?.[0]?.x || 0), oy: ip.y - (items[idx].y || items[idx].pts?.[0]?.y || 0) };
      }
      spotOpts.classList.toggle('visible', idx != null && items[idx]?.t === 'spot');
      draw();
      return;
    }

    if (tool === 'spot') {
      snap();
      items.push({
        t: 'spot',
        x: ip.x,
        y: ip.y,
        k: spotSet.k,
        sh: spotSet.sh,
        ty: spotSet.ty,
        an: spotSet.an,
        c: '#ffffff'
      });
      selected = items.length - 1;
      updateCounts();
      saveSoon();
      draw();
      return;
    }

    if (tool === 'strip' || tool === 'cove') {
      drawing = {
        mode: 'draw',
        t: tool,
        c: pens[tool].c,
        w: pens[tool].w,
        pts: [ip]
      };
    }
  }

  function onPointerMove(e) {
    if (!img) return;
    e.preventDefault();
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.size === 2 && lastPinch) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const scale = dist / lastPinch.dist;
      const rect = canvas.getBoundingClientRect();
      const mx = midX - rect.left;
      const my = midY - rect.top;
      const ix = (mx - view.x) / view.s;
      const iy = (my - view.y) / view.s;
      view.s = Math.max(0.15, Math.min(8, view.s * scale));
      view.x = mx - ix * view.s;
      view.y = my - iy * view.s;
      lastPinch = { dist, midX, midY };
      draw();
      return;
    }

    if (!drawing) return;
    const p = getPos(e);
    const ip = toImage(p.x, p.y);

    if (drawing.mode === 'pan') {
      view.x += p.x - drawing.lx;
      view.y += p.y - drawing.ly;
      drawing.lx = p.x;
      drawing.ly = p.y;
      draw();
      return;
    }

    if (drawing.mode === 'glow') {
      const dy = drawing.ly - p.y;
      glow = Math.max(0, Math.min(1, drawing.start + dy / 180));
      draw();
      return;
    }

    if (drawing.mode === 'ruler') {
      const dx = ip.x - drawing.lx;
      const dy = ip.y - drawing.ly;
      ruler.L = Math.max(20, Math.hypot(dx, dy));
      ruler.a = Math.atan2(dy, dx) * 180 / Math.PI;
      draw();
      return;
    }

    if (drawing.mode === 'erase') {
      const idx = hitTest(ip.x, ip.y);
      if (idx != null) {
        snap();
        items.splice(idx, 1);
        selected = null;
        updateCounts();
        saveSoon();
        draw();
      }
      return;
    }

    if (drawing.mode === 'drag' && drawing.idx != null) {
      const it = items[drawing.idx];
      if (it.t === 'spot') {
        it.x = ip.x;
        it.y = ip.y;
      } else if (it.pts) {
        const dx = ip.x - (it.pts[0].x + drawing.ox);
        const dy = ip.y - (it.pts[0].y + drawing.oy);
        // simple: move whole path relative
        const ox = it.pts[0].x, oy = it.pts[0].y;
        it.pts.forEach(pt => {
          pt.x += ip.x - ox - drawing.ox;
          pt.y += ip.y - oy - drawing.oy;
        });
        drawing.ox = ip.x - it.pts[0].x;
        drawing.oy = ip.y - it.pts[0].y;
      }
      draw();
      return;
    }

    if (drawing.mode === 'draw') {
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(ip.x - last.x, ip.y - last.y) > 2) {
        drawing.pts.push(ip);
        draw();
      }
    }
  }

  function onPointerUp(e) {
    e.preventDefault();
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinch = null;

    if (drawing && drawing.mode === 'draw' && drawing.pts.length > 1) {
      snap();
      items.push({
        t: drawing.t,
        c: drawing.c,
        w: drawing.w,
        pts: drawing.pts
      });
      selected = items.length - 1;
      updateCounts();
      saveSoon();
    }
    if (drawing && (drawing.mode === 'drag' || drawing.mode === 'glow' || drawing.mode === 'ruler')) {
      saveSoon();
    }
    drawing = null;
    draw();
  }

  // ---------- Photo loading ----------
  function loadImage(file) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      img = im;
      items = [];
      hist = [];
      selected = null;
      glow = 0;
      empty.classList.add('hidden');
      countEl.style.display = 'block';
      fitBtn.style.display = 'block';
      fit();
      updateCounts();
      draw();
      // persist photo
      file.arrayBuffer().then(buf => {
        dbPut('photo', new Blob([buf], { type: file.type || 'image/jpeg' }));
      }).catch(() => {});
      saveSoon();
    };
    im.onerror = () => URL.revokeObjectURL(url);
    im.src = url;
  }

  function restore() {
    dbGet('photo', blob => {
      if (!blob || img) return;
      dbGet('state', st => {
        const im = new Image();
        im.onload = () => {
          if (img) return;
          img = im;
          if (st) {
            items = st.items || [];
            if (st.pens) pens = st.pens;
            if (st.spotSet) spotSet = st.spotSet;
            if (typeof st.glow === 'number') glow = st.glow;
          }
          empty.classList.add('hidden');
          countEl.style.display = 'block';
          fitBtn.style.display = 'block';
          // update swatches
          toolsEl.querySelector('[data-tool="strip"] .swatch').style.background = pens.strip.c;
          toolsEl.querySelector('[data-tool="cove"] .swatch').style.background = pens.cove.c;
          sizeInput.value = pens.strip.w;
          sizeVal.textContent = pens.strip.w;
          fit();
          updateCounts();
          draw();
        };
        im.src = URL.createObjectURL(blob);
      });
    });
  }

  // ---------- Save / export ----------
  function exportImage() {
    if (!img) return;
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    const c = off.getContext('2d');
    c.drawImage(img, 0, 0);
    paintItems(c, 1);

    // watermark
    const fs = Math.max(14, Math.round(img.width * 0.018));
    c.save();
    c.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    c.textAlign = 'right';
    c.textBaseline = 'bottom';
    c.lineWidth = fs * 0.18;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.fillStyle = 'rgba(255,255,255,0.92)';
    const text = 'Kell Electricals · Lighting Planner';
    c.strokeText(text, img.width - fs * 0.8, img.height - fs * 0.7);
    c.fillText(text, img.width - fs * 0.8, img.height - fs * 0.7);
    c.restore();

    off.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      preview.src = url;
      downloadLink.href = url;
      modal.classList.add('open');
    }, 'image/jpeg', 0.92);
  }

  // ---------- UI wiring ----------
  function buildPalette() {
    palette.forEach(col => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = col;
      b.setAttribute('aria-label', 'Color ' + col);
      b.addEventListener('click', () => {
        paletteEl.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        if (tool === 'strip' || tool === 'cove') {
          pens[tool].c = col;
          toolsEl.querySelector(`[data-tool="${tool}"] .swatch`).style.background = col;
        } else if (tool === 'edit' && selected != null && items[selected]) {
          items[selected].c = col;
          draw();
          saveSoon();
        }
      });
      paletteEl.appendChild(b);
    });
    paletteEl.children[0].classList.add('selected');
  }

  toolsEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-tool]');
    if (!btn) return;
    const t = btn.dataset.tool;
    if (t === 'undo') {
      if (!hist.length) return;
      items = JSON.parse(hist.pop());
      selected = null;
      updateCounts();
      saveSoon();
      draw();
      return;
    }
    if (t === 'clear') {
      if (!items.length) return;
      if (clearArmed) {
        clearTimeout(clearTimer);
        clearArmed = false;
        btn.textContent = 'Clear';
        snap();
        items = [];
        selected = null;
        updateCounts();
        saveSoon();
        draw();
        return;
      }
      clearArmed = true;
      btn.textContent = 'Tap again';
      clearTimer = setTimeout(() => {
        clearArmed = false;
        btn.textContent = 'Clear';
      }, 2000);
      return;
    }
    setActiveTool(t);
  });

  sizeInput.addEventListener('input', () => {
    const v = +sizeInput.value;
    sizeVal.textContent = v;
    if (tool === 'strip' || tool === 'cove') {
      pens[tool].w = v;
    } else if (tool === 'spot') {
      spotSet.k = v + 2;
    } else if (tool === 'edit' && selected != null) {
      const it = items[selected];
      if (it.t === 'spot') it.k = v + 2;
      else it.w = v;
      draw();
      saveSoon();
    }
  });

  spotOpts.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.ty) {
      spotSet.ty = btn.dataset.ty;
      spotOpts.querySelectorAll('[data-ty]').forEach(b => b.classList.toggle('active', b === btn));
      if (selected != null && items[selected]?.t === 'spot') {
        items[selected].ty = spotSet.ty;
        draw();
        saveSoon();
      }
    }
    if (btn.dataset.sh) {
      spotSet.sh = btn.dataset.sh;
      spotOpts.querySelectorAll('[data-sh]').forEach(b => b.classList.toggle('active', b === btn));
      if (selected != null && items[selected]?.t === 'spot') {
        items[selected].sh = spotSet.sh;
        draw();
        saveSoon();
      }
    }
  });

  $('#photo-btn').onclick = () => fileInput.click();
  $('#photo-btn-2').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) loadImage(f);
    fileInput.value = '';
  };

  $('#save-btn').onclick = exportImage;
  fitBtn.onclick = () => { if (img) { fit(); draw(); } };
  $('#close-modal').onclick = () => {
    modal.classList.remove('open');
    if (preview.src) URL.revokeObjectURL(preview.src);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(stage);
  }

  // init
  buildPalette();
  setHint();
  resize();
  dbOpen(restore);
})();
