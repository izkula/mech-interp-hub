/* Snarl finale: a cinematic 3D replay of a flatbed tow truck clearing your crash while the score counts up.
 * three.js r128 (cdnjs) plus its bloom post-processing (jsdelivr), loaded on demand. Everything is built
 * from primitives and canvas textures; each replay is varied (weather, time, car, tow company, cameras).
 */
const Tow = (function () {
  'use strict';
  const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const EX = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
  const EXTRAS = ['shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js'];
  function script(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = () => res(); s.onerror = () => rej(new Error('failed: ' + src)); document.head.appendChild(s); });
  }
  let loading = null;
  function load() {
    if (!loading) {
      loading = (window.THREE ? Promise.resolve() : script(BASE))
        .then(async () => { for (const f of EXTRAS) { try { await script(EX + f); } catch (e) { break; } } })
        .catch(e => { loading = null; throw e; });
    }
    return loading;
  }
  const hasPost = () => !!(window.THREE && THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass && THREE.UnrealBloomPass && THREE.CopyShader && THREE.LuminosityHighPassShader);

  // ---------------------------------------------------------------- small helpers
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = x => { x = clamp01(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
  const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, u) => a + (b - a) * u;
  const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  function rng(seed) { let s = (seed | 0) || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const bez3 = (p, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); };

  // ---------------------------------------------------------------- the scene
  function build(opts, R, renderer) {
    const T = THREE;
    const pick = a => a[Math.floor(R() * a.length)];
    const lin = h => new T.Color(h).convertSRGBToLinear();
    const scene = new T.Scene();
    const disposables = [];
    const tex = (w, h, draw, srgb = true) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; if (srgb) t.encoding = T.sRGBEncoding; disposables.push(t); return t;
    };

    // ---- the look of this replay
    const env = opts.cls === 'hwy' || opts.cls === 'ramp' ? 'freeway' : opts.bridge ? 'bridge' : 'street';
    const weather = pick(['clear', 'clear', 'drizzle', 'rain', 'rain', 'fog']);
    const time = pick(['night', 'night', 'night', 'bluehour', 'dawn']);
    const wet = weather !== 'clear' || R() < 0.35;
    const SKY = {
      night: { top: '#020409', hor: '#161c2c', glow: '#3b2a18', hemi: 0.22, moon: 0.14 },
      bluehour: { top: '#081530', hor: '#2c4470', glow: '#8a4a28', hemi: 0.5, moon: 0.28 },
      dawn: { top: '#101a38', hor: '#9a6250', glow: '#e08850', hemi: 0.55, moon: 0.3 },
    }[time];
    const fogCol = lin(SKY.hor).multiplyScalar(weather === 'fog' ? 1.1 : 0.7);
    scene.fog = new T.FogExp2(fogCol, weather === 'fog' ? 0.05 : weather === 'rain' ? 0.022 : 0.012);
    scene.background = fogCol.clone();

    const std = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: 0.6, metalness: 0 }, o || {}));
    const paint = (c, o) => new T.MeshPhysicalMaterial(Object.assign({ color: lin(c), metalness: 0.55, roughness: wet ? 0.24 : 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 }, o || {}));
    const glow = (c, i) => new T.MeshStandardMaterial({ color: 0x000000, emissive: lin(c), emissiveIntensity: i, roughness: 0.3 });
    const chrome = new T.MeshStandardMaterial({ color: lin('#d8dde3'), metalness: 1, roughness: 0.14, envMapIntensity: 1.4 });
    const alloy = new T.MeshStandardMaterial({ color: lin('#b9bec6'), metalness: 0.9, roughness: 0.28 });
    const rubber = std('#141518', { roughness: 0.85 });
    const plastic = std('#15171b', { roughness: 0.55 });
    const glass = new T.MeshPhysicalMaterial({ color: lin('#0b1119'), metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.72, clearcoat: 1, envMapIntensity: 1.6 });
    const mesh = (geo, mat, cast = true) => { const m = new T.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };
    const box = (w, h, d, mat, cast) => mesh(new T.BoxGeometry(w, h, d), mat, cast);
    const cyl = (r1, r2, h, mat, seg = 16) => mesh(new T.CylinderGeometry(r1, r2, h, seg), mat);
    function beam(p1, p2, th, mat, parent) {
      const a = new T.Vector3(...p1), b = new T.Vector3(...p2), d = b.clone().sub(a), m = box(th, d.length(), th, mat);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); parent.add(m); return m;
    }
    function extrude(pts, depth, bevel, mat, curves) {
      const sh = new T.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]); else if (p.length === 5) sh.absarc(p[0], p[1], p[2], p[3], p[4], true); else sh.lineTo(p[0], p[1]); }
      const geo = new T.ExtrudeGeometry(sh, { depth: Math.max(0.01, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curves || 10 });
      geo.translate(0, 0, -(depth - 2 * bevel) / 2); geo.computeVertexNormals();
      return mesh(geo, mat);
    }
    // soft dark patch under things so they sit on the ground
    const aoTex = tex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }, false);
    function contact(parent, L, W, y = 0.012, o = 0.8) {
      const m = new T.Mesh(new T.PlaneGeometry(L, W), new T.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: o, depthWrite: false, color: 0x000000 }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 1; parent.add(m); return m;
    }
    const glowTex = tex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
    // i = 0 means 'starts switched off': full colour, but invisible until its opacity is raised
    const haloK = opts.post ? 0.42 : 1;
    const halo = (parent, x, y, z, color, size0, i = 1) => { const size = size0 * haloK; const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: lin(color).multiplyScalar(i || 1.3), blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: i ? 1 : 0 })); s.position.set(x, y, z); s.scale.set(size, size, size); parent.add(s); return s; };

    // ---- sky: gradient dome, stars and moon on clear nights, a distant skyline
    const sky = new T.Mesh(new T.SphereGeometry(400, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: lin(SKY.top) }, hor: { value: lin(SKY.hor) }, glw: { value: lin(SKY.glow) } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top, hor, glw; varying vec3 vp; void main(){ float h = clamp(vp.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.42)); c += glw * exp(-h * 10.0) * 0.8; gl_FragColor = vec4(c, 1.0); }',
    }));
    scene.add(sky);
    if (weather === 'clear' && time !== 'dawn') {
      const n = 900, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, e = 0.12 + R() * 1.3; pos.set([Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380], i * 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const stars = new T.Points(g, new T.PointsMaterial({ color: lin('#cfd8ff').multiplyScalar(time === 'night' ? 1.6 : 0.6), size: 1.3, sizeAttenuation: false, fog: false, depthWrite: false }));
      sky.add(stars);
      const moon = halo(sky, -170, 150, -300, '#dfe6ff', 60, 1.2); void moon;
      halo(sky, -170, 150, -300, '#9fb0ff', 220, 0.25);
    }

    // facades: a few window/facade textures shared by all buildings
    function facade(kind) {
      const lit = [];
      const map = tex(256, 512, (g, w, h) => {
        g.fillStyle = kind === 'brick' ? '#2a1c18' : kind === 'glass' ? '#0e1622' : '#1a1f27'; g.fillRect(0, 0, w, h);
        const cw = kind === 'glass' ? 16 : 32, ch = kind === 'glass' ? 20 : 40;
        for (let y = 8; y < h - 8; y += ch) for (let x = 6; x < w - 6; x += cw) {
          const r = Math.random(), on = r < (time === 'night' ? 0.28 : 0.18);
          lit.push([x, y, cw, ch, on ? (Math.random() < 0.8 ? 'w' : 'c') : '']);
          g.fillStyle = kind === 'glass' ? '#141e2c' : '#0b0f15'; g.fillRect(x + 3, y + 5, cw - 7, ch - 12);
          if (kind !== 'glass') { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 1, y + ch - 7, cw - 3, 2); }
        }
      });
      const emi = tex(256, 512, (g, w, h) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
        for (const [x, y, cw, ch, k] of lit) {
          if (!k) continue;
          const warm = k === 'w', a = 0.35 + Math.random() * 0.65;
          const grd = g.createLinearGradient(0, y + 5, 0, y + ch - 7);
          grd.addColorStop(0, warm ? `rgba(255,200,130,${a})` : `rgba(160,200,255,${a})`); grd.addColorStop(1, warm ? `rgba(200,130,70,${a * 0.6})` : `rgba(90,130,200,${a * 0.6})`);
          g.fillStyle = grd; g.fillRect(x + 3, y + 5, cw - 7, ch - 12);
          if (Math.random() < 0.4) { g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.4})`; g.fillRect(x + 3 + Math.random() * (cw - 12), y + 5, 4 + Math.random() * 6, ch - 12); }
        }
      });
      map.wrapS = map.wrapT = emi.wrapS = emi.wrapT = T.RepeatWrapping;
      return [map, emi];
    }
    const FAC = ['brick', 'concrete', 'glass', 'concrete'].map(facade);
    function building(x, z, w, h, d, faceZ) {
      const [m0, e0] = pick(FAC), map = m0.clone(), emi = e0.clone();
      for (const t of [map, emi]) { t.needsUpdate = true; t.repeat.set(w / 8, h / 16); disposables.push(t); }
      const mat = std('#ffffff', { map, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 1.3, roughness: 0.8, envMapIntensity: 0.3 });
      const b = mesh(new T.BoxGeometry(w, h, d), mat, false); b.position.set(x, h / 2, z); scene.add(b);
      // roof clutter
      if (R() < 0.6) { const u = box(w * 0.3, 1.2, d * 0.25, std('#2a3038')); u.position.set(x + (R() - 0.5) * w * 0.4, h + 0.6, z); scene.add(u); }
      if (h > 30 && R() < 0.5) halo(scene, x, h + 1.5, z, '#ff2020', 2.2, 2);
      return b;
    }
    // distant skyline ring for depth
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + R() * 0.05, r = 110 + R() * 70, w = 14 + R() * 20, h = 18 + Math.pow(R(), 1.5) * 90;
      if (env === 'bridge' && Math.abs(Math.sin(a)) < 0.35) continue;
      building(Math.cos(a) * r, Math.sin(a) * r, w, h, 14 + R() * 12);
    }

    // ---- road surface: aggregate, tyre tracks, cracks, patches, oil and (when wet) puddles
    const puddles = [];
    const roadMap = tex(1024, 512, (g, w, h) => {
      g.fillStyle = '#3a3c40'; g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 38 + (Math.random() < 0.02 ? 30 : 0); d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
      g.putImageData(img, 0, 0);
      // polished tyre tracks in each lane
      for (const lc of [-3.5, 0, 3.5]) for (const o of [-0.8, 0.8]) { const y = (lc + o + 5.25) / 10.5 * h; g.fillStyle = 'rgba(20,20,24,.28)'; g.fillRect(0, y - 9, w, 18); }
      // patches and seams
      for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(${20 + Math.random() * 20},${20 + Math.random() * 20},${24 + Math.random() * 20},.55)`; g.fillRect(Math.random() * w, Math.random() * h, 60 + Math.random() * 180, 30 + Math.random() * 90); }
      g.strokeStyle = 'rgba(12,12,14,.7)'; g.lineWidth = 2;
      for (let i = 0; i < 14; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.3) * 40; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
      for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(10,10,12,.35)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 12 + Math.random() * 40, 6 + Math.random() * 18, Math.random() * 3, 0, 7); g.fill(); }
      if (wet) for (let i = 0; i < 16; i++) { const lc = pick([-3.5, 0, 3.5]) + pick([-0.8, 0.8]), p = [Math.random() * w, (lc + 5.25) / 10.5 * h + (Math.random() - 0.5) * 20, 30 + Math.random() * 110, 10 + Math.random() * 20, Math.random() * 0.3]; puddles.push(p); g.fillStyle = 'rgba(8,9,12,.22)'; g.beginPath(); g.ellipse(p[0], p[1], p[2], p[3], p[4], 0, 7); g.fill(); }
    });
    const roadRough = tex(1024, 512, (g, w, h) => {
      const base = wet ? 120 : 200; g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, w, h);
      for (const lc of [-3.5, 0, 3.5]) for (const o of [-0.8, 0.8]) { const y = (lc + o + 5.25) / 10.5 * h; g.fillStyle = `rgba(${base - 60},${base - 60},${base - 60},.7)`; g.fillRect(0, y - 9, w, 18); }
      for (const p of puddles) { g.fillStyle = 'rgb(40,40,40)'; g.beginPath(); g.ellipse(p[0], p[1], p[2], p[3], p[4], 0, 7); g.fill(); }
    }, false);
    const roadBump = tex(512, 256, (g, w, h) => { const img = g.createImageData(w, h); for (let i = 0; i < img.data.length; i += 4) { const v = 110 + Math.random() * 90; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } g.putImageData(img, 0, 0); }, false);
    for (const t of [roadMap, roadRough, roadBump]) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    roadMap.repeat.set(8, 1); roadRough.repeat.set(8, 1); roadBump.repeat.set(40, 4);
    const road = mesh(new T.PlaneGeometry(160, 10.5), std('#ffffff', { map: roadMap, roughnessMap: roadRough, roughness: 1, metalness: wet ? 0.15 : 0.02, bumpMap: roadBump, bumpScale: 0.012, envMapIntensity: wet ? 0.9 : 0.35 }), false);
    road.rotation.x = -Math.PI / 2; scene.add(road);
    const paintM = std('#e4e6ea', { roughness: wet ? 0.3 : 0.6, emissive: lin('#1c1c1c') }), yel = std('#d6a52c', { roughness: wet ? 0.3 : 0.6, emissive: lin('#1a1204') });
    for (let x = -80; x < 80; x += 12) for (const z of [-1.75, 1.75]) { const m = mesh(new T.PlaneGeometry(3.6, 0.13), paintM, false); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); scene.add(m); }
    for (const z of [-5.05, 5.05]) { const m = mesh(new T.PlaneGeometry(160, 0.14), z < 0 ? yel : paintM, false); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.006, z); scene.add(m); }
    const ground = mesh(new T.PlaneGeometry(600, 600), std(env === 'bridge' ? '#05080c' : '#0c0f13', { roughness: 0.95 }), false); ground.rotation.x = -Math.PI / 2; ground.position.y = env === 'bridge' ? -18 : -0.03; scene.add(ground);

    // ---- light beams and street lamps
    const beamTex = tex(32, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
    const beamStrength = weather === 'fog' ? 0.05 : weather === 'rain' ? 0.03 : weather === 'drizzle' ? 0.02 : 0;
    function lightBeam(parent, x, y, z, rTop, rBot, h, color) {
      if (weather === 'clear') return null;
      const m = new T.Mesh(new T.CylinderGeometry(rTop, rBot, h, 24, 1, true), new T.MeshBasicMaterial({ map: beamTex, color: lin(color).multiplyScalar(beamStrength * 6), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.FrontSide, fog: false }));
      m.position.set(x, y - h / 2, z); parent.add(m); return m;
    }
    const lampCol = pick(['#ffb46b', '#ffd9a8', '#f4f7ff']);
    const poleMat = std('#3a4049', { metalness: 0.7, roughness: 0.45 });
    let keyLight = null;
    function streetLamp(x, side, h, key) {
      const g = new T.Group(); g.position.set(x, 0, side * (env === 'freeway' ? 8.3 : 6.1)); scene.add(g);
      const pole = cyl(0.09, 0.14, h, poleMat, 10); pole.position.y = h / 2; g.add(pole);
      const arm = box(0.1, 0.1, 2.4, poleMat); arm.position.set(0, h - 0.05, -side * 1.2); g.add(arm);
      const head = box(0.8, 0.16, 0.42, std('#2a2e35', { metalness: 0.6 })); head.position.set(0, h - 0.15, -side * 2.25); g.add(head);
      const lens = box(0.66, 0.03, 0.32, glow(lampCol, 9)); lens.position.set(0, h - 0.24, -side * 2.25); g.add(lens);
      halo(g, 0, h - 0.3, -side * 2.25, lampCol, 2.2, 1.2);
      lightBeam(g, 0, h - 0.25, -side * 2.25, 0.35, 4.2, h - 0.2, lampCol);
      // light pool on the road
      if (key) {
        const sp = new T.SpotLight(lin(lampCol), 5.5, 30, 0.95, 0.55, 1.4); sp.position.set(x, h - 0.3, side * (env === 'freeway' ? 8.3 : 6.1) - side * 2.25);
        sp.target.position.set(x + 0.5, 0, 0.3); sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0004; sp.shadow.camera.near = 1; sp.shadow.camera.far = 30;
        scene.add(sp, sp.target); keyLight = sp;
      } else {
        const pl = new T.PointLight(lin(lampCol), 2.4, 22, 2); pl.position.set(x, h - 0.6, side * (env === 'freeway' ? 8.3 : 6.1) - side * 2.25); scene.add(pl);
      }
    }
    const lampH = env === 'freeway' ? 11 : 7.5;
    streetLamp(1.5, -1, lampH, true); streetLamp(-24, 1, lampH); streetLamp(26, 1, lampH);
    for (const x of [-60, -40, 48, 70]) { const g = new T.Group(); g.position.set(x, 0, (x > 0 ? 1 : -1) * (env === 'freeway' ? 8.3 : 6.1)); scene.add(g); const p = cyl(0.09, 0.14, lampH, poleMat, 8); p.position.y = lampH / 2; g.add(p); halo(g, 0, lampH - 0.2, -(x > 0 ? 1 : -1) * 2.2, lampCol, 2.4, 1.3); lightBeam(g, 0, lampH - 0.25, -(x > 0 ? 1 : -1) * 2.2, 0.3, 3.6, lampH - 0.2, lampCol); }

    // ---- surroundings for the kind of road the crash was on
    function textTex(w, h, bg, draw) { return tex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); draw(g, w, h); }); }
    const roadName = (opts.road || '').toUpperCase();
    function greenSign(w, h, lines) {
      const t = textTex(1024, Math.round(1024 * h / w), '#0b6a45', (g, cw, ch) => {
        g.strokeStyle = '#e7efe9'; g.lineWidth = 12; g.strokeRect(16, 16, cw - 32, ch - 32);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        lines.forEach(([txt, size, y]) => { let fs = size; g.font = `900 ${fs}px Overpass, "Arial Black", Arial, sans-serif`; while (g.measureText(txt).width > cw - 90 && fs > 20) { fs -= 4; g.font = `900 ${fs}px Overpass, "Arial Black", Arial, sans-serif`; } g.fillText(txt, cw / 2, ch * y); });
      });
      return new T.Mesh(new T.PlaneGeometry(w, h), std('#ffffff', { map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.28, roughness: 0.4, metalness: 0.2 }));
    }
    const concrete = std('#6b6e72', { roughness: 0.9 });
    if (env === 'street') {
      const curbMat = std('#7a7f86', { roughness: 0.85 }), walk = std('#3d424a', { roughness: wet ? 0.45 : 0.9, metalness: wet ? 0.1 : 0 });
      for (const s of [-1, 1]) {
        const c = box(160, 0.16, 0.3, curbMat, false); c.position.set(0, 0.08, s * 5.4); scene.add(c);
        const w = box(160, 0.15, 4.2, walk, false); w.position.set(0, 0.075, s * 7.6); scene.add(w);
        let x = -70;
        while (x < 70) {
          const w2 = 7 + R() * 12, h = 8 + R() * 30, d = 12 + R() * 8;
          building(x + w2 / 2, s * (9.8 + d / 2), w2, h, d);
          // storefront with a lit sign
          const shopTxt = pick(['PHARMACY', 'DINER', 'LAUNDROMAT', 'OPEN 24H', 'NOODLES', 'PIZZA', 'BAR', 'DELI', 'HOTEL', 'CAFÉ', 'LIQUOR', 'PAWN', 'TACOS', 'BOOKS']);
          const col = pick(['#ff4d6d', '#4dd2ff', '#ffd24d', '#7dff9a', '#ff9a3c', '#d27dff']);
          const st = textTex(512, 96, '#07090c', (g, cw, ch) => { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.font = '800 58px Overpass, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(shopTxt, cw / 2, ch / 2 + 3); });
          const sign = new T.Mesh(new T.PlaneGeometry(Math.min(w2 - 1, 5), 0.9), std('#000', { emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 3.2, map: st }));
          sign.position.set(x + w2 / 2, 3.4, s * 9.72); if (s < 0) { /* faces +z */ } else sign.rotation.y = Math.PI; scene.add(sign);
          const warm = pick(['#ffcf94', '#cfe2ff', '#ffe0b5', '#ffd0a0']);
          const it = textTex(256, 96, '#000', (gg, cw, ch) => {
            const gr = gg.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, warm); gr.addColorStop(1, '#3a2a1c'); gg.globalAlpha = 0.55; gg.fillStyle = gr; gg.fillRect(0, 0, cw, ch); gg.globalAlpha = 1;
            gg.fillStyle = 'rgba(0,0,0,.55)'; for (let y = 22; y < ch; y += 24) gg.fillRect(0, y, cw, 4);
            for (let i = 0; i < 40; i++) { gg.fillStyle = `hsla(${Math.random() * 360},40%,${30 + Math.random() * 30}%,.8)`; gg.fillRect(Math.random() * cw, 8 + Math.floor(Math.random() * 3) * 24, 4 + Math.random() * 8, 12); }
            for (let i = 0; i < 2; i++) { const x = 40 + Math.random() * (cw - 80); gg.fillStyle = 'rgba(0,0,0,.75)'; gg.beginPath(); gg.arc(x, 40, 8, 0, 7); gg.fill(); gg.fillRect(x - 10, 48, 20, 48); }
            gg.strokeStyle = 'rgba(0,0,0,.8)'; gg.lineWidth = 6; gg.strokeRect(0, 0, cw, ch); gg.beginPath(); gg.moveTo(cw / 2, 0); gg.lineTo(cw / 2, ch); gg.stroke();
          });
          const win = new T.Mesh(new T.PlaneGeometry(w2 - 1.2, 2.2), new T.MeshStandardMaterial({ color: lin('#0a0c10'), emissive: 0xffffff, emissiveMap: it, emissiveIntensity: 0.45, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.2 }));
          win.position.set(x + w2 / 2, 1.5, s * 9.71); if (s > 0) win.rotation.y = Math.PI; scene.add(win);
          x += w2 + 0.6 + R() * 1.5;
        }
      }
      // hydrant, bins, bus shelter
      const hyd = new T.Group(); const hb = cyl(0.13, 0.15, 0.6, std('#b3261e', { roughness: 0.5 }), 12); hb.position.y = 0.45; hyd.add(hb); const hc = mesh(new T.SphereGeometry(0.14, 12, 8), std('#b3261e')); hc.position.y = 0.76; hyd.add(hc); hyd.position.set(-9, 0.15, -6.1); scene.add(hyd);
      for (const x of [-18, 14]) { const bin = cyl(0.3, 0.26, 0.95, std('#2f4a3a', { metalness: 0.3 }), 14); bin.position.set(x, 0.62, 6.5); scene.add(bin); contact(scene, 1, 1).position.set(x, 0.16, 6.5); }
      const shelter = new T.Group(); shelter.position.set(-15, 0.15, -8.3); scene.add(shelter);
      const roof = box(4, 0.1, 1.5, std('#2a2f37', { metalness: 0.5 })); roof.position.y = 2.5; shelter.add(roof);
      for (const x of [-1.9, 1.9]) { const p = box(0.08, 2.5, 0.08, poleMat); p.position.set(x, 1.25, -0.6); shelter.add(p); }
      const ad = textTex(256, 384, '#101318', (g, cw, ch) => { const gr = g.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, '#2a6cff'); gr.addColorStop(1, '#ff4d9a'); g.fillStyle = gr; g.fillRect(12, 12, cw - 24, ch - 24); g.fillStyle = '#fff'; g.font = '900 40px Overpass, Arial'; g.textAlign = 'center'; g.fillText('SNARL', cw / 2, ch - 60); g.font = '700 20px Overpass, Arial'; g.fillText('drive safe', cw / 2, ch - 30); });
      const adP = new T.Mesh(new T.PlaneGeometry(1.2, 1.8), std('#000', { emissive: 0xffffff, emissiveMap: ad, emissiveIntensity: 1.6 })); adP.position.set(1.95, 1.2, 0); adP.rotation.y = -Math.PI / 2; shelter.add(adP);
      // traffic light at the far intersection
      const tl = new T.Group(); tl.position.set(40, 0, -6.4); scene.add(tl);
      const tp = cyl(0.1, 0.12, 5.4, poleMat); tp.position.y = 2.7; tl.add(tp);
      const tarm = box(0.12, 0.12, 4, poleMat); tarm.position.set(0, 5.3, 2); tl.add(tarm);
      const thead = box(0.35, 1.0, 0.35, plastic); thead.position.set(0, 4.7, 3.6); tl.add(thead);
      const tlights = ['#ff2a1a', '#ffb21a', '#2aff7a'].map((c, i) => { const m = mesh(new T.SphereGeometry(0.1, 12, 8), glow(c, 0)); m.position.set(-0.18, 5.0 - i * 0.3, 3.6); tl.add(m); const h = halo(tl, -0.25, 5.0 - i * 0.3, 3.6, c, 1.4, 0); return [m, h]; });
      scene.userData.trafficLight = tlights;
      // trees in pits
      for (const x of [-32, -3, 22, 44]) { const s = x < 0 ? -1 : 1; const tr = new T.Group(); tr.position.set(x, 0.15, s * 8.9); const tk = cyl(0.12, 0.16, 2.6, std('#2b2119'), 8); tk.position.y = 1.3; tr.add(tk); for (let k = 0; k < 4; k++) { const f = mesh(new T.IcosahedronGeometry(1.1 + R() * 0.5, 1), std(pick(['#17301f', '#1c3a24', '#223f28']), { roughness: 0.9, flatShading: true })); f.position.set((R() - 0.5) * 1.2, 2.9 + R() * 1.2, (R() - 0.5) * 1.2); tr.add(f); } scene.add(tr); }
      // street name sign
      const ss = greenSign(3.2, 0.62, [[roadName || 'MAIN ST', 110, 0.54]]); ss.position.set(-5.5, 5.3, -6.35); scene.add(ss);
      const sp = cyl(0.07, 0.07, 5.4, poleMat); sp.position.set(-7.3, 2.7, -6.4); scene.add(sp);
    } else if (env === 'freeway') {
      // jersey barriers, shoulders, sound walls, an overhead sign gantry with the road name
      const jersey = [[0, 0], [0.3, 0], [0.24, 0.3], [0.08, 0.5], [0.08, 0.82], [-0.08, 0.82], [-0.08, 0.5], [-0.24, 0.3], [-0.3, 0]].map(([z, y]) => new T.Vector2(z, y));
      for (const zc of [-6.2, 8.2]) {
        const shp = new T.Shape(jersey); const geo = new T.ExtrudeGeometry(shp, { depth: 160, bevelEnabled: false }); geo.rotateY(Math.PI / 2); geo.translate(-80, 0, zc);
        const j = mesh(geo, concrete); scene.add(j);
      }
      const sh = mesh(new T.PlaneGeometry(160, 3), std('#303236', { map: roadMap, roughnessMap: roadRough, roughness: 1, envMapIntensity: 0.5 }), false); sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.002, 6.75); scene.add(sh);
      const wallTex = textTex(256, 256, '#3b3e44', (g, w, h) => { for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
      wallTex.wrapS = wallTex.wrapT = T.RepeatWrapping; wallTex.repeat.set(30, 1);
      const wall = mesh(new T.PlaneGeometry(160, 5), std('#ffffff', { map: wallTex, roughness: 0.95 }), false); wall.position.set(0, 2.5, 11); wall.rotation.y = Math.PI; scene.add(wall);
      const gx = -26, gan = new T.Group(); gan.position.set(gx, 0, 0); scene.add(gan);
      for (const z of [-6.8, 8.8]) { const p = box(0.35, 7.4, 0.35, poleMat); p.position.set(0, 3.7, z); gan.add(p); }
      const truss = box(0.5, 0.5, 16, poleMat); truss.position.set(0, 7.1, 1); gan.add(truss);
      const sign = greenSign(7.2, 2.4, [[roadName || 'HARBOR FWY', 140, 0.36], ['EXIT 1/2 MILE', 90, 0.72]]); sign.position.set(-0.3, 5.7, 0); sign.rotation.y = -Math.PI / 2; gan.add(sign);
      for (const z of [-2.5, 2.5]) { const sl = box(0.2, 0.08, 0.3, glow('#fff3dc', 6)); sl.position.set(-0.8, 7.35, z); gan.add(sl); }
    } else {
      // bridge: steel truss, railings, water far below reflecting the skyline
      const steel = std(pick(['#4a5a6a', '#6a3a2a', '#3a4a3a', '#5a5f66']), { metalness: 0.7, roughness: 0.5 });
      for (const s of [-1, 1]) {
        const rail = box(160, 0.12, 0.12, steel); rail.position.set(0, 1.05, s * 5.9); scene.add(rail);
        const deckEdge = box(160, 0.9, 0.6, concrete); deckEdge.position.set(0, -0.45, s * 5.6); scene.add(deckEdge);
        const top = box(160, 0.5, 0.5, steel); top.position.set(0, 9, s * 6.6); scene.add(top);
        const bot = box(160, 0.5, 0.5, steel); bot.position.set(0, 0.25, s * 6.6); scene.add(bot);
        for (let x = -78; x <= 78; x += 7) {
          const v = box(0.35, 9, 0.35, steel); v.position.set(x, 4.5, s * 6.6); scene.add(v);
          beam([x, 0.3, s * 6.6], [x + 7, 8.8, s * 6.6], 0.28, steel, scene);
          for (let k = 0; k < 7; k++) { const post = box(0.05, 1.0, 0.05, steel); post.position.set(x + k, 0.55, s * 5.9); scene.add(post); }
        }
      }
      for (let x = -76; x <= 76; x += 7) beam([x, 9, -6.6], [x, 9, 6.6], 0.3, steel, scene);
      const water = mesh(new T.PlaneGeometry(700, 700), new T.MeshStandardMaterial({ color: lin('#08121a'), roughness: 0.12, metalness: 0.6, envMapIntensity: 1.2 }), false);
      water.rotation.x = -Math.PI / 2; water.position.y = -17; scene.add(water);
      const bs = greenSign(3.4, 0.62, [[roadName || 'MAIN ST BRIDGE', 100, 0.54]]); bs.position.set(-8, 7.7, -6.35); scene.add(bs);
    }

    // ---- vehicles
    function wheel(r, w, rimCol) {
      const g = new T.Group();
      const prof = [];
      const ri = r * 0.64, rr = r * 0.18;
      prof.push(new T.Vector2(ri, -w / 2));
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; prof.push(new T.Vector2(r - rr + Math.cos(a) * rr, Math.sin(a) * (w / 2))); }
      prof.push(new T.Vector2(ri, w / 2));
      const tire = mesh(new T.LatheGeometry(prof, 28), rubber); tire.rotation.x = Math.PI / 2; g.add(tire);
      const rimM = rimCol ? std(rimCol, { metalness: 0.8, roughness: 0.3 }) : alloy;
      const rim = mesh(new T.CylinderGeometry(ri, ri, w * 0.8, 24), rimM); rim.rotation.x = Math.PI / 2; g.add(rim);
      const disc = mesh(new T.CylinderGeometry(ri * 0.75, ri * 0.75, w * 0.84, 20), std('#3a3d42', { metalness: 0.8, roughness: 0.4 })); disc.rotation.x = Math.PI / 2; g.add(disc);
      for (const sgn of [-1, 1]) {
        for (let k = 0; k < 5; k++) { const sp = box(ri * 0.95, 0.06, 0.05, rimM, false); sp.position.set(Math.cos(k * 1.2566) * ri * 0.48, Math.sin(k * 1.2566) * ri * 0.48, sgn * w * 0.42); sp.rotation.z = k * 1.2566; g.add(sp); }
        const hub = cyl(ri * 0.2, ri * 0.2, 0.04, chrome, 12); hub.rotation.x = Math.PI / 2; hub.position.z = sgn * w * 0.43; g.add(hub);
      }
      return g;
    }
    const TYPES = {
      sedan: { L: 4.75, W: 1.84, H: 1.44, belt: 0.93, nose: 0.78, cowl: 1.5, roofF: 2.15, roofR: 3.55, tail: 0.95, wb: [1.42, -1.38], r: 0.34, bot: 0.24 },
      hatch: { L: 4.25, W: 1.8, H: 1.48, belt: 0.94, nose: 0.78, cowl: 1.25, roofF: 1.9, roofR: 3.95, tail: 0.14, wb: [1.3, -1.28], r: 0.33, bot: 0.24 },
      suv: { L: 4.8, W: 1.94, H: 1.78, belt: 1.12, nose: 0.98, cowl: 1.35, roofF: 2.0, roofR: 4.5, tail: 0.12, wb: [1.45, -1.42], r: 0.4, bot: 0.34 },
      wagon: { L: 4.85, W: 1.84, H: 1.5, belt: 0.95, nose: 0.8, cowl: 1.5, roofF: 2.15, roofR: 4.55, tail: 0.14, wb: [1.45, -1.42], r: 0.34, bot: 0.24 },
      pickup: { L: 5.5, W: 2.0, H: 1.9, belt: 1.2, nose: 1.1, cowl: 1.6, roofF: 2.2, roofR: 3.35, tail: 0, bed: 2.0, wb: [1.9, -1.8], r: 0.42, bot: 0.4 },
    };
    const plateTex = () => textTex(256, 56, '#e9ecef', (g, w, h) => { g.strokeStyle = '#223'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#1b2a5a'; g.font = '800 34px "Overpass Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; const L = 'ABCDEFGHJKLMNPRSTVWXYZ'; g.fillText(`${Math.floor(R() * 9) + 1}${L[Math.floor(R() * L.length)]}${L[Math.floor(R() * L.length)]}${L[Math.floor(R() * L.length)]} ${Math.floor(R() * 900 + 100)}`, w / 2, h / 2 + 2); });
    const crackTex = tex(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(235,240,245,.85)'; g.lineWidth = 1.4;
      const cx = w * (0.3 + R() * 0.2), cy = h * (0.45 + R() * 0.2);
      for (let i = 0; i < 18; i++) { let a = R() * Math.PI * 2, x = cx, y = cy; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { a += (R() - 0.5) * 0.5; const l = 10 + R() * 26; x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineTo(x, y); } g.stroke(); }
      for (let r = 8; r < 70; r += 12 + R() * 10) { g.beginPath(); for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2, rr = r * (0.8 + R() * 0.4); k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); }
      g.fillStyle = 'rgba(230,236,242,.35)'; g.beginPath(); g.arc(cx, cy, 10, 0, 7); g.fill();
    });
    function car(type, color, o) {
      o = o || {};
      const S = TYPES[type], f = S.L / 2, g = new T.Group(), body = new T.Group(); g.add(body);
      const pm = o.police ? paint('#101216') : paint(color);
      const R0 = S.r + 0.07, [wf, wr] = S.wb;
      // lower body side profile with wheel arches
      const P = [[-f + 0.14, S.bot], [wr - R0, S.bot], [wr - R0, S.r], [wr, S.r, R0, Math.PI, 0], [wr + R0, S.bot], [wf - R0, S.bot], [wf - R0, S.r], [wf, S.r, R0, Math.PI, 0], [wf + R0, S.bot],
        [f - 0.16, S.bot], [f, S.bot, f, S.bot + 0.16], [f + 0.02, S.nose - 0.14], [f + 0.02, S.nose, f - 0.24, S.nose + 0.03], [f - S.cowl, S.belt],
        [-f + S.tail + 0.02, S.belt], [-f + 0.05, S.belt - 0.04, -f, S.belt - 0.2], [-f - 0.02, S.bot + 0.16], [-f, S.bot, -f + 0.14, S.bot]];
      const shell = extrude(P, S.W, 0.07, pm, 12);
      if (o.crumple) {
        const pos = shell.geometry.attributes.position, zone = 1.25;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (x > f - zone) {
            const k = (x - (f - zone)) / zone, n = Math.sin(z * 7.1 + y * 5.3) * 0.5 + Math.sin(z * 13 + x * 9) * 0.25;
            pos.setX(i, x - k * k * (0.62 + 0.18 * n) - (z > 0 ? 0.12 : 0) * k);
            if (y > S.nose - 0.25) pos.setY(i, y + Math.sin(k * Math.PI) * 0.1 - k * k * 0.12);
            pos.setZ(i, z * (1 - k * 0.04) + n * 0.03 * k);
          }
        }
        shell.geometry.computeVertexNormals();
      }
      body.add(shell);
      // lower cladding, sills
      const sill = box(Math.max(0.2, (wf - wr) - 2 * R0 - 0.08), 0.1, S.W + 0.02, plastic); sill.position.set((wf + wr) / 2, S.bot + 0.04, 0); body.add(sill);
      // cabin glass + roof + pillars
      const rr = -f + (S.tail > 0.5 ? S.tail + 0.25 : 0.1);
      const gh = [[f - S.cowl, S.belt - 0.02], [f - S.roofF, S.H - 0.05], [f - S.roofF - 0.2, S.H, f - S.roofF - 0.5, S.H], [f - S.roofR + 0.3, S.H], [f - S.roofR, S.H, f - S.roofR - 0.15, S.H - 0.08], [rr, S.belt - 0.02]];
      if (!S.bed) body.add(extrude(gh, S.W * 0.82, 0.04, glass, 10)); else body.add(extrude([[f - S.cowl, S.belt - 0.02], [f - S.roofF, S.H - 0.05], [f - S.roofF - 0.4, S.H], [f - S.roofR, S.H], [f - S.roofR - 0.05, S.belt - 0.02]], S.W * 0.84, 0.04, glass, 8));
      const roofEnd = S.bed ? f - S.roofR : f - S.roofR - 0.08;
      const roof = extrude([[f - S.roofF + 0.02, S.H - 0.06], [f - S.roofF - 0.4, S.H + 0.02, f - S.roofF - 0.8, S.H + 0.03], [roofEnd + 0.25, S.H + 0.03], [roofEnd, S.H + 0.02, roofEnd - 0.05, S.H - 0.05]], S.W * 0.86, 0.05, pm, 8);
      body.add(roof);
      for (const s of [-1, 1]) {
        const zz = s * S.W * 0.415;
        beam([f - S.cowl, S.belt, zz], [f - S.roofF + 0.02, S.H - 0.04, zz], 0.08, pm, body);
        beam([(f - S.roofF + roofEnd) / 2 + 0.2, S.belt, zz], [(f - S.roofF + roofEnd) / 2 + 0.25, S.H, zz], 0.1, o.police ? pm : plastic, body);
        if (!S.bed) beam([rr + 0.1, S.belt, zz], [roofEnd, S.H, zz], 0.12, pm, body);
        // mirrors
        const mir = box(0.18, 0.13, 0.12, pm); mir.position.set(f - S.cowl - 0.12, S.belt + 0.1, s * (S.W / 2 + 0.08)); body.add(mir);
        // door seams and handles
        for (const x of [f - S.cowl - 0.05, (f - S.roofF + roofEnd) / 2 + 0.22, S.bed ? null : rr + 0.35]) {
          if (x == null) continue;
          const sm = new T.Mesh(new T.PlaneGeometry(0.012, S.belt - S.bot - 0.12), plastic); sm.position.set(x, (S.belt + S.bot) / 2 + 0.03, s * (S.W / 2 + 0.002)); if (s < 0) sm.rotation.y = Math.PI; body.add(sm);
        }
        for (const x of [(f - S.cowl + (f - S.roofF + roofEnd) / 2) / 2 - 0.3, (f - S.roofF + roofEnd) / 2 - 0.25]) { const hd = box(0.2, 0.035, 0.03, chrome, false); hd.position.set(x, S.belt - 0.12, s * (S.W / 2 + 0.01)); body.add(hd); }
      }
      // police livery
      if (o.police) {
        const white = paint('#eef0f2');
        for (const s of [-1, 1]) {
          const lt = textTex(512, 128, '#eef0f2', (gg, w, h) => { gg.fillStyle = '#10204a'; gg.font = '900 74px Overpass, "Arial Black", Arial'; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText('POLICE', w / 2, h / 2 + 4); });
          const door = new T.Mesh(new T.PlaneGeometry(2.1, S.belt - S.bot - 0.18), std('#fff', { map: lt, roughness: 0.3, metalness: 0.3 })); door.position.set((wf + wr) / 2 + 0.15, (S.belt + S.bot) / 2 + 0.05, s * (S.W / 2 + 0.004)); if (s < 0) door.rotation.y = Math.PI; body.add(door);
        }
        void white;
      }
      // interior: seats, dash, steering wheel (seen through the glass)
      const cab = std('#0c0d10', { roughness: 0.8 });
      const dash = box(0.5, 0.25, S.W * 0.78, cab, false); dash.position.set(f - S.cowl - 0.2, S.belt - 0.02, 0); body.add(dash);
      for (const z of [-0.4, 0.4]) { const seat = box(0.5, 0.75, 0.5, cab, false); seat.position.set((f - S.roofF + roofEnd) / 2 + 0.1, S.belt - 0.05, z); seat.rotation.z = 0.15; body.add(seat); }
      const sw = mesh(new T.TorusGeometry(0.18, 0.025, 8, 20), cab, false); sw.position.set(f - S.cowl - 0.5, S.belt + 0.1, -0.38); sw.rotation.y = Math.PI / 2; sw.rotation.x = 0.4; body.add(sw);
      // lights
      const lightsOn = o.lights !== false, heads = [];
      for (const s of [-1, 1]) {
        const broken = o.crumple && s > 0;
        const hx = o.crumple ? f - 0.55 : f - 0.03;
        const hl = box(0.1, 0.12, 0.4, broken ? std('#1a1c20', { roughness: 0.3 }) : glow('#fff4e0', lightsOn ? 6 : 0.4)); hl.position.set(hx, S.nose - 0.12, s * S.W * 0.34); body.add(hl); heads.push(hl);
        if (lightsOn && !broken) halo(body, hx + 0.1, S.nose - 0.12, s * S.W * 0.34, '#fff2d8', o.crumple ? 0.45 : 0.7, 1.1);
        const tl = box(0.08, 0.12, 0.46, glow('#ff1a0e', o.brake ? 5 : 1.6)); tl.position.set(-f - 0.01, S.belt - 0.15, s * S.W * 0.33); body.add(tl);
        if (lightsOn) halo(body, -f - 0.08, S.belt - 0.15, s * S.W * 0.33, '#ff2a1a', o.brake ? 0.55 : 0.35, o.brake ? 1.1 : 0.6);
      }
      const grille = box(0.04, 0.2, S.W * 0.44, std('#0a0b0d', { metalness: 0.5, roughness: 0.4 })); grille.position.set(o.crumple ? f - 0.58 : f + 0.02, S.nose - 0.18, 0); body.add(grille);
      const pt = plateTex();
      for (const s of [-1, 1]) { const pl = new T.Mesh(new T.PlaneGeometry(0.52, 0.11), std('#fff', { map: pt, roughness: 0.4 })); pl.position.set(s * (f + 0.035) - (o.crumple && s > 0 ? 0.6 : 0), S.bot + 0.2, 0); pl.rotation.y = s * Math.PI / 2; if (!(o.crumple && s > 0)) body.add(pl); }
      // hazards
      const hz = [];
      for (const [x, z] of [[f - 0.1, -0.85], [f - 0.1, 0.85], [-f + 0.02, -0.85], [-f + 0.02, 0.85]]) {
        if (o.crumple && x > 0 && z > 0) continue;
        const m = box(0.08, 0.06, 0.12, glow('#ffa21a', 0)); m.position.set(o.crumple && x > 0 ? f - 0.6 : x, S.nose - 0.02, z * S.W / 1.84); body.add(m);
        m.userData.h = halo(body, m.position.x + Math.sign(x) * 0.1, m.position.y, m.position.z, '#ffa21a', 1.1, 0); hz.push(m);
      }
      // pickup bed
      if (S.bed) { const bedIn = box(S.bed, 0.5, S.W * 0.86, std('#0e0f12', { roughness: 0.8 })); bedIn.position.set(-f + S.bed / 2 + 0.1, S.belt - 0.2, 0); body.add(bedIn); }
      // wheels
      const wheels = [];
      for (const [x, z] of [[wf, -1], [wf, 1], [wr, -1], [wr, 1]]) { const w = wheel(S.r, 0.24); w.position.set(x, S.r, z * (S.W / 2 - 0.14)); g.add(w); wheels.push(w); }
      if (o.crumple) { wheels[1].rotation.y = 0.38; wheels[1].position.y = S.r - 0.05; wheels[1].rotation.x = -0.12; body.rotation.z = -0.025; body.rotation.x = 0.02; }
      contact(g, S.L + 0.9, S.W + 0.7);
      // deployed airbag and cracked windscreen on the wreck
      if (o.crumple) {
        const bag = mesh(new T.IcosahedronGeometry(0.26, 1), std('#d9d9d2', { roughness: 0.95, flatShading: true }), false); bag.scale.set(0.35, 0.7, 1.05); bag.position.set(f - S.cowl - 0.5, S.belt + 0.1, -0.38); bag.rotation.set(0.3, 0.2, 0.5); body.add(bag);
        const a = new T.Vector3(f - S.cowl, S.belt - 0.02, 0), b2 = new T.Vector3(f - S.roofF, S.H - 0.05, 0), u = b2.clone().sub(a), len = u.length(); u.normalize();
        const v = new T.Vector3(0, 0, 1), nrm = new T.Vector3().crossVectors(u, v);
        const cr = new T.Mesh(new T.PlaneGeometry(len * 0.98, S.W * 0.8), new T.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, color: lin('#dfe6ee').multiplyScalar(0.8) }));
        cr.setRotationFromMatrix(new T.Matrix4().makeBasis(u, v, nrm)); cr.position.copy(a).add(b2).multiplyScalar(0.5).add(nrm.multiplyScalar(0.035)); body.add(cr);
      }
      g.userData = { hazards: hz, wheels, S, heads };
      return g;
    }

    // ---- the wreck and the scene around it
    const carType = pick(Object.keys(TYPES));
    const wreckCol = opts.color != null ? '#' + opts.color.toString(16).padStart(6, '0') : pick(['#8f2f30', '#39598a', '#d9dee5']);
    const wreck = car(carType, wreckCol, { crumple: true, lights: true });
    wreck.position.set(0, 0, 0.35); wreck.rotation.y = 0.26 + R() * 0.2; scene.add(wreck);
    const hazardLight = new T.PointLight(lin('#ffa21a'), 0, 8, 2); hazardLight.position.set(0, 1.2, 0); wreck.add(hazardLight);
    const flickerHead = wreck.userData.heads[0];
    // debris: glass, plastic, a lost hubcap, fluid
    const shardMat = new T.MeshStandardMaterial({ color: lin('#d6ecff'), metalness: 0.9, roughness: 0.03, envMapIntensity: 2.2 });
    for (let i = 0; i < 110; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(0.03 + R() * 0.07, 0.02 + R() * 0.05), shardMat);
      const a = R() * 6.28, r = Math.pow(R(), 0.7) * 2.8; m.rotation.x = -Math.PI / 2; m.rotation.z = R() * 6; m.position.set(2.6 + Math.cos(a) * r, 0.008, 0.5 + Math.sin(a) * r * 0.8); scene.add(m);
    }
    for (let i = 0; i < 6; i++) { const p = box(0.2 + R() * 0.4, 0.03, 0.1 + R() * 0.2, i < 2 ? paint(wreckCol) : plastic); p.position.set(2.6 + (R() - 0.3) * 3, 0.02, (R() - 0.5) * 3); p.rotation.y = R() * 3; scene.add(p); }
    const bumper = box(0.4, 0.14, 1.5, paint(wreckCol)); bumper.position.set(3.8, 0.07, -0.9); bumper.rotation.y = 0.9; scene.add(bumper);
    const cap = cyl(0.2, 0.2, 0.03, chrome, 18); cap.position.set(-1.8, 0.02, 2.2); scene.add(cap);
    const fluid = new T.Mesh(new T.CircleGeometry(1, 28), new T.MeshStandardMaterial({ color: lin('#050505'), roughness: 0.1, metalness: 0.15, envMapIntensity: 0.6, transparent: true, opacity: 0.85 }));
    fluid.rotation.x = -Math.PI / 2; fluid.scale.set(0.7, 0.45, 1); fluid.position.set(2.1, 0.009, 0.45); scene.add(fluid);
    const coneMat = std('#ff5a10', { roughness: 0.45, emissive: lin('#2a0800') }), stripe = std('#f4f4f4', { emissive: lin('#303030'), roughness: 0.3 });
    const nCones = 3 + Math.floor(R() * 4);
    for (let i = 0; i < nCones; i++) {
      const g = new T.Group(); const c = mesh(new T.ConeGeometry(0.19, 0.7, 18), coneMat); c.position.y = 0.39; g.add(c);
      const s1 = cyl(0.105, 0.13, 0.12, stripe, 18); s1.position.y = 0.44; g.add(s1);
      const bs = box(0.44, 0.04, 0.44, std('#1a1a1a')); bs.position.y = 0.02; g.add(bs);
      g.position.set(-2.8 - i * 1.25, 0, -1.8 + i * 0.62); if (R() < 0.15) { g.rotation.z = Math.PI / 2; g.position.y = 0.2; } scene.add(g);
    }
    // road flares with flickering red light
    const flares = [];
    if (R() < 0.55) {
      for (let i = 0; i < 3; i++) { const fl = cyl(0.025, 0.025, 0.32, glow('#ff2a10', 9), 8); fl.rotation.z = Math.PI / 2; fl.position.set(-10 - i * 4, 0.03, -1.4 + i * 0.9); scene.add(fl); fl.userData.h = halo(scene, fl.position.x + 0.18, 0.08, fl.position.z, '#ff3a1a', 1.4, 1.6); flares.push(fl); }
      const fLight = new T.PointLight(lin('#ff3a1a'), 1.6, 12, 2); fLight.position.set(-14, 0.4, -0.5); scene.add(fLight); flares.light = fLight;
    }
    // police
    const police = R() < 0.8;
    const lights = {};
    let redM = null, blueM = null, redG = null, blueG = null;
    if (police) {
      const pc = car(pick(['sedan', 'suv']), '#101216', { police: true });
      const bar = new T.Group(); const S = pc.userData.S; bar.position.set(-0.3, S.H + 0.08, 0); pc.children[0].add(bar);
      const bb = box(0.34, 0.1, 1.3, plastic); bar.add(bb);
      redM = glow('#ff1a1a', 0); blueM = glow('#2a55ff', 0);
      const rb = box(0.3, 0.12, 0.55, redM); rb.position.set(0, 0.08, -0.34); bar.add(rb);
      const bl = box(0.3, 0.12, 0.55, blueM); bl.position.set(0, 0.08, 0.34); bar.add(bl);
      redG = halo(bar, 0, 0.12, -0.34, '#ff2020', 3.2, 0); blueG = halo(bar, 0, 0.12, 0.34, '#3a66ff', 3.2, 0);
      pc.position.set(-8.2, 0, -0.8); pc.rotation.y = -0.14; scene.add(pc);
      lights.red = new T.PointLight(lin('#ff2020'), 0, 24, 2); lights.red.position.set(-8.5, 2.3, -1.3); scene.add(lights.red);
      lights.blue = new T.PointLight(lin('#3060ff'), 0, 24, 2); lights.blue.position.set(-8.5, 2.3, -0.2); scene.add(lights.blue);
    }

    // ---- the flatbed tow truck. Local +x forward, origin at the rear of the chassis.
    const SCHEMES = [
      { name: 'ACE TOWING', cab: '#f2b21d', rail: '#f2b21d', text: '#111' },
      { name: 'METRO RECOVERY', cab: '#b81d1d', rail: '#e6e6e6', text: '#fff' },
      { name: 'NIGHT OWL TOW', cab: '#15306e', rail: '#f2b21d', text: '#f2b21d' },
      { name: 'RAPID ROADSIDE', cab: '#eef0f2', rail: '#c8201e', text: '#c8201e' },
      { name: "BIG JIM'S TOWING", cab: '#1d6a36', rail: '#e8e8e8', text: '#fff' },
      { name: 'KELL CITY TOW', cab: '#17181b', rail: '#f25c1d', text: '#f25c1d' },
    ];
    const sch = pick(SCHEMES), phone = `555-01${String(Math.floor(R() * 90) + 10)}`;
    const truck = new T.Group(); scene.add(truck);
    const cabM = paint(sch.cab), frameM = std('#15171a', { metalness: 0.5, roughness: 0.6 });
    for (const z of [-0.48, 0.48]) { const rail = box(8.0, 0.24, 0.12, frameM); rail.position.set(4.1, 0.86, z); truck.add(rail); }
    const cab = extrude([[5.0, 0.95], [5.0, 2.9], [5.12, 3.02, 5.3, 3.02], [6.3, 3.02], [6.48, 3.0, 6.55, 2.9], [6.95, 2.05], [8.2, 1.9], [8.42, 1.86, 8.46, 1.7], [8.46, 0.95]], 2.3, 0.08, cabM, 8);
    cab.position.y = 0.05; truck.add(cab);
    const winBand = extrude([[5.18, 2.08], [5.18, 2.86], [6.36, 2.86], [6.8, 2.08]], 2.33, 0.02, glass, 4); winBand.position.y = 0.05; truck.add(winBand);
    const pillar = box(0.1, 0.8, 2.34, cabM); pillar.position.set(5.9, 2.5, 0); truck.add(pillar);
    const grilleT = textTex(128, 128, '#22262c', (g, w, h) => { for (let y = 6; y < h; y += 12) { const gr = g.createLinearGradient(0, y, 0, y + 7); gr.addColorStop(0, '#f0f2f4'); gr.addColorStop(1, '#6a6f76'); g.fillStyle = gr; g.fillRect(4, y, w - 8, 6); } });
    const grille = box(0.06, 0.66, 1.3, std('#fff', { map: grilleT, metalness: 0.9, roughness: 0.2 })); grille.position.set(8.51, 1.37, 0); truck.add(grille);
    const bumperT = box(0.28, 0.3, 2.45, chrome); bumperT.position.set(8.6, 0.78, 0); truck.add(bumperT);
    for (const z of [-0.88, 0.88]) {
      const hl = box(0.06, 0.2, 0.38, glow('#fff6e4', 9)); hl.position.set(8.5, 1.45, z); truck.add(hl); halo(truck, 8.62, 1.45, z, '#fff2d8', 1.8, 1.4);
      const fl = box(0.3, 0.08, 0.1, rubber); fl.position.set(7.35, 1.02, z * 1.12); truck.add(fl);
      const mirA = box(0.04, 0.04, 0.4, chrome); mirA.position.set(6.55, 2.35, z * 1.47); truck.add(mirA);
      const mir = box(0.08, 0.42, 0.22, plastic); mir.position.set(6.55, 2.3, z * 1.72); truck.add(mir);
      const step = box(0.5, 0.06, 0.28, chrome); step.position.set(5.7, 0.62, z * 1.3); truck.add(step);
      const tank = cyl(0.26, 0.26, 1.0, chrome, 18); tank.rotation.z = Math.PI / 2; tank.position.set(4.3, 0.74, z * 1.02); truck.add(tank);
    }
    const stack = cyl(0.07, 0.07, 2.6, chrome, 12); stack.position.set(4.9, 2.1, 0.9); truck.add(stack);
    for (let i = 0; i < 5; i++) { const ml = box(0.08, 0.06, 0.12, glow('#ffa21a', 5)); ml.position.set(6.25, 3.1, -0.8 + i * 0.4); truck.add(ml); }
    const barBase = box(0.36, 0.08, 1.9, plastic); barBase.position.set(5.6, 3.14, 0); truck.add(barBase);
    const amberMs = [];
    for (let i = 0; i < 6; i++) { const m = box(0.3, 0.14, 0.26, glow('#ffa21a', 0)); m.position.set(5.6, 3.24, -0.78 + i * 0.31); truck.add(m); m.userData.h = halo(truck, 5.6, 3.28, m.position.z, '#ffa21a', 1.6, 0); amberMs.push(m); }
    lights.ambA = new T.PointLight(lin('#ffa21a'), 0, 18, 2); lights.ambA.position.set(5.6, 3.6, -0.9); truck.add(lights.ambA);
    lights.ambB = new T.PointLight(lin('#ffa21a'), 0, 18, 2); lights.ambB.position.set(5.6, 3.6, 0.9); truck.add(lights.ambB);
    const headSpot = new T.SpotLight(lin('#fff0d0'), 4.5, 45, 0.45, 0.6, 1.5); headSpot.position.set(8.6, 1.4, 0); truck.add(headSpot); headSpot.target.position.set(22, 0, 0); truck.add(headSpot.target);
    // door lettering
    for (const s of [-1, 1]) {
      const dt = textTex(512, 256, sch.cab, (g, w, h) => {
        g.fillStyle = sch.text; g.textAlign = 'center'; g.textBaseline = 'middle';
        let fs = 70; g.font = `900 ${fs}px Overpass, "Arial Black", Arial`; while (g.measureText(sch.name).width > w - 40) { fs -= 4; g.font = `900 ${fs}px Overpass, "Arial Black", Arial`; }
        g.fillText(sch.name, w / 2, h * 0.38); g.font = '700 44px "Overpass Mono", monospace'; g.fillText('24/7 · ' + phone, w / 2, h * 0.72);
        g.fillRect(40, h * 0.54, w - 80, 4);
      });
      const door = new T.Mesh(new T.PlaneGeometry(1.25, 0.62), std('#fff', { map: dt, roughness: 0.3, metalness: 0.3 }));
      door.position.set(5.7, 1.55, s * 1.16); if (s < 0) door.rotation.y = Math.PI; truck.add(door);
    }
    const tWheels = [];
    for (const [x, z] of [[7.35, -0.98], [7.35, 0.98], [2.1, -0.72], [2.1, 0.72], [2.1, -1.02], [2.1, 1.02]]) { const w = wheel(0.5, 0.3, '#9aa0a8'); w.position.set(x, 0.5, z); truck.add(w); tWheels.push(w); }
    contact(truck, 9.8, 3.2, 0.012, 0.85).position.x = 4.2;
    // tilting, sliding deck
    const deck = new T.Group(); deck.position.set(5.4, 1.12, 0); truck.add(deck);
    const diamond = tex(256, 256, (g, w, h) => { g.fillStyle = '#8c939b'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const o = (y / 16) % 2 ? 8 : 0; g.save(); g.translate(x + o, y); g.rotate(((x + y) / 16) % 2 ? 0.6 : -0.6); const gr = g.createLinearGradient(-6, 0, 6, 0); gr.addColorStop(0, '#c9ced4'); gr.addColorStop(1, '#5c636b'); g.fillStyle = gr; g.fillRect(-6, -1.6, 12, 3.2); g.restore(); } });
    diamond.wrapS = diamond.wrapT = T.RepeatWrapping; diamond.repeat.set(8, 3);
    const plate = box(6.1, 0.18, 2.35, std('#fff', { map: diamond, bumpMap: diamond, bumpScale: 0.01, metalness: 0.85, roughness: 0.35 })); plate.position.set(-3.05, 0, 0); deck.add(plate);
    for (const z of [-1.2, 1.2]) { const rail = box(6.1, 0.2, 0.1, paint(sch.rail)); rail.position.set(-3.05, 0.1, z); deck.add(rail); }
    const chev = textTex(256, 32, '#fff', (g, w, h) => { g.fillStyle = '#d0201a'; for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } });
    const rearPanel = new T.Mesh(new T.PlaneGeometry(2.35, 0.2), std('#fff', { map: chev, emissive: 0xffffff, emissiveMap: chev, emissiveIntensity: 0.2 })); rearPanel.position.set(-6.11, 0, 0); rearPanel.rotation.y = -Math.PI / 2; deck.add(rearPanel);
    for (const z of [-1.0, 1.0]) { const tl = box(0.05, 0.1, 0.22, glow('#ff1a0e', 3)); tl.position.set(-6.12, 0.02, z); deck.add(tl); halo(deck, -6.2, 0.02, z, '#ff2a1a', 0.7, 1); }
    const headboard = box(0.14, 1.3, 2.35, frameM); headboard.position.set(-0.1, 0.72, 0); deck.add(headboard);
    for (const z of [-0.8, 0.8]) { const wl = box(0.1, 0.14, 0.24, glow('#f4f7ff', 5)); wl.position.set(-0.2, 1.28, z); deck.add(wl); }
    const workSpot = new T.SpotLight(lin('#eef3ff'), 0, 12, 0.7, 0.6, 1.4); workSpot.position.set(-0.3, 1.3, 0); deck.add(workSpot); workSpot.target.position.set(-5, 0, 0); deck.add(workSpot.target);
    const winch = cyl(0.16, 0.16, 0.6, std('#2a2e35', { metalness: 0.7 }), 14); winch.rotation.x = Math.PI / 2; winch.position.set(-0.45, 0.3, 0); deck.add(winch);
    const cable = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: lin('#b8bec6') })); cable.visible = false; scene.add(cable);
    // hydraulic rams between frame and deck
    const rams = [-0.6, 0.6].map(z => { const m = cyl(0.07, 0.07, 1, chrome, 10); truck.add(m); return { m, z }; });

    // ---- light and reflections
    scene.add(new T.HemisphereLight(lin(SKY.hor), lin('#07080a'), SKY.hemi));
    const moonL = new T.DirectionalLight(lin('#9fb4ff'), SKY.moon); moonL.position.set(-14, 26, 12); scene.add(moonL);
    const envScene = new T.Scene(); envScene.background = lin(SKY.top).multiplyScalar(0.6);
    const eg = (c, i) => new T.MeshBasicMaterial({ color: lin(c).multiplyScalar(i), side: T.DoubleSide });
    const skyDome = new T.Mesh(new T.SphereGeometry(50, 16, 8), new T.MeshBasicMaterial({ color: lin(SKY.hor).multiplyScalar(0.8), side: T.BackSide })); envScene.add(skyDome);
    for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.PlaneGeometry(1.6, 0.5), eg(lampCol, 5)); m.position.set(-30 + i * 7, 9, i % 2 ? 6 : -6); m.lookAt(0, 0, 0); envScene.add(m); }
    for (const z of [-14, 14]) for (let i = 0; i < 26; i++) { const m = new T.Mesh(new T.PlaneGeometry(1.2, 1.4), eg(R() < 0.8 ? '#ffb870' : '#9ab8ff', 0.3 + R() * 0.5)); m.position.set(-45 + i * 3.5, 2 + R() * 14, z); m.lookAt(0, 4, 0); envScene.add(m); }
    const pmrem = new T.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(envScene, 0.02).texture; pmrem.dispose(); disposables.push(envTex);
    scene.environment = envTex;

    // ---- rain
    let rain = null;
    if (weather === 'rain' || weather === 'drizzle') {
      const n = weather === 'rain' ? 2200 : 900, pos = new Float32Array(n * 6), vel = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (R() - 0.5) * 40, y = R() * 16, z = (R() - 0.5) * 30, l = 0.35 + R() * 0.3; pos.set([x, y, z, x + 0.05, y + l, z], i * 6); vel[i] = 11 + R() * 5; }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      rain = new T.LineSegments(geo, new T.LineBasicMaterial({ color: lin('#9fb6cc').multiplyScalar(weather === 'rain' ? 1.5 : 1.1), transparent: true, opacity: weather === 'rain' ? 0.45 : 0.3, blending: T.AdditiveBlending, depthWrite: false }));
      rain.userData.vel = vel; rain.frustumCulled = false; scene.add(rain);
    }

    // ---- rubbernecking traffic in the open lane
    const passers = [];
    function spawnPasser(x) {
      const c = car(pick(['sedan', 'hatch', 'suv', 'wagon', 'sedan']), pick(['#d9dee5', '#b7bec8', '#5d6675', '#2f394b', '#39598a', '#8f2f30', '#e8e9ea', '#1f2633', '#6c7f96', '#2f5448']), { brake: true });
      c.position.set(x, 0, -3.5); scene.add(c);
      const beamM = new T.Mesh(new T.PlaneGeometry(9, 4), new T.MeshBasicMaterial({ map: aoTex, color: lin('#fff1d6').multiplyScalar(0.35), transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
      beamM.rotation.x = -Math.PI / 2; beamM.position.set(c.userData.S.L / 2 + 4, 0.02, 0); c.add(beamM);
      passers.push({ c, v: 7 + R() * 3 });
    }
    spawnPasser(-85); spawnPasser(-112);

    return {
      sky, scene, env, weather, time, carType, sch, wreck, truck, deck, cable, rams, lights, amberMs, redM, blueM, redG, blueG, hazardLight, flickerHead,
      tWheels, workSpot, keyLight, rain, passers, spawnPasser, flares, police, disposables, R,
    };
  }

  // ---------------------------------------------------------------- cameras: three cut sequences
  const SHOTS = [
    [ // classic: low by the wreck, wide side, close on the winch, rising as the truck leaves
      { t: 0, d: 3.4, f(u) { return { p: lerp3([7, 1.1, 5.2], [5.5, 1.35, 5.3], ease(u)), l: lerp3([-3, 0.9, -1.2], [-1, 0.9, -0.8], ease(u)), fov: 42 }; } },
      { t: 3.4, d: 3.8, f(u) { return { p: lerp3([-2.5, 2.2, 5.3], [0.5, 2.6, 5.3], ease(u)), l: [5.5, 1.1, -0.5], fov: 50 }; } },
      { t: 7.2, d: 3.4, f(u, S, w) { return { p: lerp3([0.5, 0.8, 4.3], [3.8, 1.6, 4.6], ease(u)), l: [w.x, w.y + 0.7, w.z], fov: 38 }; } },
      { t: 10.6, d: 9, f(u, S, w, tx) { return { p: lerp3([tx - 11, 4.2, 3.2], [tx - 17, 7.6, 1.5], ease(u)), l: [Math.min(tx + 2, 30), 1.3, 0], fov: 46 }; } },
    ],
    [ // drone opener, from beside the police car, low front three-quarter, chase
      { t: 0, d: 3.4, f(u) { return { p: lerp3([-8, 17, 5], [-2, 7.5, 4.5], ease(u)), l: lerp3([0, 0, 0], [3, 0.5, 0], ease(u)), fov: 50 }; } },
      { t: 3.4, d: 3.8, f(u) { return { p: lerp3([-12.5, 1.35, 1.3], [-11.2, 1.5, 1.6], ease(u)), l: [4, 1.1, -0.2], fov: 36 }; } },
      { t: 7.2, d: 3.4, f(u, S, w) { return { p: lerp3([-3.2, 1.1, 4.4], [-1.6, 1.5, 4.8], ease(u)), l: [w.x + 1.5, w.y + 0.9, w.z], fov: 40 }; } },
      { t: 10.6, d: 9, f(u, S, w, tx) { return { p: lerp3([tx - 9, 2.4, 2.2], [tx - 7.5, 3.2, 2.2], ease(u)), l: [tx + 4, 1.5, 0], fov: 46 }; } },
    ],
    [ // a rubbernecker's view creeping past, then over the shoulder of the wreck, then high
      { t: 0, d: 3.4, f(u) { return { p: [lerp(-24, -8, easeOut(u)), 1.2, -3.5], l: [lerp(0, 2, u), 0.8, lerp(0.8, 0.3, u)], fov: 48 }; } },
      { t: 3.4, d: 3.8, f(u) { return { p: lerp3([13, 1.7, 5.0], [10.5, 2.3, 5.3], ease(u)), l: [3, 1, -0.5], fov: 44 }; } },
      { t: 7.2, d: 3.4, f(u, S, w) { return { p: lerp3([-2.4, 1.1, 2.6], [0.2, 1.5, 3.1], ease(u)), l: [w.x + 1.5, w.y + 0.9, w.z], fov: 40 }; } },
      { t: 10.6, d: 9, f(u, S, w, tx) { return { p: lerp3([-6, 7.5, 4.5], [-2, 8.2, 3.5], ease(u)), l: [Math.min(tx, 26), 0.5, 0], fov: 48 }; } },
    ],
  ];

  function play(opts) {
    const T = THREE, host = opts.host, R = rng((opts.seed || Date.now()) % 2147483647);
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    let pr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pr);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const post = hasPost();
    if (post) { renderer.toneMapping = T.NoToneMapping; renderer.outputEncoding = T.LinearEncoding; }
    else { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2; renderer.outputEncoding = T.sRGBEncoding; }
    host.prepend(renderer.domElement);
    renderer.domElement.className = 'tow-canvas';
    opts.post = hasPost();
    const S = build(opts, R, renderer), camera = new T.PerspectiveCamera(42, 1, 0.1, 900);
    const plan = SHOTS[Math.floor(R() * SHOTS.length)];

    // post: HDR render, bloom, then a film-like grade (ACES, vignette, grain, slight lens fringing)
    let composer = null, bloom = null, grade = null;
    if (post) {
      const gl2 = renderer.capabilities.isWebGL2, half = gl2 || renderer.extensions.has('EXT_color_buffer_half_float');
      const rt = new T.WebGLRenderTarget(2, 2, { type: half ? T.HalfFloatType : T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat });
      composer = new T.EffectComposer(renderer, rt);
      composer.addPass(new T.RenderPass(S.scene, camera));
      bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.85, 0.55, half ? 1.05 : 0.8);
      composer.addPass(bloom);
      grade = new T.ShaderPass({
        uniforms: { tDiffuse: { value: null }, time: { value: 0 }, exposure: { value: S.time === 'night' ? 1.25 : 1.1 }, res: { value: new T.Vector2(1, 1) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float exposure; uniform vec2 res; varying vec2 vUv;
          vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
          void main(){
            vec2 c = vUv - 0.5; float r2 = dot(c, c);
            vec3 col = vec3(texture2D(tDiffuse, vUv - c * 0.0035 * r2 * 4.0).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + c * 0.0035 * r2 * 4.0).b);
            col = aces(col * exposure);
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(col * vec3(0.92, 1.0, 1.08), col * vec3(1.05, 1.0, 0.94), smoothstep(0.2, 0.8, l));
            col = pow(col, vec3(1.0 / 2.2));
            col *= 1.0 - r2 * 1.1;
            float n = fract(sin(dot(vUv * res + time * 71.0, vec2(12.9898, 78.233))) * 43758.5453);
            col += (n - 0.5) * 0.03;
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      composer.addPass(grade);
    }
    function size() {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); bloom.resolution.set(w * pr / 2, h * pr / 2); grade.uniforms.res.value.set(w, h); }
    }
    size(); window.addEventListener('resize', size);

    const DUR = 15.5, LOAD_X = 5.45, THETA = 0.176, SLIDE = 2.2;
    const approach = [[-46, -3.5], [4, -3.5], [14, -3.5], [16.5, -3.5]];
    const reverse = [[16.5, -3.5], [11, -3.5], [10.5, 0], [LOAD_X, 0]];
    const wreck0 = { x: S.wreck.position.x, z: S.wreck.position.z, r: S.wreck.rotation.y };
    let attached = false, done = false, raf = 0, t0 = performance.now(), lastPos = null, lastT = 0, nextPasser = 2.5;
    const tmp = new T.Vector3(), tmp2 = new T.Vector3();
    const frameTimes = []; let lastNow = 0, downgraded = 0;

    function setTruck(x, z, yaw) {
      if (lastPos) { const d = Math.hypot(x - lastPos[0], z - lastPos[1]) * (lastPos[2] ? -1 : 1); for (const w of S.tWheels) w.rotation.z -= d / 0.5; }
      S.truck.position.set(x, 0, z); S.truck.rotation.y = yaw;
    }
    function frame(now) {
      if (done) return;
      // stay smooth on slower phones: step the resolution down, then drop bloom
      if (lastNow) { frameTimes.push(now - lastNow); if (frameTimes.length > 30) frameTimes.shift(); }
      lastNow = now;
      if (frameTimes.length === 30 && downgraded < 2 && typeof window.__towTime !== 'number') {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / 30;
        if (avg > 38) { downgraded++; frameTimes.length = 0; if (downgraded === 1) { pr = Math.max(1, pr * 0.7); renderer.setPixelRatio(pr); size(); } else if (bloom) { bloom.enabled = false; renderer.shadowMap.enabled = false; } }
      }
      const t = typeof window.__towTime === 'number' ? window.__towTime : (now - t0) / 1000, dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
      // truck
      if (t < 3.2) { const [x, z] = bez3(approach, easeOut(t / 3.2)); setTruck(x, z, 0); lastPos = [x, z, false]; }
      else if (t < 5.2) {
        const u = ease((t - 3.2) / 2), [x, z] = bez3(reverse, u), [x2, z2] = bez3(reverse, Math.min(1, u + 0.01));
        const fx = x - x2, fz = z - z2; setTruck(x, z, Math.hypot(fx, fz) > 1e-4 ? Math.atan2(-fz, fx) : 0); lastPos = [x, z, true];
      } else if (t > 11.2) { const u = (t - 11.2) / 2, x = LOAD_X + 30 * u * u; setTruck(x, 0, 0); lastPos = [x, 0, false]; }
      else setTruck(LOAD_X, 0, 0);
      // deck slides back and tilts, later returns
      const deckOut = ease(seg(t, 5.3, 6.4)) * (1 - ease(seg(t, 9.9, 11.0)));
      S.deck.position.x = 5.4 - SLIDE * Math.min(1, deckOut * 1.6);
      S.deck.rotation.z = THETA * clamp01((deckOut - 0.35) / 0.65);
      S.workSpot.intensity = t > 5.2 && t < 11 ? 2.2 : 0;
      // hydraulic rams from the frame to the underside of the deck
      for (const r of S.rams) {
        const a = new T.Vector3(3.3, 0.95, r.z), b = S.deck.localToWorld(new T.Vector3(-2.4, -0.1, r.z)); S.truck.worldToLocal(b);
        const d = b.clone().sub(a), L = d.length(); r.m.position.copy(a).add(b).multiplyScalar(0.5); r.m.scale.set(1, L, 1); r.m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
      }
      // winch the wreck: line it up on the ground, then up the deck
      const truckX = S.truck.position.x;
      if (t >= 6.6 && t < 7.6) {
        const u = ease(seg(t, 6.6, 7.6)), rearX = truckX + (5.4 - SLIDE) - 6.1 * Math.cos(THETA);
        S.wreck.position.x = wreck0.x + (rearX - 2.4 - wreck0.x) * u; S.wreck.position.z = wreck0.z * (1 - u); S.wreck.rotation.y = wreck0.r * (1 - u);
      }
      if (t >= 7.6 && !attached) { S.deck.attach(S.wreck); attached = true; S.wreck.userData.from = { x: S.wreck.position.x, y: S.wreck.position.y, z: S.wreck.position.z, rx: S.wreck.rotation.x, ry: S.wreck.rotation.y, rz: S.wreck.rotation.z }; }
      if (attached) {
        const f = S.wreck.userData.from, u = ease(seg(t, 7.6, 9.8));
        S.wreck.position.set(f.x + (-3.2 - f.x) * u, f.y + (0.09 - f.y) * u, f.z * (1 - u)); S.wreck.rotation.set(f.rx * (1 - u), f.ry * (1 - u), f.rz * (1 - u));
      }
      S.cable.visible = t > 6.3 && t < 10.0;
      if (S.cable.visible) {
        S.deck.localToWorld(tmp.set(-0.5, 0.35, 0)); S.wreck.localToWorld(tmp2.set(S.wreck.userData.S.L / 2 - 0.5, 0.3, 0));
        const a = S.cable.geometry.attributes.position; a.setXYZ(0, tmp.x, tmp.y, tmp.z); a.setXYZ(1, tmp2.x, tmp2.y, tmp2.z); a.needsUpdate = true;
      }
      // lights
      const blinkA = Math.floor(now / 260) % 2, strobe = Math.floor(now / 110) % 6;
      S.amberMs.forEach((m, i) => { const on = (i + blinkA) % 2; m.material.emissiveIntensity = on ? 7 : 0.2; m.userData.h.material.opacity = on ? 1 : 0; });
      S.lights.ambA.intensity = blinkA ? 2.6 : 0.2; S.lights.ambB.intensity = blinkA ? 0.2 : 2.6;
      if (S.police) {
        const redOn = strobe < 3 && strobe % 2 === 0, blueOn = strobe >= 3 && strobe % 2 === 1;
        S.redM.emissiveIntensity = redOn ? 9 : 0.1; S.blueM.emissiveIntensity = blueOn ? 9 : 0.1; S.redG.material.opacity = redOn ? 1 : 0; S.blueG.material.opacity = blueOn ? 1 : 0;
        S.lights.red.intensity = redOn ? 4 : 0; S.lights.blue.intensity = blueOn ? 4.5 : 0;
      }
      const hz = Math.floor(now / 480) % 2 ? 1 : 0;
      S.wreck.userData.hazards.forEach(m => { m.material.emissiveIntensity = hz * 6; m.userData.h.material.opacity = hz; }); S.hazardLight.intensity = hz ? 1 : 0;
      if (S.flickerHead && S.flickerHead.material.emissiveIntensity !== undefined) S.flickerHead.material.emissiveIntensity = Math.random() < 0.12 ? 0.3 : 5;
      if (S.flares.length) { const fl = 1.2 + Math.sin(now / 37) * 0.3 + Math.random() * 0.4; S.flares.light.intensity = fl; S.flares.forEach(f => { f.userData.h.material.opacity = 0.7 + Math.random() * 0.3; }); }
      if (S.scene.userData.trafficLight) { const ph = Math.floor(((now / 1000) % 12) / 4); S.scene.userData.trafficLight.forEach(([m, h], i) => { const on = i === [2, 1, 0][ph]; m.material.emissiveIntensity = on ? 8 : 0.05; h.material.opacity = on ? 1 : 0; }); }
      // rain follows the camera
      if (S.rain) {
        const p = S.rain.geometry.attributes.position, v = S.rain.userData.vel;
        for (let i = 0; i < v.length; i++) {
          let y = p.getY(i * 2) - v[i] * dt;
          if (y < 0) { y += 16; const x = camera.position.x + (Math.random() - 0.5) * 40, z = camera.position.z + (Math.random() - 0.5) * 30; p.setX(i * 2, x); p.setZ(i * 2, z); p.setX(i * 2 + 1, x + 0.05); p.setZ(i * 2 + 1, z); }
          const l = p.getY(i * 2 + 1) - p.getY(i * 2); p.setY(i * 2, y); p.setY(i * 2 + 1, y + l);
        }
        p.needsUpdate = true;
      }
      // passing traffic slows to look
      nextPasser -= dt; if (nextPasser <= 0 && typeof window.__towTime !== 'number') { S.spawnPasser(-60); nextPasser = 2.8 + S.R() * 3; }
      for (const pc of S.passers) {
        const x = pc.c.position.x, target = Math.abs(x) < 14 ? 3.5 : pc.v;
        pc.cur = pc.cur == null ? pc.v : pc.cur + (target - pc.cur) * Math.min(1, dt * 1.5);
        pc.c.position.x += pc.cur * dt; for (const w of pc.c.userData.wheels) w.rotation.z -= pc.cur * dt / pc.c.userData.S.r;
      }
      // camera: current shot with a little handheld drift
      let shot = plan[0]; for (const sh of plan) if (t >= sh.t) shot = sh;
      const w = new T.Vector3(); S.wreck.getWorldPosition(w);
      const c = shot.f(clamp01((t - shot.t) / shot.d), S, w, S.truck.position.x);
      const hh = 0.035;
      camera.position.set(c.p[0] + Math.sin(t * 1.3) * hh + Math.sin(t * 3.1) * hh * 0.4, c.p[1] + Math.sin(t * 1.7 + 1) * hh, c.p[2] + Math.sin(t * 1.1 + 2) * hh);
      camera.lookAt(c.l[0], c.l[1], c.l[2]);
      // tall phone screens crop the sides, so open the lens up in portrait
      const fov = camera.aspect < 1 ? Math.min(75, c.fov * (1 + (1 - camera.aspect) * 0.9)) : c.fov;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      S.sky.position.copy(camera.position);
      if (composer) { grade.uniforms.time.value = t; composer.render(); } else renderer.render(S.scene, camera);
      if (opts.onTick) opts.onTick(t / DUR);
      if (t >= DUR) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (opts.onDone) opts.onDone();
      setTimeout(() => {
        S.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { for (const k of ['map', 'emissiveMap', 'roughnessMap', 'bumpMap']) if (m[k]) m[k].dispose(); m.dispose(); }); } });
        S.disposables.forEach(d => d.dispose && d.dispose());
        if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
        renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
        renderer.domElement.remove();
      }, 700);
    }
    raf = requestAnimationFrame(frame);
    return { skip: finish, duration: DUR, look: { env: S.env, weather: S.weather, time: S.time, car: S.carType, company: S.sch.name, police: S.police } };
  }

  return { load, play };
})();
