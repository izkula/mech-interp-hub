/* Snarl traffic engine.
 * Car following: Intelligent Driver Model (Treiber et al. 2000).
 * Lane changes: simplified MOBIL (Kesting et al. 2007) with route bias.
 * Signals: fixed-time two-phase plans with green-wave offsets.
 * Routing: link-based Dijkstra on live travel times for drivers with
 * navigation apps; everyone else uses free-flow habits.
 */
const SIM = (function () {
  'use strict';
  const LW = 3.4, DT = 0.2, CLEAR_T = 300, RUN_T = 480, INFORMED = 0.4;
  const CLS = {
    hwy: { lanes: 2, v0: 27, med: 1.4, pri: 4 },
    art: { lanes: 2, v0: 15, med: 0.35, pri: 3 },
    st: { lanes: 1, v0: 12.5, med: 0, pri: 2 },
    ramp: { lanes: 1, v0: 15, med: 0, pri: 1 },
  };
  // half-width of a road: two-way roads put each direction to the right of the centre line;
  // one-way roads are centred on it
  const hw = r => typeof r === 'string' ? CLS[r].med + CLS[r].lanes * LW : r.oneway ? CLS[r.cls].lanes * LW / 2 : CLS[r.cls].med + CLS[r.cls].lanes * LW;

  function rnd(r) {
    r.s = (r.s + 0x6D2B79F5) | 0; let t = r.s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hash01(a, b, c) {
    let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x632BE5AB, 0x85EBCA77) ^ Math.imul((c | 0) + 0x1B873593, 0xC2B2AE3D)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }


  // ---------------------------------------------------------------- layouts
  // Each layout builds its road network with N (node), R (road) and chain, and returns its
  // demand as generators G(vehicles per hour, origin links, destination links).
  const wavy = (x0, a, f, p) => y => x0 + a * Math.sin(y / f + p) + a * 0.4 * Math.sin(y / (f * 0.28));
  const riverW = y => 540 + 7 * Math.sin(y / 47) + 3 * Math.sin(y / 13), riverE = y => 652 + 6 * Math.sin(y / 61 + 2) + 2 * Math.sin(y / 17);
  function bandPoly(left, right, y0, y1) { const pts = []; for (let y = y0; y <= y1; y += 8) pts.push([left(y), y]); for (let y = y1; y >= y0; y -= 8) pts.push([right(y), y]); return pts; }
  function ellipsePoly(cx, cy, rx, ry) { const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([cx + Math.cos(a) * rx * (1 + 0.06 * Math.sin(a * 3)), cy + Math.sin(a) * ry * (1 + 0.05 * Math.cos(a * 5))]); } return pts; }
  const LAYOUTS = {
    portside: {
      id: 'portside', name: 'Portside', tagline: 'River city. Three crossings, one freeway.',
      world: { x0: -20, y0: 10, x1: 1020, y1: 650 }, focus: [560, 330], demandScale: 1.2, cityGen: 'portside',
      water: [bandPoly(riverW, riverE, -80, 740)],
      labels: [
        { t: 'WESTGATE', x: 270, y: 415, size: 34, sp: 9 }, { t: 'DOWNTOWN', x: 820, y: 415, size: 34, sp: 9 },
        { t: 'PORT OF PORTSIDE', x: 470, y: 30, size: 18, sp: 6 }, { t: 'KELL RIVER', x: 598, y: 470, size: 13, sp: 5, rot: -Math.PI / 2, water: true },
      ],
      build({ N, R, chain }) {
      const XW = [60, 200, 340, 480], XE = [700, 820, 940], YS = [230, 350, 470, 590];
      const g = (x, y) => 'g' + x + '_' + y;
      for (const x of XW.concat(XE)) for (const y of YS) N(g(x, y), x, y);
      N('HW0', -40, 80, 'edge'); N('HA', 250, 80, 'hwy'); N('HB', 430, 80, 'hwy');
      N('HC', 730, 80, 'hwy'); N('HD', 910, 80, 'hwy'); N('HW1', 1040, 80, 'edge');
      N('J1', 340, 150); N('J2', 820, 150);
      N('W1', -40, 350, 'edge'); N('W2', -40, 470, 'edge'); N('E1', 1040, 350, 'edge'); N('E2', 1040, 470, 'edge');
      N('S1', 200, 680, 'edge'); N('S2', 820, 680, 'edge');

      chain(['HW0', 'HA', 'HB'], 'hwy', 'Harbor Fwy');
      R('HB', 'HC', 'hwy', 'Harbor Fwy', { bridge: true });
      chain(['HC', 'HD', 'HW1'], 'hwy', 'Harbor Fwy');
      R('HA', 'J1', 'ramp', 'Oak Ave ramp'); R('J1', 'HB', 'ramp', 'Oak Ave ramp');
      R('HC', 'J2', 'ramp', 'Tower Ave ramp'); R('J2', 'HD', 'ramp', 'Tower Ave ramp');
      R('J1', g(340, 230), 'art', 'Oak Ave'); R('J2', g(820, 230), 'art', 'Tower Ave');
      chain(XW.map(x => g(x, 230)), 'st', 'Elm St');
      chain(XE.map(x => g(x, 230)), 'st', 'Cannery Row');
      chain(['W1'].concat(XW.map(x => g(x, 350))), 'art', 'Main St');
      R(g(480, 350), g(700, 350), 'art', 'Main St Bridge', { bridge: true });
      chain(XE.map(x => g(x, 350)).concat(['E1']), 'art', 'Main St');
      chain(['W2'].concat(XW.map(x => g(x, 470))), 'st', 'Pine St');
      chain(XE.map(x => g(x, 470)).concat(['E2']), 'st', 'Harbor St');
      chain(XW.map(x => g(x, 590)), 'st', 'River Rd');
      R(g(480, 590), g(700, 590), 'st', 'Old Bridge', { bridge: true });
      chain(XE.map(x => g(x, 590)), 'st', 'Dock St');
      const NS = { 60: '1st Ave', 200: '2nd Ave', 340: 'Oak Ave', 480: 'Bank St', 700: 'Quay St', 820: 'Tower Ave', 940: 'Ferry St' };
      for (const x of XW.concat(XE)) chain(YS.map(y => g(x, y)), (x === 340 || x === 820) ? 'art' : 'st', NS[x]);
      R(g(200, 590), 'S1', 'st', '2nd Ave'); R(g(820, 590), 'S2', 'art', 'Tower Ave');
      },
      demand({ src, snk, zone, G }) {
      const WEST = zone(n => n.x <= 480 && n.y >= 230), EAST = zone(n => n.x >= 700 && n.y >= 230);
      return [
        G(1750, [src('HW0')], [snk('HW1')]),
        G(1200, [src('HW1')], [snk('HW0')]),
        G(380, [src('HW0')], EAST),
        G(200, [src('HW1')], WEST),
        G(820, WEST, EAST),
        G(320, [src('W1'), src('W2')], EAST),
        G(200, [src('S1')], EAST),
        G(160, WEST, [snk('HW1'), snk('E1'), snk('E2')]),
        G(160, EAST, WEST),
        G(560, WEST, WEST),
        G(640, EAST, EAST),
        G(160, [src('E1'), src('E2')], EAST),
        G(120, [src('E1'), src('E2'), src('S2')], WEST),
        G(160, EAST, [snk('S2'), snk('E1'), snk('E2'), snk('HW0')]),
        G(130, [src('S2')], EAST),
        G(100, [src('W1'), src('W2')], WEST),
      ];
      },
    },

    midtown: {
      id: 'midtown', name: 'Midtown', tagline: 'One-way grid. Hard mode: drivers just go around.',
      world: { x0: -20, y0: 0, x1: 940, y1: 620 }, focus: [520, 320], demandScale: 1.15, cityGen: 'generic',
      water: [bandPoly(wavy(868, 5, 40, 1), () => 1200, -120, 760)],
      zone(x, y) { if (x > 845) return null; if (x > 350 && x < 470 && y > 170 && y < 250) return 'park'; if (y < 60 || y > 560) return 'mid'; return 'down'; },
      labels: [
        { t: 'MIDTOWN', x: 410, y: 312, size: 36, sp: 10 },
        { t: 'EAST RIVER', x: 905, y: 170, size: 13, sp: 5, rot: -Math.PI / 2, water: true },
      ],
      build({ N, R, chain }) {
        const AX = [60, 200, 340, 480, 620, 760], SY = [60, 160, 260, 360, 460, 560], g = (x, y) => 'm' + x + '_' + y;
        for (const x of AX) for (const y of SY) N(g(x, y), x, y);
        for (const y of SY) N('f' + y, 830, y);
        N('FN', 830, -60, 'edge'); N('FS', 830, 700, 'edge'); N('TE', 1080, 360, 'edge');
        for (const x of AX) { N('an' + x, x, -60, 'edge'); N('as' + x, x, 700, 'edge'); }
        for (const y of SY) N('sw' + y, -60, y, 'edge');
        // avenues: N = northbound one-way, S = southbound one-way, 2 = two-way
        const AV = { 60: ['West End Ave', '2', 'st'], 200: ['Amsterdam Ave', 'N', 'art'], 340: ['Columbus Ave', 'S', 'art'], 480: ['Park Ave', '2', 'art'], 620: ['Lexington Ave', 'N', 'art'], 760: ['Third Ave', 'S', 'art'] };
        for (const x of AX) {
          const [name, dir, cls] = AV[x], col = ['an' + x].concat(SY.map(y => g(x, y)), ['as' + x]);
          if (dir === 'N') chain(col.slice().reverse(), cls, name, { oneway: true });
          else if (dir === 'S') chain(col, cls, name, { oneway: true });
          else chain(col, cls, name);
        }
        // streets: E = eastbound one-way, W = westbound one-way, 2 = two-way
        const ST = { 60: ['57th St', 'E'], 160: ['50th St', 'W'], 260: ['42nd St', '2'], 360: ['34th St', '2'], 460: ['23rd St', 'W'], 560: ['14th St', 'E'] };
        for (const y of SY) {
          const [name, dir] = ST[y], row = ['sw' + y].concat(AX.map(x => g(x, y)), ['f' + y]);
          if (dir === 'E') chain(row, 'st', name, { oneway: true });
          else if (dir === 'W') chain(row.slice().reverse(), 'st', name, { oneway: true });
          else chain(row, 'art', name);
        }
        chain(['FN'].concat(SY.map(y => 'f' + y), ['FS']), 'art', 'FDR Drive');
        R('f360', 'TE', 'art', 'Midtown Bridge', { bridge: true });
      },
      demand({ src, snk, zone, edgeSrc, edgeSnk, G }) {
        const CORE = zone(n => n.x >= 200 && n.x <= 760 && n.y >= 160 && n.y <= 460);
        const ALL = zone(() => true);
        const SOUTH = edgeSrc(n => n.y > 650 && n.x < 800), WEST = edgeSrc(n => n.x < 0), OUT = edgeSnk(() => true);
        return [
          G(820, [src('TE')], CORE),
          G(1250, SOUTH, CORE),
          G(700, WEST, CORE),
          G(820, [src('FS')], [snk('FN')]),
          G(700, [src('FN')], [snk('FS')]),
          G(300, [src('FN'), src('FS')], CORE),
          G(1100, ALL, ALL),
          G(300, CORE, OUT),
          G(160, [src('TE')], [snk('FN'), snk('FS')]),
        ];
      },
    },

    beltway: {
      id: 'beltway', name: 'Beltway', tagline: 'A ring road around a tight downtown.',
      world: { x0: -20, y0: 0, x1: 1020, y1: 660 }, focus: [500, 330], demandScale: 1.8, cityGen: 'generic', relativeSignals: true,
      water: [ellipsePoly(120, 485, 92, 58)],
      zone(x, y) {
        const d = Math.hypot(x - 500, y - 330);
        if (d < 135) return 'down'; if (d < 238) return 'mid';
        if (x > 820 && y < 170) return 'works'; if (x < 180 && y < 170) return 'works';
        if (Math.hypot(x - 120, y - 485) < 125) return 'park';
        return 'res';
      },
      labels: [
        { t: 'CITY CENTRE', x: 500, y: 300, size: 22, sp: 7 },
        { t: 'NORTHSIDE', x: 250, y: 60, size: 26, sp: 8 }, { t: 'EASTFIELD', x: 860, y: 520, size: 26, sp: 8 },
        { t: 'MIRROR LAKE', x: 120, y: 487, size: 11, sp: 4, water: true },
      ],
      build({ N, R, chain }) {
        const cx = 500, cy = 330, RR = 250, ring = [];
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; N('r' + k, Math.round(cx + RR * Math.cos(a)), Math.round(cy + RR * Math.sin(a))); ring.push('r' + k); }
        chain(ring.concat(['r0']), 'art', 'Ring Road', { ring: true });
        const DX = [420, 500, 580], DY = [250, 330, 410], d = (x, y) => 'd' + x + '_' + y;
        for (const x of DX) for (const y of DY) N(d(x, y), x, y);
        const rowNames = { 250: 'Court St', 330: 'Center St', 410: 'Market St' }, colNames = { 420: 'West Pl', 500: 'Grand Ave', 580: 'East Pl' };
        for (const y of DY) chain(DX.map(x => d(x, y)), y === 330 ? 'art' : 'st', rowNames[y]);
        for (const x of DX) chain(DY.map(y => d(x, y)), x === 500 ? 'art' : 'st', colNames[x]);
        // cardinal boulevards: edge -> ring -> downtown
        N('eE', 1060, 330, 'edge'); N('eW', -60, 330, 'edge'); N('eS', 500, 720, 'edge'); N('eN', 500, -60, 'edge');
        chain(['eE', 'r0', d(580, 330)], 'art', 'East Blvd');
        chain(['eS', 'r2', d(500, 410)], 'art', 'South Blvd');
        chain(['eW', 'r4', d(420, 330)], 'art', 'West Blvd');
        chain(['eN', 'r6', d(500, 250)], 'art', 'North Blvd');
        // diagonal parkways out to the corners, each with a suburban junction
        const diag = [[1, 'Harbor Pkwy'], [3, 'Lakeside Dr'], [5, 'Mill Rd'], [7, 'Airport Rd']];
        for (const [k, name] of diag) {
          const a = k * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a);
          N('m' + k, Math.round(cx + 380 * ux), Math.round(cy + 330 * uy));
          N('x' + k, Math.round(cx + 640 * ux), Math.round(cy + 520 * uy), 'edge');
          chain(['x' + k, 'm' + k, 'r' + k], 'st', name);
        }
        // suburban cross streets linking the parkways to the boulevards
        R('m1', 'r0', 'st', 'Eastfield Rd'); R('m1', 'r2', 'st', 'Dock Rd');
        R('m3', 'r4', 'st', 'Lake Rd'); R('m5', 'r4', 'st', 'Mill Ln'); R('m5', 'r6', 'st', 'Hill St'); R('m7', 'r6', 'st', 'Summit Ave'); R('m7', 'r0', 'st', 'Field Rd');
      },
      demand({ zone, edgeSrc, edgeSnk, ring, G }) {
        const CORE = zone(n => Math.hypot(n.x - 500, n.y - 330) < 140), RING = ring;
        const IN = edgeSrc(() => true), OUT = edgeSnk(() => true);
        const SUB = zone(n => Math.hypot(n.x - 500, n.y - 330) > 240);
        return [
          G(1500, IN, CORE),
          G(380, CORE, OUT),
          G(650, IN, OUT),
          G(320, RING, CORE),
          G(260, CORE, RING),
          G(300, SUB, CORE),
          G(260, RING, RING),
        ];
      },
    },
  };

  function make(layoutId) {
  const LAY = LAYOUTS[layoutId] || LAYOUTS.portside;
  // ---------------------------------------------------------------- network
  const nodes = [], byName = {}, roads = [];
  function N(name, x, y, type) { const n = { i: nodes.length, name, x, y, type: type || '', ins: [], outs: [], roads: [], r: 0 }; nodes.push(n); byName[name] = n; }
  function R(a, b, cls, name, opt) { const r = Object.assign({ i: roads.length, a: byName[a], b: byName[b], cls, name }, opt || {}); r.a.roads.push(r); r.b.roads.push(r); roads.push(r); }
  function chain(ns, cls, name, opt) { for (let i = 0; i < ns.length - 1; i++) R(ns[i], ns[i + 1], cls, name, opt); }
  LAY.build({ N, R, chain });

  for (const n of nodes) {
    if (!n.type) n.type = n.roads.length >= 3 ? 'signal' : 'bend';
    const m = Math.max(...n.roads.map(r => hw(r)));
    n.r = n.type === 'edge' ? 0 : n.type === 'hwy' ? 16 : n.type === 'signal' ? m + 3.2 : m + 0.4;
    n.hwMax = m;
  }

  const links = [];
  for (const r of roads) {
    for (const [A, B] of r.oneway ? [[r.a, r.b]] : [[r.a, r.b], [r.b, r.a]]) {
      const c = CLS[r.cls], dx = B.x - A.x, dy = B.y - A.y, D = Math.hypot(dx, dy), ux = dx / D, uy = dy / D;
      const L = {
        i: links.length, road: r, from: A.i, to: B.i, cls: r.cls, lanes: c.lanes, v0: c.v0, med: r.oneway ? -c.lanes * LW / 2 : c.med,
        ux, uy, nx: -uy, ny: ux, x0: A.x + ux * A.r, y0: A.y + uy * A.r, len: D - A.r - B.r,
        source: A.type === 'edge', sink: B.type === 'edge', grp: 0,
      };
      L.x1 = L.x0 + ux * L.len; L.y1 = L.y0 + uy * L.len;
      links.push(L); A.outs.push(L.i); B.ins.push(L.i); (r.links || (r.links = [])).push(L.i);
    }
  }
  const NL = links.length;
  const laneOff = (L, k) => L.med + (k + 0.5) * LW;
  function lanePt(L, k, s, off) {
    const o = off === undefined ? laneOff(L, k) : off;
    return [L.x0 + L.ux * s + L.nx * o, L.y0 + L.uy * s + L.ny * o];
  }

  // signals: two phases (N-S vs E-W), green split by approach weight, green-wave offsets
  for (const n of nodes) {
    if (n.type !== 'signal') continue;
    const w = [0, 0];
    for (const li of n.ins) {
      const L = links[li], ref = links[n.ins[0]];
      L.grp = LAY.relativeSignals ? (Math.abs(L.ux * ref.ux + L.uy * ref.uy) > 0.7071 ? 0 : 1) : (Math.abs(L.uy) > Math.abs(L.ux) ? 0 : 1);
      w[L.grp] += L.lanes * (L.cls === 'art' ? 1.5 : L.cls === 'ramp' ? 2.2 : 1);
    }
    n.C = 60; const G = n.C - 8;
    n.g0 = Math.max(16, Math.min(G - 16, Math.round(G * w[0] / (w[0] + w[1]))));
    n.g1 = G - n.g0;
    n.off = (((-n.x / 13 - n.y / 40) % n.C) + n.C) % n.C;
  }
  // 2 = green, 1 = yellow, 0 = red
  function sig(n, grp, t) {
    const tau = (((t + n.off) % n.C) + n.C) % n.C;
    if (tau < n.g0) return grp === 0 ? 2 : 0;
    if (tau < n.g0 + 3) return grp === 0 ? 1 : 0;
    if (tau < n.g0 + 4) return 0;
    const t2 = tau - n.g0 - 4;
    if (t2 < n.g1) return grp === 1 ? 2 : 0;
    if (t2 < n.g1 + 3) return grp === 1 ? 1 : 0;
    return 0;
  }

  // movements
  const moves = [], movesFrom = links.map(() => []), movesTo = links.map(() => []), moveMap = new Map();
  for (const n of nodes) {
    if (n.type === 'edge') continue;
    for (const ii of n.ins) {
      const I = links[ii];
      for (const oi of n.outs) {
        const O = links[oi];
        if (O.to === I.from) continue;
        const cr = I.ux * O.uy - I.uy * O.ux, dt = I.ux * O.ux + I.uy * O.uy, th = Math.atan2(cr, dt);
        if (n.type === 'hwy' && Math.abs(th) > 1.4) continue;
        const turn = Math.abs(th) < 0.45 ? 'S' : (th > 0 ? 'R' : 'L');
        const m = { i: moves.length, from: ii, to: oi, node: n.i, turn, th, ctrl: n.type === 'signal' ? 'signal' : 'free' };
        m.vt = turn === 'S' ? 99 : Math.abs(th) < 0.9 ? 13 : (turn === 'R' ? 6.5 : 8);
        moves.push(m); movesFrom[ii].push(m); movesTo[oi].push(m); moveMap.set(ii * 4096 + oi, m);
      }
    }
  }
  for (const O of links) {
    const f = movesTo[O.i].filter(m => m.ctrl === 'free');
    if (f.length > 1) {
      f.sort((a, b) => (CLS[links[b.from].cls].pri - CLS[links[a.from].cls].pri) || (Math.abs(a.th) - Math.abs(b.th)));
      for (let i = 1; i < f.length; i++) f[i].ctrl = 'yield';
    }
  }
  for (const m of moves) {
    m.pen = m.ctrl === 'signal' ? (m.turn === 'S' ? 6 : m.turn === 'R' ? 8 : 12) : m.ctrl === 'yield' ? 4 : (m.turn === 'S' ? 0 : 2);
    const I = links[m.from], O = links[m.to], dmin = [];
    m.tgt = [];
    for (let k = 0; k < I.lanes; k++) {
      const [x, y] = lanePt(I, k, I.len), ds = [];
      for (let j = 0; j < O.lanes; j++) { const [x2, y2] = lanePt(O, j, 0); ds.push([Math.hypot(x2 - x, y2 - y), j]); }
      ds.sort((a, b) => a[0] - b[0]); m.tgt.push(ds.map(d => d[1])); dmin.push(ds[0][0]);
    }
    m.pref = -1;
    if (I.lanes > 1) {
      let lo = 0; for (let k = 1; k < I.lanes; k++) if (dmin[k] < dmin[lo]) lo = k;
      if (Math.max(...dmin) - dmin[lo] > 2) m.pref = lo;
    }
  }

  // connectors: quadratic bezier through the intersection box
  function bez(c, u) {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
    return [a * c.x0 + b * c.x1 + d * c.x2, a * c.y0 + b * c.y1 + d * c.y2];
  }
  function mkConn(I, k, O, j) {
    const [x0, y0] = lanePt(I, k, I.len), [x2, y2] = lanePt(O, j, 0);
    let x1 = (x0 + x2) / 2, y1 = (y0 + y2) / 2;
    const den = I.ux * O.uy - I.uy * O.ux;
    if (Math.abs(den) > 0.08) {
      const rx = x2 - x0, ry = y2 - y0, a = (rx * O.uy - ry * O.ux) / den, b = (I.ux * ry - I.uy * rx) / den;
      if (a > 0 && b > 0) { x1 = x0 + I.ux * a; y1 = y0 + I.uy * a; }
    }
    const c = { x0, y0, x1, y1, x2, y2, ux: I.ux, uy: I.uy, lut: [0], n: 12 };
    let px = x0, py = y0, acc = 0;
    for (let i = 1; i <= c.n; i++) { const [x, y] = bez(c, i / c.n); acc += Math.hypot(x - px, y - py); c.lut.push(acc); px = x; py = y; }
    c.len = Math.max(acc, 0.5);
    return c;
  }
  function connAt(c, d) {
    d = Math.max(0, Math.min(c.len, d));
    let i = 1; while (i < c.n && c.lut[i] < d) i++;
    const seg = c.lut[i] - c.lut[i - 1], f = seg > 1e-6 ? (d - c.lut[i - 1]) / seg : 0;
    return bez(c, (i - 1 + f) / c.n);
  }
  const connCache = new Map();
  function getConn(Li, k, Mi, j) {
    const key = ((Li * 4 + k) * 4096 + Mi) * 4 + j;
    let c = connCache.get(key);
    if (!c) { c = mkConn(links[Li], k, links[Mi], j); const m = moveMap.get(Li * 4096 + Mi); c.vt = m ? m.vt : 99; connCache.set(key, c); }
    return c;
  }

  // ---------------------------------------------------------------- routing
  const isMid = L => !L.source && !L.sink && (L.cls === 'st' || L.cls === 'art');
  const DESTS = links.filter(L => isMid(L) || L.sink).map(L => L.i);
  const FREE_COST = Float64Array.from(links, L => L.len / L.v0);
  function routeTable(cost) {
    const tbl = new Array(NL).fill(null);
    const dist = new Float64Array(NL), done = new Uint8Array(NL);
    for (const D of DESTS) {
      dist.fill(Infinity); done.fill(0);
      for (const m of movesTo[D]) if (m.pen < dist[m.from]) dist[m.from] = m.pen;
      for (;;) {
        let bi = -1, bv = Infinity;
        for (let i = 0; i < NL; i++) if (!done[i] && dist[i] < bv) { bv = dist[i]; bi = i; }
        if (bi < 0) break;
        done[bi] = 1;
        const base = bv + cost[bi];
        for (const m of movesTo[bi]) { const c = base + m.pen; if (c < dist[m.from]) dist[m.from] = c; }
      }
      tbl[D] = Float64Array.from(dist);
    }
    return tbl;
  }
  const RT_FREE = routeTable(FREE_COST);

  function chooseNext(w, c, L) {
    if (L.sink || c.dest === L.i) return -1;
    const tbl = c.inf ? w.rt : RT_FREE, cost = c.inf ? w.lcost : FREE_COST, T = tbl[c.dest];
    let best = -1, bc = Infinity;
    for (const m of movesFrom[L.i]) {
      const M = m.to; let v;
      if (M === c.dest) v = m.pen + cost[M] * (c.destS / links[M].len);
      else { const r = T[M]; if (!isFinite(r)) continue; v = m.pen + cost[M] + r; }
      v *= 0.9 + 0.2 * hash01(c.seed, L.i, M);
      if (v < bc) { bc = v; best = M; }
    }
    return best;
  }

  // ---------------------------------------------------------------- demand
  const src = n => links.find(L => nodes[L.from].name === n).i;
  const snk = n => links.find(L => nodes[L.to].name === n).i;
  const zone = f => links.filter(L => isMid(L) && f(nodes[L.from]) && f(nodes[L.to])).map(L => L.i);
  const edgeSrc = f => links.filter(L => L.source && f(nodes[L.from])).map(L => L.i);
  const edgeSnk = f => links.filter(L => L.sink && f(nodes[L.to])).map(L => L.i);
  const DEMAND = LAY.demandScale || 1;
  function G(vph, O, D) {
    const w = a => a.map(i => links[i].sink || links[i].source ? 1 : links[i].len);
    const Ow = w(O), Dw = w(D);
    return { rate: vph * DEMAND / 3600, O, Ow, Ot: Ow.reduce((a, b) => a + b, 0), D, Dw, Dt: Dw.reduce((a, b) => a + b, 0) };
  }
  const GENS = LAY.demand({ src, snk, zone, edgeSrc, edgeSnk, G, ring: links.filter(L => L.road.ring).map(L => L.i) });
  const KINDS = [
    { len: 4.5, w: 1.85, a: 1.5, b: 2.0, T: 1.3, p: 0.84, vf: 1 },
    { len: 5.4, w: 2.0, a: 1.3, b: 2.0, T: 1.4, p: 0.07, vf: 0.97 },
    { len: 9.5, w: 2.4, a: 0.8, b: 1.6, T: 1.7, p: 0.07, vf: 0.86 },
    { len: 12, w: 2.55, a: 0.9, b: 1.6, T: 1.6, p: 0.02, vf: 0.9 },
  ];
  function pickKind(x) { for (let i = 0; i < KINDS.length; i++) { x -= KINDS[i].p; if (x <= 0) return i; } return 0; }
  function pickW(r, arr, wts, tot) { let x = rnd(r) * tot; for (let i = 0; i < arr.length; i++) { x -= wts[i]; if (x <= 0) return arr[i]; } return arr[arr.length - 1]; }
  function makeSpec(Gn, r) {
    for (let tries = 0; tries < 6; tries++) {
      const o = pickW(r, Gn.O, Gn.Ow, Gn.Ot), L = links[o];
      const s = L.source ? 0 : 14 + rnd(r) * Math.max(1, L.len - 40);
      const d = pickW(r, Gn.D, Gn.Dw, Gn.Dt), D = links[d];
      const dS = D.sink ? D.len - 1 : 12 + rnd(r) * Math.max(1, D.len - 30);
      const kr = rnd(r), seed = (rnd(r) * 2147483647) | 0, inf = rnd(r) < INFORMED, col = rnd(r);
      if (d === o) { if (dS < s + 25) continue; } else if (!isFinite(RT_FREE[d][o])) continue;
      return { o, s, d, dS, kind: pickKind(kr), seed, inf, col };
    }
    return null;
  }

  // ---------------------------------------------------------------- world
  function newWorld(seed) {
    const w = {
      t: 0, cars: [], lanes: links.map(L => Array.from({ length: L.lanes }, () => [])),
      gens: GENS.map((gn, i) => ({ next: 0, r: { s: (seed * 7919 + i * 104729) | 0 } })),
      wait: links.map(() => []), ema: Float64Array.from(links, L => L.v0), lcost: Float64Array.from(FREE_COST),
      rt: RT_FREE, nextRT: 3, nextEma: 0, nextFlow: 10, delay: 0, delayLink: new Float64Array(NL), arrived: 0,
      nid: 1, crash: null, rub: null, flowCnt: new Float64Array(NL), flow: new Float64Array(NL), stopped: 0, waiting: 0,
    };
    for (const gs of w.gens) gs.next = -Math.log(1 - rnd(gs.r)) / GENS[w.gens.indexOf(gs)].rate;
    return w;
  }
  function clone(w) {
    const n = Object.assign({}, w), map = new Map();
    n.cars = w.cars.map(c => { const d = Object.assign({}, c); map.set(c, d); return d; });
    n.lanes = w.lanes.map(LA => LA.map(arr => arr.map(c => map.get(c))));
    n.gens = w.gens.map(gs => ({ next: gs.next, r: { s: gs.r.s } }));
    n.wait = w.wait.map(q => q.slice());
    n.ema = w.ema.slice(); n.lcost = w.lcost.slice(); n.delayLink = w.delayLink.slice();
    n.flowCnt = w.flowCnt.slice(); n.flow = w.flow.slice();
    n.crash = w.crash ? Object.assign({}, w.crash) : null;
    return n;
  }
  function insertSorted(arr, c) {
    let j = arr.length; while (j > 0 && arr[j - 1].s < c.s) j--;
    arr.splice(j, 0, c);
  }

  function tryInsert(w, sp) {
    const L = links[sp.o], K = KINDS[sp.kind], front = L.source ? K.len + 0.5 : sp.s;
    let bestK = -1, bestGap = -1, bestV = 0;
    for (let k = 0; k < L.lanes; k++) {
      if (!L.source && k !== L.lanes - 1) continue;
      const arr = w.lanes[L.i][k]; let ahead = null, behind = null;
      for (let j = arr.length - 1; j >= 0; j--) { const o = arr[j]; if (o.s > front) { ahead = o; break; } behind = o; }
      const ga = ahead ? ahead.s - ahead.len - front : 1e9, gb = behind ? front - K.len - behind.s : 1e9;
      const vIn = L.source ? Math.min(L.v0 * 0.9, ahead ? ahead.v + 2 : L.v0) : 0;
      if (ga < 3 + vIn * 1.1 || gb < Math.max(5, (behind ? behind.v : 0) * 1.5)) continue;
      if (ga > bestGap) { bestGap = ga; bestK = k; bestV = vIn; }
    }
    if (bestK < 0) return false;
    const v = bestV;
    const c = {
      id: w.nid++, l: L.i, k: bestK, s: front, v, acc: 0, len: K.len, wid: K.w, a: K.a, b: K.b,
      T: K.T * (0.85 + 0.3 * hash01(sp.seed, 1, 2)), s0: 2, v0f: K.vf * (0.9 + 0.2 * hash01(sp.seed, 3, 4)),
      dest: sp.d, destS: sp.dS, next: -1, tl: -1, com: false, conn: null, mv: null, inf: sp.inf, seed: sp.seed,
      col: sp.col, kind: sp.kind, lcT: 1, lcFrom: 0, lastLC: -99, born: w.t, stuck: 0, crash: false, stop: false,
    };
    insertSorted(w.lanes[L.i][bestK], c); w.cars.push(c);
    c.next = chooseNext(w, c, L); c.mv = c.next >= 0 ? moveMap.get(L.i * 4096 + c.next) : null;
    return true;
  }

  function idm(c, v0, gap, dv) {
    const v = c.v;
    const accFree = Math.max(-2.5, c.a * (1 - Math.pow(v / v0, 4)));
    if (gap === Infinity) return accFree;
    const ss = c.s0 + Math.max(0, v * c.T + v * dv / (2 * Math.sqrt(c.a * c.b))), g = Math.max(gap, 0.1);
    return Math.max(-9, accFree - c.a * (ss * ss) / (g * g));
  }

  function desiredV(w, c, L) {
    let v0 = L.v0 * c.v0f;
    if (c.s < 0 && c.conn) v0 = Math.min(v0, c.conn.vt);
    if (c.mv && c.mv.turn !== 'S') { const d = L.len - c.s, vt = c.mv.vt; v0 = Math.min(v0, Math.sqrt(vt * vt + 3 * Math.max(0, d))); }
    if (w.rub) {
      const r = w.rub[L.i];
      if (r) {
        const vr = Math.max(7, 0.5 * L.v0);
        if (c.s > r[0] && c.s < r[1]) v0 = Math.min(v0, vr);
        else if (c.s <= r[0]) v0 = Math.min(v0, Math.sqrt(vr * vr + 3 * (r[0] - c.s)));
      }
    }
    return Math.max(v0, 1);
  }

  function nearestAhead(arr, s) { for (let j = arr.length - 1; j >= 0; j--) if (arr[j].s > s) return arr[j]; return null; }

  function pickTarget(w, c, L, M, m) {
    const order = m.tgt[c.k];
    if (order.length === 1) return order[0];
    let best = order[0], bs = Infinity;
    for (let idx = 0; idx < order.length; idx++) {
      const j = order[idx], arr = w.lanes[M.i][j], tail = arr[arr.length - 1];
      let sc = idx * (m.turn === 'S' ? 4 : 20);
      if (tail) { const room = tail.s - tail.len; if (room < c.len + 3 && tail.v < 4) sc += 40; sc -= Math.min(Math.max(room, 0), 80) * 0.08; }
      else sc -= 6.4;
      if (w.crash && !w.crash.cleared && w.crash.l === M.i && w.crash.k === j && w.crash.s < 90) sc += 30;
      if (sc < bs) { bs = sc; best = j; }
    }
    return best;
  }

  function permit(w, c, L, M, m, tl, dist) {
    if (m.ctrl === 'free') return true;
    if (m.ctrl === 'signal') {
      const st = sig(nodes[m.node], L.grp, w.t);
      if (st === 0) return false;
      if (st === 1 && c.v * c.v / 6 < dist - 1) return false;
    }
    const arr = w.lanes[M.i][tl], Lc = getConn(L.i, c.k, M.i, tl).len, entry = -Lc;
    let ahead = null, behind = null;
    for (let j = arr.length - 1; j >= 0; j--) { const o = arr[j]; if (o.s > entry) { ahead = o; break; } behind = o; }
    if (ahead) {
      const rear = ahead.s - ahead.len;
      if (m.ctrl === 'signal' && ahead.v < 4 && rear < c.len + 1.5) return false; // don't block the box
      if (rear - entry < 3) return false;
    }
    if (behind && (entry - c.len) - behind.s < Math.max(2, behind.v * 0.9)) return false;
    if (m.ctrl === 'yield') {
      const myT = Math.min(dist / Math.max(c.v, 2), 2) + 1.6;
      for (const pm of movesTo[M.i]) {
        if (pm.ctrl !== 'free') continue;
        const P = links[pm.from];
        for (let kk = 0; kk < P.lanes; kk++) {
          const pa = w.lanes[P.i][kk];
          for (let q = 0; q < Math.min(2, pa.length); q++) {
            const f = pa[q];
            if (f.next !== M.i || (f.tl >= 0 && f.tl !== tl)) continue;
            const d = P.len - f.s;
            if (d < 90 && d / Math.max(f.v, 1) < myT) return false;
          }
        }
      }
    }
    return true;
  }

  // gap and speed difference to whatever constrains the lane leader
  function endGap(w, c, L) {
    c.stop = false;
    if (L.sink || c.dest === L.i || c.next < 0) return [Infinity, 0];
    const dist = L.len - c.s, M = links[c.next], m = c.mv;
    if (!c.com) {
      if (dist > 150) return [Infinity, 0];
      c.tl = pickTarget(w, c, L, M, m);
      if (!permit(w, c, L, M, m, c.tl, dist)) { c.stop = true; return [dist - 0.5, c.v]; }
      if (dist < c.v * c.v / 5 + c.v * 0.3 + 2) c.com = true;
    }
    const Lc = getConn(L.i, c.k, M.i, c.tl).len, ld = nearestAhead(w.lanes[M.i][c.tl], -Lc);
    if (!ld) return [Infinity, 0];
    return [dist + Lc + ld.s - ld.len, c.v - ld.v];
  }

  function doLC(w, c, L, k2) {
    const arr = w.lanes[L.i][c.k], i = arr.indexOf(c);
    if (i >= 0) arr.splice(i, 1);
    const fromOff = c.lcT < 1 ? c.lcFrom + (laneOff(L, c.k) - c.lcFrom) * smooth(c.lcT) : laneOff(L, c.k);
    c.lcFrom = fromOff; c.lcT = 0; c.k = k2; c.lastLC = w.t; c.tl = -1;
    insertSorted(w.lanes[L.i][k2], c);
  }
  const smooth = x => x * x * (3 - 2 * x);

  function laneChanges(w) {
    const phase = Math.round(w.t / DT);
    for (const c of w.cars) {
      if (c.crash || c.s < 4 || ((c.id + phase) % 3) !== 0) continue;
      const L = links[c.l];
      // en-route rerouting for drivers with navigation apps
      if (c.inf && !c.com && c.next >= 0 && ((c.id + phase) % 21) === 0 && L.len - c.s > 35) {
        const nn = chooseNext(w, c, L);
        if (nn !== c.next && nn >= 0) { c.next = nn; c.mv = moveMap.get(L.i * 4096 + nn); c.tl = -1; }
      }
      if (L.lanes < 2 || c.com || w.t - c.lastLC < 2.5) continue;
      const dist = L.len - c.s;
      if (dist < 6) continue;
      const pref = c.mv ? c.mv.pref : -1, v0 = desiredV(w, c, L);
      let bestK = -1, bestGain = 0.3;
      for (const dk of [-1, 1]) {
        const k2 = c.k + dk; if (k2 < 0 || k2 >= L.lanes) continue;
        const a2 = w.lanes[L.i][k2]; let ld = null, fl = null;
        for (let j = 0; j < a2.length; j++) { const o = a2[j]; if (o.s > c.s) ld = o; else { fl = o; break; } }
        if (ld && ld.s - ld.len - c.s < 1) continue;
        if (fl && c.s - c.len - fl.s < 1) continue;
        const accNew = ld ? idm(c, v0, ld.s - ld.len - c.s, c.v - ld.v) : idm(c, v0, c.stop ? dist - 0.5 : Infinity, c.stop ? c.v : 0);
        let accF = 0;
        if (fl) {
          accF = idm(fl, desiredV(w, fl, L), c.s - c.len - fl.s, fl.v - c.v);
          if (accF < -(c.stuck > 12 ? 6 : 3.5)) continue;
        }
        let bias = 0;
        if (pref >= 0 && dist < 260) {
          const B = (0.4 + 2.5 * (1 - dist / 260)) * (c.stuck > 12 ? 0.2 : 1);
          bias = Math.abs(k2 - pref) < Math.abs(c.k - pref) ? B : -B;
        }
        const gain = accNew - c.acc + bias - 0.2 * Math.max(0, -accF);
        if (gain > bestGain) { bestGain = gain; bestK = k2; }
      }
      if (bestK >= 0) doLC(w, c, L, bestK);
    }
  }

  function updateEma(w) {
    for (let li = 0; li < NL; li++) {
      const L = links[li]; let sv = 0, n = 0;
      for (const arr of w.lanes[li]) for (const c of arr) if (c.s >= 0 && !c.crash) { sv += c.v; n++; }
      const target = n ? sv / n : L.v0;
      w.ema[li] += (target - w.ema[li]) * 0.3;
      let pen = 0;
      if (w.crash && !w.crash.cleared && w.crash.l === li) pen = L.lanes === 1 ? 240 : 30;
      w.lcost[li] = L.len / Math.max(w.ema[li], 0.6) + pen;
    }
  }

  function step(w) {
    const dt = DT; w.t += dt;
    for (let gi = 0; gi < GENS.length; gi++) {
      const Gn = GENS[gi], st = w.gens[gi];
      while (st.next <= w.t) { const sp = makeSpec(Gn, st.r); if (sp) w.wait[sp.o].push(sp); st.next += -Math.log(1 - rnd(st.r)) / Gn.rate; }
    }
    w.waiting = 0;
    for (let li = 0; li < NL; li++) {
      const q = w.wait[li]; if (!q.length) continue;
      if (tryInsert(w, q[0])) q.shift();
      if (q.length > 1 && !links[li].source && tryInsert(w, q[q.length - 1])) q.pop();
      w.delay += dt * q.length; w.delayLink[li] += dt * q.length; w.waiting += q.length;
    }
    if (w.crash && !w.crash.cleared && w.t >= w.crash.tClear) clearCrash(w);
    // the drivers in the wreck are stuck until the tow truck arrives
    if (w.crash && !w.crash.cleared) { w.delay += DT * w.crash.nv; w.delayLink[w.crash.l] += DT * w.crash.nv; }
    if (w.t >= w.nextEma) { updateEma(w); w.nextEma = w.t + 2; }
    if (w.t >= w.nextRT) { w.rt = routeTable(w.lcost); w.nextRT = w.t + 6; }
    if (w.t >= w.nextFlow) {
      for (let li = 0; li < NL; li++) { w.flow[li] = w.flow[li] * 0.5 + w.flowCnt[li] * 6 * 0.5; w.flowCnt[li] = 0; }
      w.nextFlow = w.t + 10;
    }
    // accelerations
    for (let li = 0; li < NL; li++) {
      const L = links[li], LA = w.lanes[li];
      for (let k = 0; k < L.lanes; k++) {
        const arr = LA[k];
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i]; if (c.crash) { c.acc = 0; continue; }
          const v0 = desiredV(w, c, L);
          if (i > 0) { const ld = arr[i - 1]; c.acc = idm(c, v0, ld.s - ld.len - c.s, c.v - ld.v); c.stop = false; }
          else { const eg = endGap(w, c, L); c.acc = idm(c, v0, eg[0], eg[1]); }
        }
      }
    }
    laneChanges(w);
    // integrate
    let stopped = 0;
    for (const c of w.cars) {
      if (c.crash) continue;
      let v1 = c.v + c.acc * dt, ds;
      if (v1 < 0) { ds = c.acc < 0 ? -c.v * c.v / (2 * c.acc) : 0; v1 = 0; } else ds = (c.v + v1) * 0.5 * dt;
      c.s += ds; c.v = v1;
      if (c.lcT < 1) c.lcT = Math.min(1, c.lcT + dt / 2.2);
      const L = links[c.l], d = dt * Math.max(0, 1 - c.v / L.v0);
      w.delay += d; w.delayLink[c.l] += d;
      if (c.v < 1) { stopped++; c.stuck += dt; } else if (c.v > 3) c.stuck = 0;
    }
    w.stopped = stopped;
    // overlap guard, arrivals, transfers
    let dead = false;
    for (let li = 0; li < NL; li++) {
      const L = links[li], LA = w.lanes[li];
      for (let k = 0; k < L.lanes; k++) {
        const arr = LA[k];
        for (let i = 1; i < arr.length; i++) {
          const ld = arr[i - 1], c = arr[i], mx = ld.s - ld.len - 0.3;
          if (c.s > mx) { c.s = mx; if (c.v > ld.v) c.v = ld.v; }
        }
        for (let i = arr.length - 1; i >= 0; i--) {
          const c = arr[i];
          if (c.dest === li && c.s >= c.destS && !c.crash) { arr.splice(i, 1); c.dead = true; dead = true; w.arrived++; }
        }
        while (arr.length && arr[0].s >= L.len && !arr[0].crash) {
          const c = arr[0];
          if (L.sink || c.next < 0) { arr.shift(); c.dead = true; dead = true; w.arrived++; w.flowCnt[li]++; continue; }
          if (!c.com) { c.s = L.len - 0.01; c.v = 0; break; }
          const M = links[c.next], tl = c.tl, cn = getConn(li, c.k, M.i, tl);
          arr.shift();
          c.s = c.s - L.len - cn.len; c.l = M.i; c.k = tl; c.conn = cn; c.com = false; c.lcT = 1; c.tl = -1;
          insertSorted(w.lanes[M.i][tl], c);
          w.flowCnt[li]++;
          c.next = chooseNext(w, c, M); c.mv = c.next >= 0 ? moveMap.get(M.i * 4096 + c.next) : null;
        }
      }
    }
    if (dead) w.cars = w.cars.filter(c => !c.dead);
  }

  function rubberIntervals(x, y) {
    const out = {};
    for (const L of links) {
      let a = Infinity, b = -Infinity;
      for (let s = 0; s <= L.len; s += 4) {
        const px = L.x0 + L.ux * s, py = L.y0 + L.uy * s;
        if (Math.hypot(px - x, py - y) < 55) { a = Math.min(a, s); b = Math.max(b, s); }
      }
      if (a <= b) out[L.i] = [a - 2, b + 2];
    }
    return out;
  }

  // base (optional): the no-crash comparison city; the wrecked cars are removed from it too,
  // so the only difference between the two cities is the blocked lane
  function applyCrash(w, li, k, s, base) {
    const L = links[li], arr = w.lanes[li][k];
    const front = Math.min(L.len - 3, Math.max(20, s + 5)), CLEN = 18;
    const victims = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i];
      if (c.s > front - CLEN - 3 && c.s - c.len < front + 2) { victims.push(c); arr.splice(i, 1); c.dead = true; }
    }
    w.cars = w.cars.filter(c => !c.dead);
    if (base) {
      const gone = new Set(victims.map(v => v.id));
      for (const LA of base.lanes) for (const arr of LA) for (let i = arr.length - 1; i >= 0; i--) if (gone.has(arr[i].id)) arr.splice(i, 1);
      base.cars = base.cars.filter(c => !gone.has(c.id));
      base.nid = w.nid + 1; // keep new car ids in step
    }
    const cr = { id: w.nid++, crash: true, l: li, k, s: front, v: 0, acc: 0, len: CLEN, wid: 2, conn: null, lcT: 1, dest: -1, next: -1, stuck: 0 };
    insertSorted(arr, cr); w.cars.push(cr);
    const [x, y] = lanePt(L, k, front - 5);
    w.crash = { nv: Math.max(2, victims.length), l: li, k, s: front, t0: w.t, tClear: w.t + CLEAR_T, id: cr.id, x, y, cleared: false, cols: victims.map(v => v.col).concat([0.3, 0.7]).slice(0, 2) };
    w.rub = rubberIntervals(x, y);
    // navigation apps learn about the crash quickly
    w.nextEma = w.t + 0.5; w.nextRT = w.t + 1;
  }
  // give the no-crash comparison city the same route refresh the crash city gets, so only the crash differs
  function syncBaseline(b) { b.nextEma = b.t + 0.5; b.nextRT = b.t + 1; }
  function clearCrash(w) {
    const cr = w.crash, arr = w.lanes[cr.l][cr.k], i = arr.findIndex(c => c.crash);
    if (i >= 0) arr.splice(i, 1);
    w.cars = w.cars.filter(c => !c.crash);
    cr.cleared = true; cr.tCleared = w.t; w.rub = null;
  }

  function carPoint(c, s) {
    const L = links[c.l];
    if (s >= 0) {
      const off = c.lcT < 1 ? c.lcFrom + (laneOff(L, c.k) - c.lcFrom) * smooth(c.lcT) : laneOff(L, c.k);
      return lanePt(L, c.k, s, off);
    }
    const cn = c.conn;
    if (cn) {
      if (s >= -cn.len) return connAt(cn, cn.len + s);
      const e = -cn.len - s; return [cn.x0 - cn.ux * e, cn.y0 - cn.uy * e];
    }
    return lanePt(L, c.k, s);
  }

  function linkLabel(L) {
    const r = L.road, a = nodes[L.from].name, b = nodes[L.to].name;
    if (r.cls === 'ramp') {
      const hwyEnd = nodes[L.to].type === 'hwy' ? nodes[L.to] : nodes[L.from];
      const east = hwyEnd.name === 'HB' || hwyEnd.name === 'HD';
      const street = r.name.replace(' ramp', '');
      return nodes[L.to].type === 'hwy'
        ? `${street} on-ramp · ${east ? 'eastbound' : 'westbound'}`
        : `${street} exit · from ${east ? 'westbound' : 'eastbound'}`;
    }
    if (r.ring) { const f = nodes[L.from], cx = (LAY.world.x0 + LAY.world.x1) / 2, cy = (LAY.world.y0 + LAY.world.y1) / 2; return `${r.name} · ${((f.x - cx) * L.uy - (f.y - cy) * L.ux) > 0 ? 'clockwise' : 'anticlockwise'}`; }
    const dir = Math.abs(L.ux) > Math.abs(L.uy) ? (L.ux > 0 ? 'eastbound' : 'westbound') : (L.uy > 0 ? 'southbound' : 'northbound');
    return `${r.name} · ${dir}`;
  }

  return {
    LW, DT, CLEAR_T, RUN_T, CLS, KINDS, nodes, links, roads, moves, hw, laneOff, lanePt, sig, getConn, connAt,
    newWorld, clone, step, applyCrash, syncBaseline, carPoint, linkLabel, rnd, layout: LAY,
  };
  }

  return { make, LAYOUTS, LW, DT, CLEAR_T, RUN_T, rnd, hw };
})();
if (typeof module !== 'undefined') module.exports = SIM;
