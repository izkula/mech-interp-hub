(function () {
  'use strict';
  const S = SIM, { links, nodes, roads, LW } = S;
  const $ = id => document.getElementById(id);
  const cv = $('map'), ctx = cv.getContext('2d');
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ palette
  const P = {
    ground: '#121821', block: '#171e29', lot: '#1e242e', side: '#262d39', curb: '#323a47',
    asphalt: '#2a2f38', hwy: '#2c313b', deck: '#3a4250', water: '#0a1822', water2: '#0d2130',
    white: 'rgba(225,230,238,0.55)', yellow: '#c9a23c', park: '#132319', tree: '#1c3626', tree2: '#24462f',
  };
  const CAR_COLS = ['#d9dee5', '#b7bec8', '#8d96a3', '#5d6675', '#2f394b', '#39598a', '#8f2f30', '#b8493a', '#cbb88d', '#2f5448', '#e8e9ea', '#1f2633', '#e2ad2e', '#6c7f96'];

  // ------------------------------------------------------------ view
  let W = 0, H = 0, DPR = 1, userView = false, bgDirty = true;
  const view = { z: 1, ox: 0, oy: 0 };
  const bg = document.createElement('canvas');
  let lastWheel = 0;
  // Whole city pre-rendered once at a fixed resolution; drawn scaled while the view is moving
  const cityBg = document.createElement('canvas'), CITY = { x0: -60, y0: -20, x1: 1080, y1: 690, res: 2.4 };
  let cityBgReady = false;
  function renderCityBg() {
    const saved = { z: view.z, ox: view.ox, oy: view.oy }, savedDpr = DPR;
    const w = Math.round((CITY.x1 - CITY.x0) * CITY.res), h = Math.round((CITY.y1 - CITY.y0) * CITY.res);
    DPR = 1; view.z = CITY.res; view.ox = -CITY.x0 * CITY.res; view.oy = -CITY.y0 * CITY.res;
    drawStatic(cityBg, w, h);
    DPR = savedDpr; Object.assign(view, saved);
    cityBgReady = true;
  }
  const WORLD = { x0: -20, y0: 10, x1: 1020, y1: 650 };
  function fitView() {
    const bw = WORLD.x1 - WORLD.x0, bh = WORLD.y1 - WORLD.y0;
    let z = Math.min(W / bw, H / bh);
    let cx = (WORLD.x0 + WORLD.x1) / 2, cy = (WORLD.y0 + WORLD.y1) / 2;
    if (W < 700) { z = Math.max(z, Math.min(H * 0.7 / bh, W * 2.1 / bw)); cx = 560; cy = 330; }
    view.z = z; view.ox = W / 2 - cx * z; view.oy = H / 2 - cy * z;
    clampView(); bgDirty = true;
  }
  function clampView() {
    const bw = WORLD.x1 - WORLD.x0, bh = WORLD.y1 - WORLD.y0;
    view.z = Math.max(Math.min(W / bw, H / bh), Math.min(view.z, 9));
    // when the city is narrower (or shorter) than the screen, centre it; otherwise keep it covering the screen
    if (bw * view.z <= W) view.ox = (W - bw * view.z) / 2 - WORLD.x0 * view.z;
    else view.ox = Math.min(-WORLD.x0 * view.z, Math.max(W - WORLD.x1 * view.z, view.ox));
    if (bh * view.z <= H) view.oy = (H - bh * view.z) / 2 - WORLD.y0 * view.z;
    else view.oy = Math.min(-WORLD.y0 * view.z, Math.max(H - WORLD.y1 * view.z, view.oy));
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    if (!userView) fitView(); else clampView();
    bgDirty = true;
  }
  let cam = null;
  function flyTo(wx, wy, z) {
    z = Math.max(view.z, z);
    cam = { t: 0, z0: view.z, z1: z, cx0: (W / 2 - view.ox) / view.z, cy0: (H / 2 - view.oy) / view.z, cx1: wx, cy1: wy };
    if (reduceMotion) cam.t = 1;
  }
  function stepCam(dt) {
    if (!cam) return;
    cam.t = Math.min(1, cam.t + dt / 1.1);
    const e = cam.t < 0.5 ? 2 * cam.t * cam.t : 1 - Math.pow(-2 * cam.t + 2, 2) / 2;
    const z = cam.z0 * Math.pow(cam.z1 / cam.z0, e), cx = cam.cx0 + (cam.cx1 - cam.cx0) * e, cy = cam.cy0 + (cam.cy1 - cam.cy0) * e;
    view.z = z; view.ox = W / 2 - cx * z; view.oy = H / 2 - cy * z; clampView(); bgDirty = true; userView = true;
    if (cam.t >= 1) cam = null;
  }
  const toWorld = (sx, sy) => [(sx - view.ox) / view.z, (sy - view.oy) / view.z];

  // ------------------------------------------------------------ sprites
  function sprite(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
  function radial(r, g, b, core) {
    return sprite(64, 64, (x, w) => {
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(core || 0.22, `rgba(${r},${g},${b},.5)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    });
  }
  const SPR = {
    warm: radial(255, 196, 120, 0.1), red: radial(255, 50, 40), amber: radial(255, 170, 40), green: radial(60, 230, 140),
    blue: radial(70, 120, 255), white: radial(255, 255, 255), smoke: radial(150, 155, 165, 0.4),
    cone: sprite(128, 64, (x) => {
      const gr = x.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, 'rgba(255,236,190,.95)'); gr.addColorStop(0.35, 'rgba(255,230,180,.35)'); gr.addColorStop(1, 'rgba(255,230,180,0)');
      x.fillStyle = gr; x.beginPath(); x.moveTo(0, 28); x.lineTo(128, 0); x.lineTo(128, 64); x.lineTo(0, 36); x.closePath(); x.fill();
    }),
  };

  // ------------------------------------------------------------ city dressing (static, seeded)
  const riverW = y => 540 + 7 * Math.sin(y / 47) + 3 * Math.sin(y / 13);
  const riverE = y => 652 + 6 * Math.sin(y / 61 + 2) + 2 * Math.sin(y / 17);
  const city = { bldg: [], trees: [], lots: [], boxes: [], parks: [] };
  (function genCity() {
    const r = { s: 777 }, R = () => S.rnd(r);
    const segs = roads.map(rd => {
      const A = rd.a, B = rd.b, hw = S.hw(rd.cls);
      return { ax: A.x, ay: A.y, bx: B.x, by: B.y, hw };
    });
    const segDist = (px, py, s) => {
      const dx = s.bx - s.ax, dy = s.by - s.ay, t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - s.ax - dx * t, py - s.ay - dy * t);
    };
    const clearOf = (x, y, w, h, pad) => {
      const cx = x + w / 2, cy = y + h / 2, hd = Math.hypot(w, h) / 2;
      for (const s of segs) if (segDist(cx, cy, s) < s.hw + 4 + hd * (pad || 0.95)) return false;
      if (x + w > riverW(cy) - 6 && x < riverE(cy) + 6) return false;
      return true;
    };
    const XS = [-80, 60, 200, 340, 480, 540], XE = [652, 700, 820, 940, 1080], YS = [-60, 80, 230, 350, 470, 590, 720];
    const cells = [];
    for (let a = 0; a < XS.length - 1; a++) for (let b = 0; b < YS.length - 1; b++) cells.push([XS[a], XS[a + 1], YS[b], YS[b + 1], 'W']);
    for (let a = 0; a < XE.length - 1; a++) for (let b = 0; b < YS.length - 1; b++) cells.push([XE[a], XE[a + 1], YS[b], YS[b + 1], 'E']);
    for (const [cx0, cx1, cy0, cy1, side] of cells) {
      const x0 = cx0 + 11, x1 = cx1 - 11, y0 = cy0 + 11, y1 = cy1 - 11;
      if (x1 - x0 < 12 || y1 - y0 < 12) continue;
      let kind;
      if (cy1 <= 80) kind = 'port';
      else if (cy1 <= 230) kind = side === 'W' ? 'works' : 'office';
      else if (side === 'W') kind = 'res';
      else kind = 'down';
      if (cx0 === 480 || cx0 === 652) kind = 'green';
      if (cx0 === 200 && cy0 === 470) kind = 'park';
      if (cx0 === 820 && cy0 === 350) kind = 'plaza';
      city.boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind });
      if (kind === 'res') {
        for (const edge of [0, 1]) {
          let x = x0 + 2;
          while (x < x1 - 10) {
            const lw = 11 + R() * 5, d = 10 + R() * 4, y = edge ? y1 - 3 - d : y0 + 3;
            if (x + lw - 2 > x1) break;
            if (R() < 0.9 && clearOf(x, y, lw - 2.5, d)) city.bldg.push({ x, y, w: lw - 2.5, h: d, ht: 6 + R() * 5, k: 'house', c: R() });
            x += lw;
          }
        }
        for (const edge of [0, 1]) {
          let y = y0 + 20;
          while (y < y1 - 30) {
            const lw = 11 + R() * 4, d = 10 + R() * 3, x = edge ? x1 - 3 - d : x0 + 3;
            if (R() < 0.85 && clearOf(x, y, d, lw - 2.5)) city.bldg.push({ x, y, w: d, h: lw - 2.5, ht: 6 + R() * 5, k: 'house', c: R() });
            y += lw;
          }
        }
        const n = Math.floor((x1 - x0) * (y1 - y0) / 500);
        for (let i = 0; i < n; i++) {
          const x = x0 + 22 + R() * (x1 - x0 - 44), y = y0 + 22 + R() * (y1 - y0 - 44);
          if (clearOf(x - 2, y - 2, 4, 4)) city.trees.push({ x, y, r: 2.5 + R() * 3 });
        }
      } else if (kind === 'down' || kind === 'office') {
        const parcels = [];
        (function split(x, y, w, h, d) {
          if ((w < 48 && h < 48) || d > 4) { parcels.push([x, y, w, h]); return; }
          if (w > h) { const f = 0.35 + R() * 0.3; split(x, y, w * f, h, d + 1); split(x + w * f, y, w * (1 - f), h, d + 1); }
          else { const f = 0.35 + R() * 0.3; split(x, y, w, h * f, d + 1); split(x, y + h * f, w, h * (1 - f), d + 1); }
        })(x0, y0, x1 - x0, y1 - y0, 0);
        for (const [x, y, w, h] of parcels) {
          if (!clearOf(x + 1.5, y + 1.5, w - 3, h - 3, 0.7)) continue;
          if (R() < 0.13 && w > 24 && h > 20) { city.lots.push({ x: x + 2, y: y + 2, w: w - 4, h: h - 4 }); continue; }
          const ht = kind === 'down' ? 25 + Math.pow(R(), 1.6) * 150 : 14 + R() * 30;
          city.bldg.push({ x: x + 1.8, y: y + 1.8, w: w - 3.6, h: h - 3.6, ht, k: 'tower', c: R() });
        }
      } else if (kind === 'works' || kind === 'port') {
        let x = x0;
        while (x < x1 - 20) {
          const w = 28 + R() * 30, ww = Math.min(w, x1 - x);
          if (kind === 'port' && R() < 0.5) {
            for (let cy = y0 + 4; cy < y1 - 8; cy += 7) for (let cx = x + 2; cx < x + ww - 14; cx += 14.5) {
              if (R() < 0.8 && clearOf(cx, cy, 12.2, 2.6, 0.5)) city.bldg.push({ x: cx, y: cy, w: 12.2, h: 2.6, ht: 2.6 * (1 + Math.floor(R() * 3)), k: 'box', c: R() });
            }
          } else {
            const bh = (y1 - y0) * (0.5 + R() * 0.4), by = y0 + R() * ((y1 - y0) - bh);
            if (clearOf(x + 3, by, ww - 6, bh, 0.8)) city.bldg.push({ x: x + 3, y: by, w: ww - 6, h: bh, ht: 9 + R() * 6, k: 'shed', c: R() });
          }
          x += ww + 4;
        }
      } else if (kind === 'green' || kind === 'park') {
        city.parks.push({ x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8, kind });
        const n = Math.floor((x1 - x0) * (y1 - y0) / (kind === 'park' ? 110 : 160));
        for (let i = 0; i < n; i++) {
          const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0);
          if (clearOf(x - 2, y - 2, 4, 4, 0.5)) city.trees.push({ x, y, r: 2.5 + R() * 3.5 });
        }
      } else if (kind === 'plaza') {
        city.parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind });
        for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; city.trees.push({ x: (x0 + x1) / 2 + Math.cos(a) * 38, y: (y0 + y1) / 2 + Math.sin(a) * 30, r: 3.2 }); }
      }
    }
  })();

  // ------------------------------------------------------------ static layer
  function roadEnds(rd) {
    const A = rd.a, B = rd.b, dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const ta = A.type === 'hwy' && rd.cls !== 'hwy' ? A.r : 0, tb = B.type === 'hwy' && rd.cls !== 'hwy' ? B.r : 0;
    return [A.x + ux * ta, A.y + uy * ta, B.x - ux * tb, B.y - uy * tb, ux, uy];
  }
  function strokeSeg(g, x0, y0, x1, y1, w, col, cap) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = cap || 'butt'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

  function drawStatic(target, tw, th) {
    const out = target || bg;
    out.width = tw || cv.width; out.height = th || cv.height;
    const g = out.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = P.ground; g.fillRect(0, 0, out.width, out.height);
    g.setTransform(DPR * view.z, 0, 0, DPR * view.z, DPR * view.ox, DPR * view.oy);
    const px = 1 / view.z;

    // blocks
    for (const b of city.boxes) { g.fillStyle = P.block; g.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); }
    for (const p of city.parks) {
      g.fillStyle = p.kind === 'plaza' ? '#1c222c' : P.park; g.fillRect(p.x, p.y, p.w, p.h);
      if (p.kind === 'park') {
        g.strokeStyle = '#223027'; g.lineWidth = 2.2; g.beginPath();
        g.moveTo(p.x, p.y + p.h * 0.3); g.bezierCurveTo(p.x + p.w * 0.4, p.y + p.h * 0.2, p.x + p.w * 0.5, p.y + p.h * 0.8, p.x + p.w, p.y + p.h * 0.7);
        g.moveTo(p.x + p.w * 0.55, p.y); g.lineTo(p.x + p.w * 0.45, p.y + p.h); g.stroke();
        g.fillStyle = '#0d2330'; g.beginPath(); g.ellipse(p.x + p.w * 0.72, p.y + p.h * 0.35, 16, 10, 0.3, 0, 7); g.fill();
      }
      if (p.kind === 'plaza') {
        g.strokeStyle = '#262e3a'; g.lineWidth = 1; for (let x = p.x; x < p.x + p.w; x += 6) { g.beginPath(); g.moveTo(x, p.y); g.lineTo(x, p.y + p.h); g.stroke(); }
        g.fillStyle = '#10283a'; g.beginPath(); g.arc(p.x + p.w / 2, p.y + p.h / 2, 11, 0, 7); g.fill();
        g.strokeStyle = '#3d5566'; g.lineWidth = 1.2; g.stroke();
      }
    }
    for (const l of city.lots) {
      g.fillStyle = P.lot; g.fillRect(l.x, l.y, l.w, l.h);
      g.strokeStyle = 'rgba(210,215,225,.22)'; g.lineWidth = Math.max(0.15, 0.6 * px);
      for (let x = l.x + 2.7; x < l.x + l.w - 1; x += 2.7) { g.beginPath(); g.moveTo(x, l.y + 1); g.lineTo(x, l.y + 5.5); g.moveTo(x, l.y + l.h - 1); g.lineTo(x, l.y + l.h - 5.5); g.stroke(); }
    }

    // river
    g.beginPath();
    g.moveTo(riverW(-80), -80);
    for (let y = -80; y <= 740; y += 8) g.lineTo(riverW(y), y);
    for (let y = 740; y >= -80; y -= 8) g.lineTo(riverE(y), y);
    g.closePath();
    const wg = g.createLinearGradient(540, 0, 655, 0); wg.addColorStop(0, P.water); wg.addColorStop(0.5, P.water2); wg.addColorStop(1, P.water);
    g.fillStyle = wg; g.fill();
    g.strokeStyle = '#1f3440'; g.lineWidth = 1.2; g.stroke();
    g.strokeStyle = 'rgba(120,170,200,.07)'; g.lineWidth = Math.min(0.8, 1.2 * px);
    const rr = { s: 99 };
    for (let i = 0; i < 90; i++) { const y = -60 + S.rnd(rr) * 780, x = riverW(y) + 8 + S.rnd(rr) * 90, l = 6 + S.rnd(rr) * 14; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke(); }

    // trees under buildings' shadows
    drawBuildings(g, px);
    for (const t of city.trees) {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(t.x + t.r * 0.35, t.y + t.r * 0.3, t.r, 0, 7); g.fill();
      g.fillStyle = P.tree; g.beginPath(); g.arc(t.x, t.y, t.r, 0, 7); g.fill();
      g.fillStyle = P.tree2; g.beginPath(); g.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.55, 0, 7); g.fill();
    }

    // roads: sidewalks, bridge decks, asphalt
    for (const rd of roads) {
      const [x0, y0, x1, y1] = roadEnds(rd), hw = S.hw(rd.cls);
      if (rd.bridge) {
        strokeSeg(g, x0 + 3, y0 + 5, x1 + 3, y1 + 5, 2 * hw + 10, 'rgba(0,0,0,.45)');
        strokeSeg(g, x0, y0, x1, y1, 2 * hw + 7, P.deck);
      } else if (rd.cls !== 'hwy' && rd.cls !== 'ramp') strokeSeg(g, x0, y0, x1, y1, 2 * hw + 7, P.side);
      else strokeSeg(g, x0, y0, x1, y1, 2 * hw + 3, P.curb);
    }
    for (const n of nodes) if (n.type === 'signal' || n.type === 'bend') { const h = n.hwMax + 3.5; g.fillStyle = P.side; g.fillRect(n.x - h, n.y - h, 2 * h, 2 * h); }
    for (const rd of roads) {
      const [x0, y0, x1, y1] = roadEnds(rd), hw = S.hw(rd.cls);
      strokeSeg(g, x0, y0, x1, y1, 2 * hw, rd.cls === 'hwy' ? P.hwy : P.asphalt);
    }
    for (const n of nodes) if (n.type === 'signal' || n.type === 'bend') { const h = n.hwMax; g.fillStyle = P.asphalt; g.fillRect(n.x - h, n.y - h, 2 * h, 2 * h); }
    // freeway gore areas at interchanges

    drawMarkings(g, px);
    drawStreetLights(g);
    drawLabels(g, px);
  }

  function drawBuildings(g, px) {
    const sdx = 0.55, sdy = 0.38;
    for (const b of city.bldg) {
      const sh = Math.min(b.ht * 0.13, 14);
      g.fillStyle = 'rgba(3,6,10,.5)';
      g.beginPath(); g.moveTo(b.x + b.w, b.y); g.lineTo(b.x + b.w + sh * sdx * 2, b.y + sh * sdy * 2); g.lineTo(b.x + b.w + sh * sdx * 2, b.y + b.h + sh * sdy * 2);
      g.lineTo(b.x + sh * sdx * 2, b.y + b.h + sh * sdy * 2); g.lineTo(b.x, b.y + b.h); g.closePath(); g.fill();
    }
    for (const b of city.bldg) {
      let col;
      if (b.k === 'house') col = ['#2d3440', '#33303a', '#2a3139', '#383434', '#2f3743'][Math.floor(b.c * 5)];
      else if (b.k === 'tower') col = ['#27303e', '#2c3545', '#303a4b', '#252d3a', '#343d4d'][Math.floor(b.c * 5)];
      else if (b.k === 'box') col = ['#6b3a2e', '#2e5563', '#3f4b63', '#6a5a33', '#4c3c52', '#385a45'][Math.floor(b.c * 6)];
      else col = '#2b313b';
      g.fillStyle = col; g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = Math.max(0.3, px);
      g.beginPath(); g.moveTo(b.x, b.y + b.h); g.lineTo(b.x, b.y); g.lineTo(b.x + b.w, b.y); g.stroke();
      if (b.k === 'house') {
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = Math.max(0.35, 0.8 * px); g.beginPath();
        if (b.w > b.h) { g.moveTo(b.x + 1, b.y + b.h / 2); g.lineTo(b.x + b.w - 1, b.y + b.h / 2); } else { g.moveTo(b.x + b.w / 2, b.y + 1); g.lineTo(b.x + b.w / 2, b.y + b.h - 1); }
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,.03)'; if (b.w > b.h) g.fillRect(b.x, b.y, b.w, b.h / 2); else g.fillRect(b.x, b.y, b.w / 2, b.h);
      } else if (b.k === 'tower') {
        const i = Math.min(3, Math.min(b.w, b.h) * 0.12);
        g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(b.x + i, b.y + i, b.w - 2 * i, b.h - 2 * i);
        const rr = { s: Math.floor(b.c * 1e6) };
        const n = Math.floor(b.w * b.h / 260);
        for (let k = 0; k < n; k++) {
          const w = 2 + S.rnd(rr) * 4, h = 2 + S.rnd(rr) * 3, x = b.x + i + S.rnd(rr) * (b.w - 2 * i - w), y = b.y + i + S.rnd(rr) * (b.h - 2 * i - h);
          g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 0.4, y + 0.4, w, h); g.fillStyle = '#3a4353'; g.fillRect(x, y, w, h);
        }
        if (b.ht > 150 && b.c < 0.35 && b.w > 20 && b.h > 20) {
          g.strokeStyle = 'rgba(246,166,35,.45)'; g.lineWidth = 0.8; g.beginPath(); g.arc(b.x + b.w / 2, b.y + b.h / 2, 6, 0, 7); g.stroke();
          g.fillStyle = 'rgba(246,166,35,.5)'; g.font = '700 7px Overpass, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', b.x + b.w / 2, b.y + b.h / 2 + 0.5);
        }
        if (S.rnd(rr) < 0.35) { g.fillStyle = 'rgba(255,205,130,.22)'; g.fillRect(b.x + b.w * 0.3, b.y + b.h * 0.3, Math.min(6, b.w * 0.3), Math.min(4, b.h * 0.3)); }
      } else if (b.k === 'shed') {
        g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = Math.max(0.3, 0.6 * px); g.beginPath();
        for (let x = b.x + 4; x < b.x + b.w; x += 4) { g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); }
        g.stroke();
      }
    }
  }

  function drawMarkings(g, px) {
    const lw = Math.max(0.14, 0.75 * px);
    g.lineCap = 'butt';
    for (const L of links) {
      const n0 = nodes[L.from], n1 = nodes[L.to];
      const sA = n0.type === 'hwy' ? 0 : 0, sB = L.len;
      // lane dividers
      g.setLineDash([3, 5.5]); g.strokeStyle = P.white; g.lineWidth = lw;
      for (let k = 1; k < L.lanes; k++) {
        const o = L.med + k * LW; const [x0, y0] = S.lanePt(L, 0, sA, o), [x1, y1] = S.lanePt(L, 0, sB, o);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.setLineDash([]);
      // centre line (drawn once per road: from the link whose from-index is lower)
      if (L.i % 2 === 0) {
        if (L.cls === 'hwy') {
          const [x0, y0] = S.lanePt(L, 0, -n0.r, 0), [x1, y1] = S.lanePt(L, 0, L.len + n1.r, 0);
          strokeSeg(g, x0, y0, x1, y1, 1.1, '#555e6c');
          strokeSeg(g, x0, y0, x1, y1, Math.max(0.3, px), '#7b8494');
        } else {
          for (const off of [-0.22, 0.22]) {
            const [x0, y0] = S.lanePt(L, 0, 0, off), [x1, y1] = S.lanePt(L, 0, L.len, off);
            strokeSeg(g, x0, y0, x1, y1, lw, P.yellow);
          }
        }
      }
      // outer edge line on freeways
      if (L.cls === 'hwy') {
        const o = L.med + L.lanes * LW - 0.3, [x0, y0] = S.lanePt(L, 0, 0, o), [x1, y1] = S.lanePt(L, 0, L.len, o);
        strokeSeg(g, x0, y0, x1, y1, lw, 'rgba(225,230,238,.45)');
      }
      // stop lines
      if (n1.type === 'signal') {
        const [x0, y0] = S.lanePt(L, 0, L.len - 0.4, L.med + 0.1), [x1, y1] = S.lanePt(L, 0, L.len - 0.4, L.med + L.lanes * LW - 0.1);
        strokeSeg(g, x0, y0, x1, y1, 0.55, 'rgba(235,238,244,.7)');
      }
    }
    // crosswalks
    g.fillStyle = 'rgba(225,230,238,.38)';
    for (const n of nodes) {
      if (n.type !== 'signal') continue;
      for (const rd of n.roads) {
        const other = rd.a === n ? rd.b : rd.a, dx = other.x - n.x, dy = other.y - n.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
        const hw = S.hw(rd.cls), cx = n.x + ux * (n.r - 1.9), cy = n.y + uy * (n.r - 1.9);
        g.save(); g.translate(cx, cy); g.rotate(Math.atan2(uy, ux));
        for (let o = -hw + 0.4; o < hw - 0.4; o += 1.25) g.fillRect(-1.4, o, 2.8, 0.62);
        g.restore();
      }
    }
  }

  function drawStreetLights(g) {
    g.globalCompositeOperation = 'lighter';
    for (const rd of roads) {
      const [x0, y0, x1, y1, ux, uy] = roadEnds(rd), hw = S.hw(rd.cls), d = Math.hypot(x1 - x0, y1 - y0);
      const step = rd.cls === 'hwy' ? 46 : 34, rad = rd.cls === 'hwy' ? 20 : 15;
      for (let s = 14, i = 0; s < d - 8; s += step, i++) {
        if (rd.cls === 'hwy') {
          const x = x0 + ux * s, y = y0 + uy * s; g.globalAlpha = 0.1; g.drawImage(SPR.warm, x - rad, y - rad, 2 * rad, 2 * rad);
        } else {
          const side = i % 2 ? 1 : -1, x = x0 + ux * s - uy * (hw + 2.5) * side, y = y0 + uy * s + ux * (hw + 2.5) * side;
          g.globalAlpha = 0.085; g.drawImage(SPR.warm, x - rad, y - rad, 2 * rad, 2 * rad);
          g.globalAlpha = 0.5; g.drawImage(SPR.warm, x - 0.9, y - 0.9, 1.8, 1.8);
        }
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function drawLabels(g, px) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // districts
    if (view.z < 2.2) {
    g.fillStyle = 'rgba(200,210,225,.06)';
    g.font = `900 ${34}px Overpass, sans-serif`;
    spaced(g, 'WESTGATE', 270, 415, 9);
    spaced(g, 'DOWNTOWN', 820, 415, 9);
    g.font = `800 ${18}px Overpass, sans-serif`;
    spaced(g, 'PORT OF PORTSIDE', 470, 30, 6);
    }
    const rf = Math.max(13, 16 / view.z);
    g.save(); g.translate(598, 470); g.rotate(-Math.PI / 2); g.fillStyle = 'rgba(120,170,200,.18)'; g.font = `800 ${rf}px Overpass, sans-serif`; spaced(g, 'KELL RIVER', 0, 0, rf * 0.38); g.restore();
    if (view.z < 0.9) return;
    const fs = Math.max(5.6, 10 / view.z);
    // street names on one segment per name
    const done = new Set();
    g.font = `700 ${fs}px Overpass, sans-serif`; g.fillStyle = 'rgba(170,182,200,.55)';
    const pick = roads.filter(r => !r.bridge && r.cls !== 'ramp').sort((a, b) => Math.abs(a.a.x - 330) - Math.abs(b.a.x - 330));
    for (const rd of roads) {
      const key = rd.name; if (done.has(key) || rd.cls === 'ramp') continue;
      const cands = roads.filter(r => r.name === key);
      const r = cands[Math.floor(cands.length / 2)];
      done.add(key);
      const [x0, y0, x1, y1, ux, uy] = roadEnds(r), hw = S.hw(r.cls);
      let ang = Math.atan2(uy, ux); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const off = hw + 3 + fs * 0.6, mx = (x0 + x1) / 2 + (-Math.sin(ang)) * -off, my = (y0 + y1) / 2 + Math.cos(ang) * -off;
      g.save(); g.translate(mx, my); g.rotate(ang); spaced(g, key.toUpperCase(), 0, 0, fs * 0.2); g.restore();
    }
    void pick;
  }
  function spaced(g, text, x, y, sp) {
    const chars = [...text]; const widths = chars.map(c => g.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    let cx = x - total / 2; const al = g.textAlign; g.textAlign = 'left';
    chars.forEach((c, i) => { g.fillText(c, cx, y); cx += widths[i] + sp; });
    g.textAlign = al;
  }

  // ------------------------------------------------------------ dynamic drawing
  function carColor(c) {
    if (c.kind === 2) return c.col < 0.5 ? '#d6d9de' : '#b95b2b';
    if (c.kind === 3) return '#1f7f8c';
    return CAR_COLS[Math.floor(c.col * CAR_COLS.length) % CAR_COLS.length];
  }
  function carPose(c) {
    const f = S.carPoint(c, c.s), r = S.carPoint(c, c.s - c.len);
    return [(f[0] + r[0]) / 2, (f[1] + r[1]) / 2, Math.atan2(f[1] - r[1], f[0] - r[0])];
  }
  function inView(x, y, m) {
    const sx = x * view.z + view.ox, sy = y * view.z + view.oy;
    return sx > -m && sy > -m && sx < W + m && sy < H + m;
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); }

  function drawCarBody(g, len, wid, col, kind, detail) {
    if (!detail) { g.fillStyle = col; g.fillRect(-len / 2, -wid / 2, len, wid); return; }
    g.fillStyle = 'rgba(0,0,0,.4)'; rrect(g, -len / 2 + 0.3, -wid / 2 + 0.35, len, wid, 0.6); g.fill();
    if (kind === 2) { // truck: cab + box
      g.fillStyle = col; rrect(g, len / 2 - 2.3, -wid / 2, 2.3, wid, 0.5); g.fill();
      g.fillStyle = '#c4c9d1'; g.fillRect(-len / 2, -wid / 2, len - 2.6, wid);
      g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = -len / 2 + 1; x < len / 2 - 3; x += 1.3) g.fillRect(x, -wid / 2, 0.3, wid);
      g.fillStyle = 'rgba(15,20,28,.85)'; g.fillRect(len / 2 - 0.9, -wid / 2 + 0.2, 0.55, wid - 0.4);
      return;
    }
    if (kind === 3) { // bus
      g.fillStyle = col; rrect(g, -len / 2, -wid / 2, len, wid, 0.6); g.fill();
      g.fillStyle = '#e8ecef'; g.fillRect(-len / 2 + 0.5, -wid / 2 + 0.35, len - 1, wid - 0.7);
      g.fillStyle = '#9aa3ad'; g.fillRect(-1.5, -0.6, 3, 1.2); g.fillRect(-len / 2 + 1.2, -0.5, 1.6, 1);
      g.fillStyle = 'rgba(15,20,28,.9)'; g.fillRect(len / 2 - 0.45, -wid / 2 + 0.2, 0.4, wid - 0.4);
      return;
    }
    g.fillStyle = col; rrect(g, -len / 2, -wid / 2, len, wid, 0.75); g.fill();
    g.fillStyle = 'rgba(10,14,22,.82)';
    g.fillRect(len / 2 - 1.75, -wid / 2 + 0.22, 0.85, wid - 0.44);
    g.fillRect(-len / 2 + 0.45, -wid / 2 + 0.28, 0.6, wid - 0.56);
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(-len / 2 + 1.1, -wid / 2 + 0.3, len - 2.95, wid - 0.6);
  }

  function drawWorld(w, now) {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const moving = (ptrs.size > 0 && moved) || pinch || cam || now - lastWheel < 180;
    if (!cityBgReady) renderCityBg();
    if (bgDirty && !moving) { drawStatic(); bgDirty = false; }
    if (bgDirty) {
      // mid-gesture: draw the whole-city layer scaled into place (no re-render, no empty edges)
      const k = DPR * view.z / CITY.res;
      g.fillStyle = P.ground; g.fillRect(0, 0, cv.width, cv.height);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.setTransform(k, 0, 0, k, DPR * (view.ox + CITY.x0 * view.z), DPR * (view.oy + CITY.y0 * view.z));
      g.drawImage(cityBg, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else g.drawImage(bg, 0, 0);
    g.setTransform(DPR * view.z, 0, 0, DPR * view.z, DPR * view.ox, DPR * view.oy);
    const z = view.z, detail = z > 1.3, vs = Math.min(1.45, Math.max(1, 1.9 / z));

    if (showSpeed) drawSpeedMap(g, w);
    if (mode === 'result' && heat) drawHeat(g);

    // signals
    if (z > 0.55) {
      g.globalCompositeOperation = 'lighter';
      for (const n of nodes) {
        if (n.type !== 'signal') continue;
        for (const li of n.ins) {
          const L = links[li], st = S.sig(n, L.grp, w.t);
          const [x, y] = S.lanePt(L, 0, L.len + 0.8, L.med + L.lanes * LW + 1.1);
          const spr = st === 2 ? SPR.green : st === 1 ? SPR.amber : SPR.red;
          g.globalAlpha = 0.5; g.drawImage(spr, x - 4, y - 4, 8, 8);
          g.globalAlpha = 1; g.drawImage(spr, x - 1.1, y - 1.1, 2.2, 2.2);
        }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }

    // cars
    const poses = [];
    for (const c of w.cars) {
      if (c.crash) continue;
      const [x, y, a] = carPose(c);
      if (!inView(x, y, 40)) continue;
      poses.push([c, x, y, a]);
    }
    for (const [c, x, y, a] of poses) {
      const fade = Math.min(1, (w.t - c.born) / 1.2);
      g.globalAlpha = fade;
      g.save(); g.translate(x, y); g.rotate(a); if (vs > 1) g.scale(vs, vs);
      drawCarBody(g, c.len, c.wid, carColor(c), c.kind, detail);
      g.restore();
    }
    g.globalAlpha = 1;
    // lights
    g.globalCompositeOperation = 'lighter';
    for (const [c, x, y, a] of poses) {
      const ca = Math.cos(a), sa = Math.sin(a), hl = c.len / 2 * vs, hwid = (c.wid / 2 - 0.35) * vs;
      const fade = Math.min(1, (w.t - c.born) / 1.2);
      // headlight beam
      g.save(); g.translate(x + ca * hl, y + sa * hl); g.rotate(a);
      g.globalAlpha = 0.16 * fade; g.drawImage(SPR.cone, 0, -4.5, 15, 9);
      g.restore();
      // tail lights
      const brake = c.acc < -0.7 || c.v < 0.4;
      const rx = x - ca * hl, ry = y - sa * hl, sz = brake ? 3.4 : 1.7;
      g.globalAlpha = (brake ? 0.9 : 0.45) * fade;
      for (const sd of [-1, 1]) { const tx = rx - sa * hwid * sd, ty = ry + ca * hwid * sd; g.drawImage(SPR.red, tx - sz, ty - sz, 2 * sz, 2 * sz); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    drawCrash(g, w, now);
    drawSelection(g, now);
    if (mode === 'scout') drawMarkers(g);
  }

  const SPEED_COL = r => r > 0.7 ? '72,213,151' : r > 0.4 ? '246,195,67' : '255,92,77';
  function drawSpeedMap(g, w) {
    g.lineCap = 'butt';
    for (const L of links) {
      const r = w.ema[L.i] / L.v0;
      const o = L.med + L.lanes * LW / 2, [x0, y0] = S.lanePt(L, 0, 0, o), [x1, y1] = S.lanePt(L, 0, L.len, o);
      strokeSeg(g, x0, y0, x1, y1, L.lanes * LW * 0.8, `rgba(${SPEED_COL(r)},.55)`);
    }
  }
  function drawHeat(g) {
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const L of links) {
      const v = heat[L.i]; if (v <= 0.02) continue;
      const o = L.med + L.lanes * LW / 2, [x0, y0] = S.lanePt(L, 0, 0, o), [x1, y1] = S.lanePt(L, 0, L.len, o);
      strokeSeg(g, x0, y0, x1, y1, L.lanes * LW + 10 * v, `rgba(255,70,50,${0.12 + 0.5 * v})`, 'round');
      strokeSeg(g, x0, y0, x1, y1, L.lanes * LW * 0.7, `rgba(255,120,80,${0.25 + 0.5 * v})`, 'round');
    }
    g.globalCompositeOperation = 'source-over';
  }

  function drawCrash(g, w, now) {
    const cr = w.crash; if (!cr) return;
    const L = links[cr.l], a = Math.atan2(L.uy, L.ux);
    const since = w.t - cr.t0;
    let alpha = 1;
    if (cr.cleared) { alpha = Math.max(0, 1 - (w.t - cr.tCleared) / 6); if (alpha <= 0) return; }
    g.globalAlpha = alpha;
    const pt = s => S.lanePt(L, cr.k, s);
    // cones tapering into the lane
    for (let i = 0; i < 4; i++) {
      const s = cr.s - 17 + i * 0.8, off = S.laneOff(L, cr.k) + (i - 1.5) * 0.9;
      const [x, y] = S.lanePt(L, cr.k, s, off);
      g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y, 0.45, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 0.18, 0, 7); g.fill();
    }
    const [x1, y1] = pt(cr.s - 2.6), [x2, y2] = pt(cr.s - 8.2);
    const cols = cr.cols.map(v => CAR_COLS[Math.floor(v * CAR_COLS.length) % CAR_COLS.length]);
    const bodies = [[x1 + Math.cos(a + 1.57) * 0.5, y1 + Math.sin(a + 1.57) * 0.5, a + 0.42, cols[0]], [x2 - Math.cos(a + 1.57) * 0.3, y2 - Math.sin(a + 1.57) * 0.3, a - 0.28, cols[1]]];
    for (const [x, y, r, col] of bodies) {
      const vs = Math.min(1.45, Math.max(1, 1.9 / view.z));
      g.save(); g.translate(x, y); g.rotate(r); g.scale(vs, vs); drawCarBody(g, 4.5, 1.85, col, 0, true);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(1.2, -0.9); g.lineTo(2.25, -0.2); g.lineTo(2.25, 0.9); g.lineTo(1.4, 0.4); g.closePath(); g.fill();
      g.restore();
    }
    // debris
    const dr = { s: cr.id * 31 };
    g.fillStyle = 'rgba(210,220,230,.6)';
    for (let i = 0; i < 14; i++) { const d = S.rnd(dr) * 5, t = S.rnd(dr) * 6.28; g.fillRect(x1 + Math.cos(t) * d - 2, y1 + Math.sin(t) * d, 0.3, 0.3); }
    // lights
    g.globalCompositeOperation = 'lighter';
    const blink = Math.floor(now / 450) % 2 === 0;
    if (blink && !cr.cleared) for (const [x, y] of [[x1, y1], [x2, y2]]) { g.globalAlpha = 0.8 * alpha; g.drawImage(SPR.amber, x - 3, y - 3, 6, 6); }
    if (since > 20 && !cr.cleared) {
      const ph = Math.floor(now / 170) % 4, [px, py] = pt(cr.s - 14);
      g.globalAlpha = 0.55 * alpha;
      const s1 = ph < 2 ? SPR.red : SPR.blue;
      g.drawImage(s1, px - 16, py - 16, 32, 32);
      g.globalAlpha = 0.9 * alpha; g.drawImage(s1, px - 2, py - 2, 4, 4);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    // smoke drifts downwind of the wreck
    for (const p of smoke) {
      g.globalAlpha = p.life * 0.22 * alpha;
      g.drawImage(SPR.smoke, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    g.globalAlpha = 1;
  }

  function laneStrip(g, L, k, s0, s1) {
    const o0 = L.med + k * LW + 0.2, o1 = L.med + (k + 1) * LW - 0.2;
    const a = S.lanePt(L, k, s0, o0), b = S.lanePt(L, k, s1, o0), c = S.lanePt(L, k, s1, o1), d = S.lanePt(L, k, s0, o1);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  }
  function drawSelection(g, now) {
    const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    if (hover && mode === 'scout' && (!sel || hover.li !== sel.li || hover.k !== sel.k || Math.abs(hover.s - sel.s) > 3)) {
      const L = links[hover.li];
      laneStrip(g, L, hover.k, Math.max(0, hover.s - 14), Math.min(L.len, hover.s + 14));
      g.fillStyle = 'rgba(246,166,35,.16)'; g.fill();
    }
    if (sel && mode === 'scout') {
      const L = links[sel.li];
      laneStrip(g, L, sel.k, Math.max(0, sel.s - 16), Math.min(L.len, sel.s + 16));
      g.fillStyle = `rgba(246,166,35,${0.25 + 0.2 * pulse})`; g.fill();
      g.strokeStyle = '#f6a623'; g.lineWidth = Math.max(0.3, 1.2 / view.z); g.stroke();
      const [x, y] = S.lanePt(L, sel.k, sel.s);
      g.strokeStyle = `rgba(246,166,35,${0.9 - 0.6 * pulse})`; g.lineWidth = Math.max(0.4, 2 / view.z);
      g.beginPath(); g.arc(x, y, 7 + 5 * pulse, 0, 7); g.stroke();
      // direction chevron
      g.save(); g.translate(x, y); g.rotate(Math.atan2(L.uy, L.ux)); g.fillStyle = '#1b1206';
      g.beginPath(); g.moveTo(1.6, 0); g.lineTo(-0.8, -1.1); g.lineTo(-0.2, 0); g.lineTo(-0.8, 1.1); g.closePath(); g.fill(); g.restore();
    }
  }
  function drawMarkers(g) {
    const r = 9 / view.z * 1.0;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of store.attempts.slice(0, 12)) {
      const best = store.best && m.id === store.best.id;
      g.fillStyle = best ? 'rgba(246,166,35,.95)' : 'rgba(14,18,26,.85)';
      g.strokeStyle = best ? '#1b1206' : 'rgba(246,166,35,.8)'; g.lineWidth = 1.2 / view.z;
      g.beginPath(); g.arc(m.x, m.y, r, 0, 7); g.fill(); g.stroke();
      g.fillStyle = best ? '#1b1206' : '#f5d9a6'; g.font = `800 ${8.5 / view.z}px Overpass Mono, monospace`;
      g.fillText(fmtShort(m.score), m.x, m.y + 0.6 / view.z);
    }
  }
  const fmtShort = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.max(0, Math.round(v)));

  // ------------------------------------------------------------ game state
  let mode = 'intro', live = null, base = null, snap = null, sel = null, hover = null, crashT = 0;
  let runSpeed = 6, showSpeed = false, heat = null, peakStop = 0, lastResult = null, smoke = [];
  const SCOUT_SPEED = 1.6, BASE_SEED = 20260926;
  const store = loadStore();
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem('snarl-v1')); if (s && Array.isArray(s.attempts)) return s; } catch (e) { /* storage unavailable */ }
    return { attempts: [], best: null };
  }
  function saveStore() { try { localStorage.setItem('snarl-v1', JSON.stringify(store)); } catch (e) { /* storage unavailable */ } }

  function boot() {
    const w = S.newWorld(BASE_SEED);
    for (let i = 0; i < 1500; i++) S.step(w);
    snap = w; live = S.clone(snap);
  }
  const GRADES = [
    [0, 'Nobody noticed', 'Traffic flowed around it like water around a pebble.'],
    [40, 'Fender bender', 'A few drivers were late. Nobody will remember this.'],
    [100, 'Rubberneckers\u2019 delight', 'A proper slowdown. The local radio mentioned it.'],
    [250, 'Rush-hour meltdown', 'Queues spilled back through intersections. Meetings started without people.'],
    [500, 'Gridlock', 'Whole corridors stopped moving. People got out of their cars.'],
    [850, 'Carmageddon', 'The city will be talking about this one for weeks.'],
  ];
  const gradeOf = v => { let g = GRADES[0]; for (const gr of GRADES) if (v >= gr[0]) g = gr; return g; };

  function clockStr(t) {
    const mins = 7 * 60 + 55 + Math.floor(t / 60);
    const h = Math.floor(mins / 60) % 12 || 12, m = mins % 60;
    return `${h}:${String(m).padStart(2, '0')} ${mins >= 720 ? 'PM' : 'AM'}`;
  }
  const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmt = v => Math.round(v).toLocaleString('en-US');

  // ------------------------------------------------------------ picking
  function pick(sx, sy, touch) {
    const [wx, wy] = toWorld(sx, sy), tol = Math.max(LW * 0.7, (touch ? 26 : 10) / view.z);
    let best = null, bd = tol;
    for (const L of links) {
      const rx = wx - L.x0, ry = wy - L.y0, s = rx * L.ux + ry * L.uy;
      if (s < 10 || s > L.len - 10) continue;
      const o = rx * L.nx + ry * L.ny;
      for (let k = 0; k < L.lanes; k++) {
        const d = Math.abs(o - S.laneOff(L, k));
        if (d < bd) { bd = d; best = { li: L.i, k, s }; }
      }
    }
    if (best) { const [x, y] = S.lanePt(links[best.li], best.k, best.s); best.x = x; best.y = y; }
    return best;
  }
  function laneLabel(p) {
    const L = links[p.li];
    const lane = L.lanes > 1 ? (p.k === 0 ? 'Left lane' : 'Right lane') : 'Only lane';
    return { road: S.linkLabel(L), lane, lanes: L.lanes };
  }

  // ------------------------------------------------------------ panel
  const panel = $('panel');
  function hazardIcon() { return '<svg class="haz" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 19 18H1z" fill="none" stroke="#1b1206" stroke-width="2.2" stroke-linejoin="round"/><path d="M10 8v4.5" stroke="#1b1206" stroke-width="2.2" stroke-linecap="round"/><circle cx="10" cy="15.2" r="1.2" fill="#1b1206"/></svg>'; }
  let panelMin = false;
  function renderPanel() {
    renderPanelBody();
    const grip = document.createElement('button');
    grip.className = 'grip'; grip.id = 'bGrip';
    grip.setAttribute('aria-label', panelMin ? 'Expand panel' : 'Collapse panel');
    grip.setAttribute('aria-expanded', String(!panelMin));
    grip.onclick = () => { panelMin = !panelMin; panel.classList.toggle('min', panelMin); grip.setAttribute('aria-expanded', String(!panelMin)); grip.setAttribute('aria-label', panelMin ? 'Expand panel' : 'Collapse panel'); };
    panel.prepend(grip);
    panel.classList.toggle('min', panelMin);
  }
  function renderPanelBody() {
    if (mode === 'scout' || mode === 'intro') {
      const best = store.best ? `<div class="hint">Your best: <b class="num">${fmt(store.best.score)}</b> vehicle-min on ${esc(store.best.road)}</div>` : '';
      if (!sel) {
        panel.innerHTML = `<div class="eyebrow">Step 1 of 2 · Scout</div>
          <h2 class="keep">Pick a lane to crash in</h2>
          <p>Tap any lane to see how busy it is. Pinch to zoom, drag to pan. Bridges, ramps and corners where queues back up are good places to start.</p>
          <div class="legend"><span><i style="background:#ff3b30;box-shadow:0 0 8px #ff3b30"></i>Bright tail lights: braking</span></div>
          ${best}`;
      } else {
        const lb = laneLabel(sel);
        panel.innerHTML = `<div class="eyebrow">Step 2 of 2 · Crash site</div>
          <h2 class="keep">${esc(lb.road)}</h2>
          <div class="row"><span class="chip amber">${lb.lane}${lb.lanes > 1 ? ' of ' + lb.lanes : ''}</span><span class="chip">${lb.lanes > 1 ? 'Other lane stays open' : 'Blocks the road in this direction'}</span></div>
          <div class="stats">
            <div class="stat"><b id="sFlow">–</b><span>cars / min</span></div>
            <div class="stat"><b id="sSpeed">–</b><span>avg km/h</span></div>
            <div class="stat"><b id="sCars">–</b><span>cars on block</span></div>
          </div>
          <div class="row keep"><button class="btn crash" id="bCrash">${hazardIcon()}Crash here</button><button class="btn ghost" id="bCancel">Cancel</button></div>
          <div class="hint keys">Press <kbd>Enter</kbd> to crash, <kbd>Esc</kbd> to cancel.</div>`;
        $('bCrash').onclick = doCrash; $('bCancel').onclick = () => { sel = null; renderPanel(); };
        updateSelStats();
      }
    } else if (mode === 'run') {
      const lb = laneLabel(sel);
      panel.innerHTML = `<div class="eyebrow keep" id="rStatus">Lane blocked</div>
        <h2>${esc(lb.road)}</h2>
        <div class="timeline" aria-hidden="true"><div class="fill" id="rFill" style="width:0"></div><div class="tow" style="left:${S.CLEAR_T / S.RUN_T * 100}%"></div></div>
        <div class="tl-labels"><span>Crash</span><span>Tow truck ${mmss(S.CLEAR_T)}</span><span>${mmss(S.RUN_T)}</span></div>
        <div class="stats keep">
          <div class="stat"><b id="rDelay" style="color:var(--red)">0</b><span>extra veh-min</span></div>
          <div class="stat"><b id="rStop">0</b><span>cars stopped</span></div>
          <div class="stat"><b id="rClock">0:00</b><span>elapsed</span></div>
        </div>
        <div class="row keep" style="justify-content:space-between">
          <div class="seg" role="group" aria-label="Simulation speed">
            ${[[2, '2×'], [6, '6×'], [20, '20×'], [80, 'Skip']].map(([v, l]) => `<button data-sp="${v}" aria-pressed="${v === runSpeed}">${l}</button>`).join('')}
          </div>
          <button class="btn ghost" id="bAbort" style="height:32px;padding:0 12px;font-size:12px">Give up</button>
        </div>`;
      panel.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { runSpeed = +b.dataset.sp; panel.querySelectorAll('[data-sp]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      $('bAbort').onclick = () => { newAttempt(); };
    } else if (mode === 'result') {
      const r = lastResult, gr = gradeOf(r.score);
      const isBest = store.best && store.best.id === r.id;
      const hist = store.attempts.slice(0, 6).map(a => `<li class="${store.best && a.id === store.best.id ? 'best' : ''}"><span>${esc(a.road)}</span><span class="num">${fmt(a.score)}</span></li>`).join('');
      panel.innerHTML = `<div class="eyebrow">${esc(r.road)}</div>
        <div class="plate result-plate keep">
          <div class="k">Extra delay caused</div>
          <div class="big">${fmt(r.score)}</div>
          <div class="unit">vehicle-minutes · about ${(r.score * 1.3 / 60).toFixed(1)} person-hours</div>
        </div>
        <div class="grade"><div class="diamond" aria-hidden="true"></div><div><b>${gr[1]}</b>${isBest && store.attempts.length > 1 ? ' <span class="chip go">New best</span>' : ''}<div style="color:var(--mute);font-size:13px">${gr[2]}</div></div></div>
        <div class="stats">
          <div class="stat"><b>${fmt(r.peak)}</b><span>peak extra cars stopped</span></div>
          <div class="stat"><b>${fmt(r.lost)}</b><span>trips not finished</span></div>
          <div class="stat"><b>${r.spread}</b><span>blocks jammed</span></div>
        </div>
        <p style="font-size:13px;color:var(--mute)">${esc(r.tip)}</p>
        <div class="row keep"><button class="btn go" id="bAgain">Try another spot</button><button class="btn ghost" id="bShare">Copy result</button></div>
        <div class="history"><div class="eyebrow">Your attempts</div><ol>${hist}</ol></div>`;
      $('bAgain').onclick = newAttempt; $('bShare').onclick = share;
    }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function updateSelStats() {
    if (!sel || mode !== 'scout') return;
    const L = links[sel.li], f = $('sFlow'); if (!f) return;
    f.textContent = live.flow[sel.li].toFixed(0);
    $('sSpeed').textContent = Math.round(live.ema[sel.li] * 3.6);
    $('sCars').textContent = live.lanes[sel.li].reduce((a, r) => a + r.length, 0);
    void L;
  }
  function updateRunStats() {
    if (mode !== 'run') return;
    const el = live.t - crashT, ex = (live.delay - base.delay) / 60;
    $('rDelay').textContent = fmt(Math.max(0, ex));
    $('rStop').textContent = fmt(live.stopped) + (live.stopped > base.stopped ? ` (+${live.stopped - base.stopped})` : '');
    $('rClock').textContent = mmss(el);
    $('rFill').style.width = Math.min(100, el / S.RUN_T * 100) + '%';
    $('rStatus').textContent = live.crash && !live.crash.cleared ? `Lane blocked · tow truck in ${mmss(S.CLEAR_T - el)}` : 'Lane cleared · watching the jam dissolve';
  }

  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  // ------------------------------------------------------------ flow
  function doCrash() {
    if (!sel || mode !== 'scout') return;
    Snd.init();
    base = S.clone(live);
    S.applyCrash(live, sel.li, sel.k, sel.s);
    crashT = live.t; peakStop = 0; heat = null; smoke = [];
    mode = 'run'; hover = null; $('tip').hidden = true;
    Snd.crash(); toast('Crash! Lane blocked');
    const narrow = W < 700;
    flyTo(live.crash.x + (narrow ? 0 : -110 / Math.max(view.z, 2.2)), live.crash.y + (narrow ? 60 / 2.2 : 0), narrow ? 1.6 : 2.2);
    renderPanel();
  }
  let clearedToast = false;
  function finish() {
    mode = 'result';
    const score = Math.max(0, (live.delay - base.delay) / 60);
    const diff = links.map(L => live.delayLink[L.i] - base.delayLink[L.i]);
    const mx = Math.max(1, ...diff);
    heat = diff.map(d => Math.max(0, d / mx));
    const lb = laneLabel(sel);
    lastResult = {
      id: Date.now(), score: Math.round(score), road: lb.road + (lb.lanes > 1 ? ` (${lb.lane.toLowerCase()})` : ''),
      x: live.crash.x, y: live.crash.y, peak: peakStop, lost: Math.max(0, base.arrived - live.arrived),
      spread: diff.filter(d => d > 90).length,
    };
    lastResult.tip = tipFor(lastResult, links[sel.li]);
    store.attempts.unshift({ id: lastResult.id, score: lastResult.score, road: lastResult.road, x: lastResult.x, y: lastResult.y });
    store.attempts = store.attempts.slice(0, 30);
    if (!store.best || lastResult.score > store.best.score) store.best = { id: lastResult.id, score: lastResult.score, road: lastResult.road };
    saveStore();
    renderPanel();
  }
  function tipFor(r, L) {
    if (r.score < 40 && L.lanes > 1) return 'The other lane soaked it up. Try a spot where there is only one lane, or where drivers have no other way to go.';
    if (r.score < 40) return 'Not enough traffic here to notice. Turn on the speed map to find the busy corridors.';
    if (r.spread <= 3) return 'The jam stayed local. The worst crashes back up far enough to block intersections and spread onto other roads.';
    if (L.cls === 'hwy') return 'Freeway traffic arrives fast and has nowhere else to go. The red glow shows how far back the queue reached.';
    return 'Red glow on the map shows where the extra delay piled up. Queues that reach an intersection start blocking other routes.';
  }
  function newAttempt() {
    live = S.clone(snap); base = null; sel = null; heat = null; smoke = []; clearedToast = false;
    mode = 'scout'; renderPanel();
  }
  async function share() {
    const r = lastResult, gr = gradeOf(r.score);
    const url = /github\.io$/.test(location.hostname) ? location.href.split('#')[0] : SHARE_URL;
    const text = `SNARL · Portside rush hour\nI crashed on ${r.road} and caused ${fmt(r.score)} vehicle-minutes of extra delay (${gr[1]}).\nCan you cause a worse jam?${url ? ' ' + url : ''}`;
    try { await navigator.clipboard.writeText(text); toast('Result copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Result copied'); } catch (e2) { toast('Copy not allowed here'); } ta.remove(); }
  }
  const SHARE_URL = 'https://claude.ai/artifact/K4ibcsZFRsxDCZYsNWJEQM';

  // ------------------------------------------------------------ sound
  const Snd = {
    ac: null, on: true,
    init() {
      if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; } }
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      // iOS unlocks Web Audio only after a sound starts inside a tap
      if (this.ac && !this.unlocked) { try { const b = this.ac.createBuffer(1, 1, 22050), src = this.ac.createBufferSource(); src.buffer = b; src.connect(this.ac.destination); src.start(0); this.unlocked = true; } catch (e) { /* ignore */ } }
    },
    noise(dur) { const ac = this.ac, b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); const s = ac.createBufferSource(); s.buffer = b; return s; },
    crash() {
      if (!this.on || !this.ac) return; const ac = this.ac, t = ac.currentTime;
      const n = this.noise(0.9), f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; const gn = ac.createGain(); gn.gain.value = 0.5;
      n.connect(f).connect(gn).connect(ac.destination); n.start(t);
      const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(og).connect(ac.destination); o.start(t); o.stop(t + 0.45);
      const gl = this.noise(0.5), hf = ac.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 5000; const gg = ac.createGain(); gg.gain.value = 0.25;
      gl.connect(hf).connect(gg).connect(ac.destination); gl.start(t + 0.08);
    },
    honk() {
      if (!this.on || !this.ac) return; const ac = this.ac, t = ac.currentTime, f0 = 330 + Math.random() * 160, dur = 0.15 + Math.random() * 0.3;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; const gn = ac.createGain();
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.045, t + 0.02); gn.gain.setValueAtTime(0.045, t + dur); gn.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      lp.connect(gn).connect(ac.destination);
      for (const m of [1, 1.26]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f0 * m; o.connect(lp); o.start(t); o.stop(t + dur + 0.08); }
    },
  };

  // ------------------------------------------------------------ input
  const ptrs = new Map(); let drag = null, pinch = null, moved = false;
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
    cam = null;
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 1) { drag = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy }; moved = false; }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox: view.ox, oy: view.oy }; moved = true;
    }
  });
  cv.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      const wx = (pinch.cx - pinch.ox) / pinch.z, wy = (pinch.cy - pinch.oy) / pinch.z;
      view.z = pinch.z * d / pinch.d; clampView();
      view.ox = (a.x + b.x) / 2 - wx * view.z; view.oy = (a.y + b.y) / 2 - wy * view.z; clampView();
      userView = true; bgDirty = true; return;
    }
    if (drag && ptrs.size === 1) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 6) { moved = true; cv.classList.add('panning'); }
      if (moved) { view.ox = drag.ox + dx; view.oy = drag.oy + dy; clampView(); userView = true; bgDirty = true; }
      return;
    }
    if (e.pointerType === 'mouse' && mode === 'scout') {
      hover = pick(e.offsetX, e.offsetY);
      const tip = $('tip');
      if (hover) { tip.hidden = false; tip.textContent = S.linkLabel(links[hover.li]); tip.style.left = e.offsetX + 'px'; tip.style.top = e.offsetY + 'px'; cv.style.cursor = 'pointer'; }
      else { tip.hidden = true; cv.style.cursor = ''; }
    }
  });
  function endPtr(e) {
    const wasClick = ptrs.size === 1 && !moved && ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { const r = [...ptrs.values()][0]; drag = { x: r.x, y: r.y, ox: view.ox, oy: view.oy }; }
    if (ptrs.size === 0) { drag = null; cv.classList.remove('panning'); }
    if (wasClick && e.type === 'pointerup') onTap(e.offsetX, e.offsetY, e.pointerType !== 'mouse');
  }
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('pointerleave', () => { if (!ptrs.size) { hover = null; $('tip').hidden = true; } });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); cam = null; lastWheel = performance.now();
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    const wx = (e.offsetX - view.ox) / view.z, wy = (e.offsetY - view.oy) / view.z;
    view.z *= f; clampView();
    view.ox = e.offsetX - wx * view.z; view.oy = e.offsetY - wy * view.z; clampView();
    userView = true; bgDirty = true;
  }, { passive: false });
  function onTap(x, y, touch) {
    if (mode !== 'scout') return;
    const p = pick(x, y, touch);
    if (!p && touch && sel) return; // a stray tap on a phone shouldn't lose the selection
    sel = p; renderPanel();
    if (sel) keepVisible(sel.x, sel.y);
  }
  // on phones the panel covers the lower map; slide the chosen lane into view above it
  function keepVisible(wx, wy) {
    const sy = wy * view.z + view.oy, sx = wx * view.z + view.ox, top = panel.getBoundingClientRect().top - cv.getBoundingClientRect().top;
    if (sy < top - 30 && sy > 90 && sx > 20 && sx < W - 20) return;
    const cy = wy + (H / 2 - Math.max(100, top * 0.5)) / view.z;
    flyTo(wx, cy, view.z);
  }
  window.addEventListener('keydown', e => {
    if (!$('help').hidden && e.key === 'Escape') { $('help').hidden = true; return; }
    if (mode === 'scout' && sel && e.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); doCrash(); }
    if (mode === 'scout' && sel && e.key === 'Escape') { sel = null; renderPanel(); }
  });

  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault());
  document.addEventListener('touchend', () => Snd.ac && Snd.on && Snd.init(), { passive: true });
  $('bStart').onclick = () => { Snd.init(); $('intro').hidden = true; mode = 'scout'; renderPanel(); };
  $('bHelp').onclick = () => { $('help').hidden = false; $('bHelpClose').focus(); };
  $('bHelpClose').onclick = () => { $('help').hidden = true; };
  $('bFit').onclick = () => { userView = false; fitView(); };
  $('bSpeed').onclick = () => { showSpeed = !showSpeed; $('bSpeed').setAttribute('aria-pressed', showSpeed); };
  $('bSound').onclick = () => { Snd.init(); Snd.on = !Snd.on; $('bSound').setAttribute('aria-pressed', Snd.on); $('sndWave').style.display = Snd.on ? '' : 'none'; };

  // ------------------------------------------------------------ loop
  let last = performance.now(), acc = 0, uiT = 0, honkT = 0;
  function advance(simSec) {
    acc += simSec;
    const t0 = performance.now(), budget = 14;
    let n = 0;
    while (acc >= S.DT) {
      S.step(live); if (base) S.step(base);
      acc -= S.DT; n++;
      if (mode === 'run') {
        peakStop = Math.max(peakStop, live.stopped - base.stopped);
        if (live.t - crashT >= S.RUN_T) { acc = 0; finish(); break; }
      }
      if (performance.now() - t0 > budget) { acc = Math.min(acc, S.DT * 4); break; }
    }
    return n;
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    stepCam(dt);
    if (mode === 'intro' || mode === 'scout') advance(dt * SCOUT_SPEED);
    else if (mode === 'run') {
      advance(dt * runSpeed);
      if (live.crash && live.crash.cleared && !clearedToast) { clearedToast = true; toast('Tow truck cleared the lane'); }
      // smoke particles
      if (!reduceMotion && live.crash && !live.crash.cleared && live.t - crashT < 90 && Math.random() < 0.6) {
        smoke.push({ x: live.crash.x + 2 + (Math.random() - 0.5) * 2, y: live.crash.y + (Math.random() - 0.5) * 2, vx: 1.4 + Math.random(), vy: -0.8 - Math.random() * 0.6, r: 1.5 + Math.random() * 1.5, life: 1 });
      }
      honkT -= dt;
      const extra = live.stopped - base.stopped;
      if (honkT <= 0 && extra > 15 && runSpeed <= 20) { if (Math.random() < Math.min(0.9, extra / 120)) Snd.honk(); honkT = 0.5 + Math.random() * 1.5; }
    }
    for (const p of smoke) { p.x += p.vx * dt * 3; p.y += p.vy * dt * 3; p.r += dt * 3; p.life -= dt * 0.35; }
    smoke = smoke.filter(p => p.life > 0);
    drawWorld(live, now);
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.2; $('clock').textContent = clockStr(live.t); updateSelStats(); updateRunStats(); }
    requestAnimationFrame(frame);
  }

  // test hook: screen position of the middle of a named link (used by automated checks)
  window.__snarlDebug = { view: () => ({ z: +view.z.toFixed(3), ox: Math.round(view.ox), oy: Math.round(view.oy) }), screenOfLabel(lbl) { const L = links.find(l => S.linkLabel(l) === lbl); if (!L) return null; const [x, y] = S.lanePt(L, 0, L.len / 2); return [x * view.z + view.ox, y * view.z + view.oy]; } };
  window.addEventListener('resize', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { bgDirty = true; cityBgReady = false; });
  boot(); resize(); renderPanel();
  requestAnimationFrame(frame);
})();
