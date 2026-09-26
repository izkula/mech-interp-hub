/* Snarl finale: a 3D replay of the flatbed tow truck clearing your crash while the score counts up.
 * Uses three.js r128 (loaded on demand from cdnjs). Everything is built from primitives; no assets.
 */
const Tow = (function () {
  'use strict';
  const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let loading = null;
  function load() {
    if (window.THREE) return Promise.resolve();
    if (!loading) {
      loading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = SRC; s.async = true; s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('three.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // ---------------------------------------------------------------- helpers
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = x => { x = clamp01(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
  const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  function build(opts) {
    const T = THREE, scene = new T.Scene();
    scene.background = new T.Color(0x0a0e15);
    scene.fog = new T.FogExp2(0x0a0e15, 0.028);
    const lights = {};
    const std = (color, extra) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.3 }, extra || {}));
    const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const glows = [];
    function glow(parent, x, y, z, color, size, on) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: on === false ? 0 : 1 }));
      sp.position.set(x, y, z); sp.scale.set(size, size, size); parent.add(sp); glows.push(sp); return sp;
    }
    const box = (w, h, d, mat) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

    // ---- ground: wet asphalt, markings, curbs, sidewalks
    const asphaltTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#2a2d33'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 30 + Math.random() * 40; g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.35 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(12,14,18,.25)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 8 + Math.random() * 24, Math.random() * 3, 0, 7); g.fill(); }
    });
    asphaltTex.wrapS = asphaltTex.wrapT = T.RepeatWrapping; asphaltTex.repeat.set(14, 2.5);
    const road = new T.Mesh(new T.PlaneGeometry(140, 10.5), std(0x70757e, { map: asphaltTex, roughness: 0.38, metalness: 0.3, envMapIntensity: 0.55 }));
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true; scene.add(road);
    const paint = std(0xdfe3ea, { roughness: 0.5, emissive: 0x222222 }), yellow = std(0xd9a82e, { roughness: 0.5, emissive: 0x2a1c00 });
    for (let x = -70; x < 70; x += 9) for (const z of [-1.75, 1.75]) { const m = new T.Mesh(new T.PlaneGeometry(3.4, 0.14), paint); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); scene.add(m); }
    for (const z of [-5.05, 5.05]) { const m = new T.Mesh(new T.PlaneGeometry(140, 0.14), z < 0 ? yellow : paint); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.01, z); scene.add(m); }
    const curbMat = std(0x6d7380, { roughness: 0.8 }), walkMat = std(0x3b414c, { roughness: 0.9 });
    for (const s of [-1, 1]) {
      const curb = box(140, 0.18, 0.3, curbMat); curb.position.set(0, 0.09, s * 5.4); scene.add(curb);
      const walk = box(140, 0.16, 4, walkMat); walk.position.set(0, 0.08, s * 7.55); scene.add(walk);
    }
    const ground = new T.Mesh(new T.PlaneGeometry(300, 300), std(0x0d1117, { roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);

    // ---- buildings with lit windows
    function winTex() {
      const lit = [];
      for (let y = 6; y < 250; y += 14) for (let x = 6; x < 122; x += 14) { const r = Math.random(); lit.push([x, y, r < 0.26 ? 'warm' : r < 0.31 ? 'cool' : '']); }
      const map = canvasTex(128, 256, (g, w, h) => {
        g.fillStyle = '#10141b'; g.fillRect(0, 0, w, h);
        for (const [x, y] of lit) { g.fillStyle = '#1b212b'; g.fillRect(x, y, 8, 9); }
      });
      const emi = canvasTex(128, 256, (g, w, h) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
        for (const [x, y, k] of lit) if (k) { g.fillStyle = k === 'warm' ? `rgb(255,${180 + Math.random() * 50 | 0},${110 + Math.random() * 40 | 0})` : 'rgb(150,185,255)'; g.globalAlpha = 0.45 + Math.random() * 0.55; g.fillRect(x, y, 8, 9); g.globalAlpha = 1; }
      });
      return [map, emi];
    }
    const texes = [winTex(), winTex(), winTex()];
    for (const s of [-1, 1]) {
      let x = -60;
      while (x < 60) {
        const w = 8 + Math.random() * 12, h = 8 + Math.random() * 26, d = 10 + Math.random() * 8;
        const [m0, e0] = texes[Math.floor(Math.random() * 3)], map = m0.clone(), emi = e0.clone();
        for (const t of [map, emi]) { t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(w / 8, h / 14); }
        const mat = std(0xffffff, { map, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 1.1, roughness: 0.85, envMapIntensity: 0.15 });
        const b = new T.Mesh(new T.BoxGeometry(w, h, d), mat); b.position.set(x + w / 2, h / 2, s * (9.8 + d / 2)); b.receiveShadow = true; scene.add(b);
        x += w + 0.8 + Math.random() * 2;
      }
    }

    // ---- street lights
    const poleMat = std(0x3a404a, { metalness: 0.6, roughness: 0.4 }), lampMat = std(0xffe2b0, { emissive: 0xffc27a, emissiveIntensity: 2 });
    function streetLight(x, s) {
      const g = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(0.09, 0.12, 7, 8), poleMat); pole.position.y = 3.5; g.add(pole);
      const arm = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 2.2), poleMat); arm.position.set(0, 6.95, -s * 1.1); g.add(arm);
      const lamp = new T.Mesh(new T.BoxGeometry(0.7, 0.14, 0.35), lampMat); lamp.position.set(0, 6.85, -s * 2.1); g.add(lamp);
      glow(g, 0, 6.7, -s * 2.1, 0xffc27a, 2.4);
      g.position.set(x, 0, s * 6.2); scene.add(g);
      const pl = new T.PointLight(0xffc58a, 1.6, 26, 2); pl.position.set(x, 6.4, s * 4.1); scene.add(pl);
      return pl;
    }
    streetLight(-7, -1); streetLight(12, 1); streetLight(30, -1);

    // ---- green street sign with the road name
    const label = (opts.road || '').toUpperCase();
    const signTex = canvasTex(1024, 220, (g, w, h) => {
      g.fillStyle = '#0b6a45'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e7efe9'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 96; g.font = `900 ${fs}px Overpass, "Arial Black", sans-serif`;
      while (g.measureText(label).width > w - 90 && fs > 20) { fs -= 4; g.font = `900 ${fs}px Overpass, "Arial Black", sans-serif`; }
      g.fillText(label, w / 2, h / 2 + 4);
    });
    const signMat = std(0xffffff, { map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.35, roughness: 0.5 });
    const sign = new T.Mesh(new T.PlaneGeometry(5.2, 1.12), signMat); sign.position.set(-4, 5.6, -6.25); scene.add(sign);
    const sp = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 5.2, 8), poleMat); sp.position.set(-6.8, 2.6, -6.3); scene.add(sp);
    const spa = new T.Mesh(new T.BoxGeometry(3, 0.08, 0.08), poleMat); spa.position.set(-5.3, 5.6, -6.3); scene.add(spa);

    // ---- vehicles
    function wheel(r, w) {
      const g = new T.Group();
      const tire = new T.Mesh(new T.CylinderGeometry(r, r, w, 20), std(0x111317, { roughness: 0.9 })); tire.rotation.x = Math.PI / 2; tire.castShadow = true; g.add(tire);
      const rim = new T.Mesh(new T.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12), std(0xb7bec8, { metalness: 0.85, roughness: 0.3 })); rim.rotation.x = Math.PI / 2; g.add(rim);
      const hub = new T.Mesh(new T.BoxGeometry(r * 0.9, r * 0.18, w + 0.04), std(0x5a616b, { metalness: 0.7, roughness: 0.4 })); g.add(hub);
      return g;
    }
    function extrude(points, depth, bevel, mat) {
      const sh = new T.Shape(points.map(p => new T.Vector2(p[0], p[1])));
      const geo = new T.ExtrudeGeometry(sh, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
      geo.translate(0, 0, -(depth - 2 * bevel) / 2); geo.computeVertexNormals();
      const m = new T.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
    }
    const glassMat = std(0x0c121b, { metalness: 0.6, roughness: 0.05, envMapIntensity: 1.4 });
    function car(color, crumple) {
      const g = new T.Group(), body = new T.Group(); g.add(body);
      const paintMat = std(color, { metalness: 0.6, roughness: 0.26, envMapIntensity: 1.1 });
      const shell = extrude([[-2.2, 0.32], [2.2, 0.32], [2.26, 0.62], [2.12, 0.8], [0.92, 0.93], [0.34, 1.38], [-0.95, 1.42], [-1.76, 0.99], [-2.2, 0.92], [-2.26, 0.56]], 1.78, 0.08, paintMat);
      if (crumple) {
        const pos = shell.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (x > 1.2) { const k = (x - 1.2) / 1.1; pos.setX(i, x - k * k * 0.55 * (0.8 + 0.4 * Math.sin(z * 5 + y * 3))); pos.setY(i, y - (y > 0.7 ? k * 0.22 : 0)); pos.setZ(i, z * (1 - k * 0.05)); }
        }
        shell.geometry.computeVertexNormals();
      }
      body.add(shell);
      const glass = extrude([[0.78, 0.97], [0.3, 1.34], [-0.9, 1.38], [-1.62, 1.0]], 1.8, 0.03, glassMat); glass.position.y = 0.012; body.add(glass);
      if (crumple) glass.scale.set(0.97, 0.98, 1);
      const head = std(0xfff4dc, { emissive: crumple ? 0x221d10 : 0xfff0c8, emissiveIntensity: 1.2 });
      const tail = std(0x5a0a0a, { emissive: 0xff2a1a, emissiveIntensity: 0.9 });
      for (const z of [-0.62, 0.62]) {
        const hl = new T.Mesh(new T.BoxGeometry(0.06, 0.12, 0.34), head); hl.position.set(crumple ? 1.8 : 2.22, 0.7, z); body.add(hl);
        const tl = new T.Mesh(new T.BoxGeometry(0.06, 0.12, 0.3), tail); tl.position.set(-2.26, 0.78, z); body.add(tl);
        glow(body, -2.32, 0.78, z, 0xff2a1a, 0.55);
        if (!crumple) glow(body, 2.3, 0.7, z, 0xfff0d0, 0.8);
      }
      const hz = [];
      for (const [x, z] of [[2.05, -0.8], [2.05, 0.8], [-2.2, -0.8], [-2.2, 0.8]]) {
        const m = new T.Mesh(new T.BoxGeometry(0.1, 0.07, 0.12), std(0x4a2a00, { emissive: 0xffa21a, emissiveIntensity: 0 })); m.position.set(x, 0.62, z); body.add(m); hz.push(m);
        m.userData.glow = glow(body, x + Math.sign(x) * 0.08, 0.62, z, 0xffa21a, 0.9, false);
      }
      const wheels = [];
      for (const [x, z] of [[1.4, -0.82], [1.4, 0.82], [-1.38, -0.82], [-1.38, 0.82]]) { const w = wheel(0.34, 0.24); w.position.set(x, 0.34, z); g.add(w); wheels.push(w); }
      if (crumple) { wheels[0].rotation.y = 0.35; wheels[0].position.y = 0.3; body.rotation.z = -0.02; body.rotation.x = 0.015; }
      g.userData = { hazards: hz, wheels };
      return g;
    }

    // crashed car
    const wreck = car(opts.color || 0x8f2f30, true);
    wreck.position.set(0, 0, 0.35); wreck.rotation.y = 0.32; scene.add(wreck);
    const hazardLight = new T.PointLight(0xffa21a, 0, 7, 2); hazardLight.position.set(0, 1.2, 0); wreck.add(hazardLight);

    // debris, glass and cones
    const shardMat = std(0xcfe6ff, { metalness: 0.9, roughness: 0.05, emissive: 0x223344 });
    for (let i = 0; i < 70; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(0.05 + Math.random() * 0.07, 0.04 + Math.random() * 0.05), shardMat);
      const a = Math.random() * 6.28, r = Math.random() * 2.4;
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(2.4 + Math.cos(a) * r, 0.012, 0.5 + Math.sin(a) * r * 0.8); scene.add(m);
    }
    const bumper = box(0.5, 0.14, 1.5, std(opts.color || 0x8f2f30, { metalness: 0.5, roughness: 0.35 })); bumper.position.set(3.4, 0.07, -0.7); bumper.rotation.y = 0.9; scene.add(bumper);
    const coneMat = std(0xff6a13, { roughness: 0.5, emissive: 0x301000 }), stripeMat = std(0xf2f2f2, { emissive: 0x333333 });
    for (let i = 0; i < 4; i++) {
      const g = new T.Group(); const c = new T.Mesh(new T.ConeGeometry(0.2, 0.7, 14), coneMat); c.position.y = 0.39; c.castShadow = true; g.add(c);
      const st = new T.Mesh(new T.CylinderGeometry(0.115, 0.14, 0.12, 14), stripeMat); st.position.y = 0.44; g.add(st);
      const base = box(0.46, 0.05, 0.46, coneMat); base.position.y = 0.025; g.add(base);
      g.position.set(-3.0 - i * 1.1, 0, -1.6 + i * 0.75); scene.add(g);
    }

    // police car behind with light bar
    const police = car(0x1d2330, false);
    const doorWhite = box(1.9, 0.5, 1.84, std(0xe8ebef, { metalness: 0.4, roughness: 0.35 })); doorWhite.position.set(-0.1, 0.62, 0); police.children[0].add(doorWhite);
    const bar = new T.Group(); bar.position.set(-0.35, 1.47, 0); police.children[0].add(bar);
    const redM = std(0x400000, { emissive: 0xff1a1a, emissiveIntensity: 0 }), blueM = std(0x000a40, { emissive: 0x2a55ff, emissiveIntensity: 0 });
    const rb = box(0.3, 0.12, 0.6, redM); rb.position.z = -0.35; bar.add(rb);
    const bb = box(0.3, 0.12, 0.6, blueM); bb.position.z = 0.35; bar.add(bb);
    const redG = glow(bar, 0, 0.1, -0.35, 0xff2020, 2.6, false), blueG = glow(bar, 0, 0.1, 0.35, 0x3a66ff, 2.6, false);
    police.position.set(-8.2, 0, -0.9); police.rotation.y = -0.16; scene.add(police);
    lights.red = new T.PointLight(0xff2020, 0, 22, 2); lights.red.position.set(-8.5, 2.2, -1.4); scene.add(lights.red);
    lights.blue = new T.PointLight(0x3060ff, 0, 22, 2); lights.blue.position.set(-8.5, 2.2, -0.3); scene.add(lights.blue);

    // ---- flatbed (rollback) tow truck; local +x is forward, origin at the rear of the chassis
    const truck = new T.Group(); scene.add(truck);
    const cabMat = std(0xf2b21d, { metalness: 0.45, roughness: 0.35 }), dark = std(0x1a1d22, { metalness: 0.4, roughness: 0.6 });
    const chassis = box(8.3, 0.35, 1.9, dark); chassis.position.set(4.15, 0.75, 0); truck.add(chassis);
    const cab = extrude([[0, 0.6], [2.55, 0.6], [2.62, 1.35], [2.25, 1.5], [1.85, 1.55], [1.5, 2.6], [0.05, 2.66], [0, 0.6]], 2.35, 0.07, cabMat);
    cab.position.set(5.65, 0.35, 0); truck.add(cab);
    const cabGlass = extrude([[1.83, 1.6], [1.47, 2.5], [0.25, 2.54], [0.2, 1.6]], 2.38, 0.02, glassMat); cabGlass.position.set(5.65, 0.35, 0); truck.add(cabGlass);
    const grille = box(0.06, 0.55, 1.6, std(0x9aa1aa, { metalness: 0.9, roughness: 0.25 })); grille.position.set(8.3, 1.25, 0); truck.add(grille);
    const tHead = std(0xfff4dc, { emissive: 0xfff0c8, emissiveIntensity: 1.5 });
    for (const z of [-0.85, 0.85]) { const hl = box(0.06, 0.18, 0.36, tHead); hl.position.set(8.3, 1.2, z); truck.add(hl); glow(truck, 8.42, 1.2, z, 0xfff0d0, 1.4); }
    for (const z of [-0.8, 0.8]) { const tl = box(0.06, 0.14, 0.25, std(0x5a0a0a, { emissive: 0xff2a1a, emissiveIntensity: 1 })); tl.position.set(-0.02, 0.8, z); truck.add(tl); glow(truck, -0.1, 0.8, z, 0xff2a1a, 0.7); }
    // amber light bar on the cab roof
    const amberMs = [];
    for (const z of [-0.8, -0.27, 0.27, 0.8]) { const m = box(0.3, 0.16, 0.42, std(0x4a2a00, { emissive: 0xffa21a, emissiveIntensity: 0 })); m.position.set(6.4, 3.12, z); truck.add(m); amberMs.push(m); m.userData.glow = glow(truck, 6.4, 3.2, z, 0xffa21a, 1.6, false); }
    const barBase = box(0.36, 0.06, 2.0, dark); barBase.position.set(6.4, 3.02, 0); truck.add(barBase);
    lights.ambA = new T.PointLight(0xffa21a, 0, 18, 2); lights.ambA.position.set(6.4, 3.4, -0.9); truck.add(lights.ambA);
    lights.ambB = new T.PointLight(0xffa21a, 0, 18, 2); lights.ambB.position.set(6.4, 3.4, 0.9); truck.add(lights.ambB);
    const headSpot = new T.SpotLight(0xfff0d0, 2.4, 40, 0.5, 0.6, 1.5); headSpot.position.set(8.4, 1.2, 0); truck.add(headSpot);
    headSpot.target.position.set(20, 0, 0); truck.add(headSpot.target);
    const tWheels = [];
    for (const [x, z] of [[1.3, -0.95], [1.3, 0.95], [2.4, -0.95], [2.4, 0.95], [7.1, -0.95], [7.1, 0.95]]) { const w = wheel(0.5, 0.36); w.position.set(x, 0.5, z); truck.add(w); tWheels.push(w); }
    // tilting deck: pivot near the front, deck extends backwards
    const deck = new T.Group(); deck.position.set(5.4, 1.12, 0); truck.add(deck);
    const deckMat = std(0x9aa3ad, { metalness: 0.75, roughness: 0.35 });
    const plate = box(6.1, 0.2, 2.35, deckMat); plate.position.set(-3.05, 0, 0); deck.add(plate);
    for (const z of [-1.18, 1.18]) { const rail = box(6.1, 0.18, 0.08, std(0xf2b21d, { metalness: 0.4, roughness: 0.4 })); rail.position.set(-3.05, 0.15, z); deck.add(rail); }
    for (let x = -5.8; x < -0.2; x += 0.7) { const rib = box(0.05, 0.03, 2.3, dark); rib.position.set(x, 0.115, 0); deck.add(rib); }
    const headboard = box(0.12, 1.1, 2.35, dark); headboard.position.set(-0.1, 0.6, 0); deck.add(headboard);
    const winch = box(0.35, 0.3, 0.5, std(0x2a2e35, { metalness: 0.6 })); winch.position.set(-0.4, 0.3, 0); deck.add(winch);
    const cableGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
    const cable = new T.Line(cableGeo, new T.LineBasicMaterial({ color: 0x9aa3ad })); cable.visible = false; scene.add(cable);

    // ---- moonlight with shadows, soft fill
    scene.add(new T.HemisphereLight(0x2c3a58, 0x07080b, 0.28));
    const moon = new T.DirectionalLight(0x9fb4ff, 0.22); moon.position.set(-14, 26, 12); moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024); Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 14, bottom: -14, near: 1, far: 70 });
    scene.add(moon);

    // smoke sprites
    const smokeTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(180,185,195,.55)'); gr.addColorStop(1, 'rgba(180,185,195,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const smoke = [];
    for (let i = 0; i < 18; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true, opacity: 0 }));
      s.userData.phase = i / 18; scene.add(s); smoke.push(s);
    }

    // night-city reflection environment: dark sky, warm street lamps, rows of lit windows
    const env = new T.Scene(); env.background = new T.Color(0x05070b);
    const envGlow = (c, i) => new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(i) });
    for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.PlaneGeometry(1.6, 0.5), envGlow(0xffc27a, 3)); m.position.set(-30 + i * 7, 9, i % 2 ? 6 : -6); m.lookAt(0, 0, 0); env.add(m); }
    for (const z of [-14, 14]) for (let i = 0; i < 24; i++) { const m = new T.Mesh(new T.PlaneGeometry(1.2, 1.4), envGlow(Math.random() < 0.8 ? 0xffb870 : 0x9ab8ff, 0.25 + Math.random() * 0.35)); m.position.set(-40 + i * 3.5, 2 + Math.random() * 14, z); m.lookAt(0, 4, 0); env.add(m); }
    const pmrem = new T.PMREMGenerator(opts.renderer);
    scene.environment = pmrem.fromScene(env, 0.03).texture; pmrem.dispose();

    return { redG, blueG, scene, wreck, truck, deck, cable, lights, amberMs, redM, blueM, hazardLight, tWheels, smoke, police };
  }

  // cubic bezier on the ground plane
  const bez3 = (p, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); };

  function play(opts) {
    const T = THREE, host = opts.host;
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
    host.prepend(renderer.domElement);
    renderer.domElement.className = 'tow-canvas';
    opts.renderer = renderer;
    const S = build(opts), camera = new T.PerspectiveCamera(42, 1, 0.1, 400);
    function size() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 58 : 42; camera.updateProjectionMatrix(); }
    size(); window.addEventListener('resize', size);

    const DUR = 13.2, LOAD_X = 5.45, THETA = 0.176, SLIDE = 2.2;
    const approach = [[-46, -3.5], [4, -3.5], [14, -3.5], [16.5, -3.5]];
    const reverse = [[16.5, -3.5], [11, -3.5], [10.5, 0], [LOAD_X, 0]];
    const wreck0 = { x: S.wreck.position.x, z: S.wreck.position.z, r: S.wreck.rotation.y };
    let attached = false, done = false, raf = 0, t0 = performance.now(), lastPos = null, lastT = 0;
    const camPos = new T.Vector3(-9, 1.6, 7), camLook = new T.Vector3(0, 0.8, 0);
    const tmp = new T.Vector3(), tmp2 = new T.Vector3();

    function setTruck(x, z, yaw) {
      const p = S.truck.position;
      if (lastPos) { const d = Math.hypot(x - lastPos[0], z - lastPos[1]) * (lastPos[2] ? -1 : 1); for (const w of S.tWheels) w.rotation.z -= d / 0.5; }
      p.set(x, 0, z); S.truck.rotation.y = yaw;
    }
    function frame(now) {
      if (done) return;
      // window.__towTime lets automated checks freeze the replay at an exact moment
      const t = typeof window.__towTime === 'number' ? window.__towTime : (now - t0) / 1000, fdt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
      // --- truck motion
      if (t < 3.2) {
        const [x, z] = bez3(approach, easeOut(t / 3.2)); setTruck(x, z, 0); lastPos = [x, z, false];
      } else if (t < 5.2) {
        const u = ease((t - 3.2) / 2), [x, z] = bez3(reverse, u), [x2, z2] = bez3(reverse, Math.min(1, u + 0.01));
        const fx = x - x2, fz = z - z2; // facing is opposite to the reversing direction
        setTruck(x, z, Math.hypot(fx, fz) > 1e-4 ? Math.atan2(-fz, fx) : 0); lastPos = [x, z, true];
      } else if (t > 11.2) {
        const u = (t - 11.2) / 2, x = LOAD_X + 30 * u * u; setTruck(x, 0, 0); lastPos = [x, 0, false];
      }
      // --- deck: slide back and tilt, then return
      const deckOut = ease(seg(t, 5.3, 6.4)) * (1 - ease(seg(t, 9.9, 11.0)));
      S.deck.position.x = 5.4 - SLIDE * Math.min(1, deckOut * 1.6);
      S.deck.rotation.z = THETA * clamp01((deckOut - 0.35) / 0.65);
      // --- winch the wreck: straighten on the ground, then up the deck
      const truckX = S.truck.position.x;
      if (t >= 6.6 && t < 7.6) {
        const u = ease(seg(t, 6.6, 7.6));
        const rearX = truckX + (5.4 - SLIDE) - 6.1 * Math.cos(THETA);
        S.wreck.position.x = wreck0.x + (rearX - 2.35 - wreck0.x) * u; S.wreck.position.z = wreck0.z * (1 - u); S.wreck.rotation.y = wreck0.r * (1 - u);
      }
      if (t >= 7.6 && !attached) { S.deck.attach(S.wreck); attached = true; S.wreck.userData.from = { x: S.wreck.position.x, y: S.wreck.position.y, z: S.wreck.position.z, rx: S.wreck.rotation.x, ry: S.wreck.rotation.y, rz: S.wreck.rotation.z }; }
      if (attached) {
        const f = S.wreck.userData.from, u = ease(seg(t, 7.6, 9.8));
        S.wreck.position.set(f.x + (-3.3 - f.x) * u, f.y + (0.1 - f.y) * u, f.z * (1 - u));
        S.wreck.rotation.set(f.rx * (1 - u), f.ry * (1 - u), f.rz * (1 - u));
      }
      // cable from winch to the wreck's front tow hook
      S.cable.visible = t > 6.3 && t < 10.0;
      if (S.cable.visible) {
        S.deck.localToWorld(tmp.set(-0.5, 0.35, 0));
        S.wreck.localToWorld(tmp2.set(2.0, 0.35, 0));
        const a = S.cable.geometry.attributes.position; a.setXYZ(0, tmp.x, tmp.y, tmp.z); a.setXYZ(1, tmp2.x, tmp2.y, tmp2.z); a.needsUpdate = true;
      }
      // --- lights
      const blinkA = Math.floor(now / 260) % 2, strobe = Math.floor(now / 110) % 6;
      S.amberMs.forEach((m, i) => { const on = (i + blinkA) % 2; m.material.emissiveIntensity = on ? 3 : 0.2; m.userData.glow.material.opacity = on ? 1 : 0; });
      S.lights.ambA.intensity = blinkA ? 2.2 : 0.2; S.lights.ambB.intensity = blinkA ? 0.2 : 2.2;
      const redOn = strobe < 3 && strobe % 2 === 0, blueOn = strobe >= 3 && strobe % 2 === 1;
      S.redM.emissiveIntensity = redOn ? 4 : 0.1; S.blueM.emissiveIntensity = blueOn ? 4 : 0.1;
      S.lights.red.intensity = redOn ? 3.2 : 0; S.lights.blue.intensity = blueOn ? 3.6 : 0;
      S.redG.material.opacity = redOn ? 1 : 0; S.blueG.material.opacity = blueOn ? 1 : 0;
      const hz = Math.floor(now / 480) % 2 ? 2.5 : 0;
      S.wreck.userData.hazards.forEach(m => { m.material.emissiveIntensity = hz; m.userData.glow.material.opacity = hz ? 1 : 0; }); S.hazardLight.intensity = hz ? 0.8 : 0;
      // --- smoke drifting from the wreck's crushed front
      S.wreck.localToWorld(tmp.set(1.9, 0.9, 0));
      S.smoke.forEach(s => {
        const ph = (t * 0.22 + s.userData.phase) % 1;
        s.position.set(tmp.x + ph * 2.2, tmp.y + ph * 2.6, tmp.z - ph * 0.8);
        const k = 0.6 + ph * 2.4; s.scale.set(k, k, k); s.material.opacity = 0.32 * Math.sin(ph * Math.PI) * (1 - seg(t, 8, 11));
      });
      // --- camera: three shots, damped
      let cp, cl;
      const tx = S.truck.position.x;
      if (t < 3.4) { const u = ease(t / 3.4); cp = [6.5 - 1.5 * u, 1.25 + 0.3 * u, 4.6 + 0.6 * u]; cl = [-2.5 + 1.5 * u, 0.9, -0.6]; }
      else if (t < 10.6) { const u = ease(seg(t, 3.4, 10.6)); cp = [-1.5 + 6 * u, 2.4 + 1.2 * u, 8.8 - 1.4 * u]; cl = [2.6 + 1.2 * u, 0.9 + 0.4 * u, 0]; }
      else { const u = ease(seg(t, 10.6, DUR)); cp = [tx - 3 - 6 * u, 3.4 + 2.2 * u, 7.6 + 2.5 * u]; cl = [tx + 1.5, 1.3, 0]; }
      const damp = t < 0.05 || typeof window.__towTime === 'number' ? 1 : 1 - Math.exp(-fdt * 6);
      camPos.lerp(tmp.set(cp[0], cp[1], cp[2]), damp); camLook.lerp(tmp2.set(cl[0], cl[1], cl[2]), damp);
      camera.position.copy(camPos); camera.lookAt(camLook);
      renderer.render(S.scene, camera);
      if (opts.onTick) opts.onTick(t / DUR);
      if (t >= DUR) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (opts.onDone) opts.onDone();
      setTimeout(() => {
        S.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
        renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
        renderer.domElement.remove();
      }, 700);
    }
    raf = requestAnimationFrame(frame);
    return { skip: finish, duration: DUR };
  }

  return { load, play };
})();
