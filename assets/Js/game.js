/*
 * Web Hunter: a 3D bug-popping arena game.
 * Plain JavaScript + three.js r128 (loaded from a CDN in index.html).
 * Tweak the numbers in the "settings" block to change how the game feels.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function fail(title, text) {
    $('ovTitle').textContent = title;
    $('ovText').textContent = text;
    $('ovBtn').style.display = 'none';
    $('overlay').classList.add('show');
  }

  if (typeof THREE === 'undefined') {
    fail("Couldn't load the 3D engine", 'Check your connection and reload the page.');
    return;
  }

  /* ---------------------------------------------------------------- settings */
  const R = 28;               // island radius
  const EYE = 1.6;            // eye height
  const PLAYER_R = 0.45;
  const WALK = 7;
  const SPRINT = 11.5;
  const JUMP_V = 8.5;
  const SLIDE_SPEED = 17;       // short movement burst while sliding
  const SLIDE_DURATION = 0.62; // seconds
  const SLIDE_COOLDOWN = 1.15; // seconds between slides
  const GRAVITY = 26;
  const FIRE_DELAY = 0.17;    // seconds between shots
  const MAX_BUGS = 20;        // bugs alive at once
  const COMBO_WINDOW = 2.6;   // seconds to keep a combo alive
  const TAU = Math.PI * 2;

  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  document.body.classList.toggle('touch', isTouch);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => Number(n).toLocaleString('en-US');

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadBest() { try { return Number(localStorage.getItem('webhunter-best')) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('webhunter-best', String(v)); } catch (e) { /* storage blocked */ } }

  /* ---------------------------------------------------------------- renderer */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
  } catch (err) {
    fail('WebGL is turned off', 'Web Hunter needs WebGL. Turn on hardware acceleration in your browser settings, then reload.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xfbe2bd);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('stage').appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xfbe2bd, 0.007);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = camera.aspect < 1 ? 86 : 72;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);
  onResize();

  const flat = (color, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ color: color, flatShading: true, roughness: 0.85, metalness: 0 }, extra || {}));

  /* ------------------------------------------------------------------- world */
  // Each map recolors the sky, light and ground and picks its own cover (mushrooms, cacti, pines, crystals).
  const MAPS = [
    { name: 'Mushroom Meadow', seed: 7, n: 10, gap: 8, cover: 'mushroom',
      sky: ['#4f9fe3', '#a8d6f2', '#fbe2bd', '#f1ac84'], fog: 0xfbe2bd, fogD: 0.007,
      hemi: [0xcfe8ff, 0xe3c39a, 0.75], sun: [0xfff0d0, 1.15, [22, 40, 14]], cloud: 0xffffff,
      ground: ['#6dbb4c', 'rgba(73,150,60,0.35)', 'rgba(150,214,98,0.35)'], under: 0x8b5a3c,
      rock: [0xb9a58b, 0xa89578], decor: [0xfff4de, 0xff8fb3, 0xffd23f], decorN: 70 },
    { name: 'Dusty Mesa', seed: 31, n: 11, gap: 7, cover: 'cactus',
      sky: ['#e5655a', '#f7a26b', '#ffe0a8', '#e8996f'], fog: 0xffe0a8, fogD: 0.008,
      hemi: [0xffe2c4, 0xd9a066, 0.8], sun: [0xffd199, 1.3, [-30, 26, 10]], cloud: 0xffd6c0,
      ground: ['#e3b873', 'rgba(196,140,80,0.35)', 'rgba(247,215,150,0.4)'], under: 0xb5653a,
      rock: [0xc9794a, 0xa8603a], decor: [0xff6b81, 0xffd23f], decorN: 40 },
    { name: 'Frostbite Peak', seed: 53, n: 10, gap: 8, cover: 'pine', snow: true,
      sky: ['#8fc4f0', '#c9e6fb', '#f2f8ff', '#cfe3f5'], fog: 0xeaf4ff, fogD: 0.01,
      hemi: [0xdff0ff, 0xaec4e0, 0.9], sun: [0xffffff, 0.95, [15, 36, 25]], cloud: 0xffffff,
      ground: ['#f2f7ff', 'rgba(190,215,245,0.45)', 'rgba(255,255,255,0.6)'], under: 0x6f8fb5,
      rock: [0x9fb4cf, 0x8aa0bf], decor: [0xbfe6ff, 0xffffff], decorN: 50 },
    { name: 'Crystal Night', seed: 77, n: 10, gap: 8, cover: 'crystal', stars: true, glow: true,
      sky: ['#0a0f2e', '#1b2a63', '#4a3a8a', '#2a1d4a'], fog: 0x2a2358, fogD: 0.009,
      hemi: [0x7a8be6, 0x35255a, 0.8], sun: [0x9db4ff, 0.9, [-20, 35, -10]], cloud: 0x6a5aa8,
      ground: ['#2e2f6b', 'rgba(30,24,80,0.5)', 'rgba(90,70,170,0.35)'], under: 0x24214f,
      rock: [0x4a4a8f, 0x3c3a75], decor: [0x7dfcff, 0xff7de0, 0xfff08a], decorN: 80 }
  ];
  const RESPAWN_POOL = [1, 2, 3];   // after you die, the next hunt starts on one of these at random
  let mapIndex = 0, pendingMap = null;

  // Shared by every map: sky dome, lights, clouds, stars, snow. loadMap() recolors them.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  function paintSky(stops) {
    const g = skyCanvas.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
    [0, 0.38, 0.5, 1].forEach((p, i) => grad.addColorStop(p, stops[i]));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    skyTex.needsUpdate = true;
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  dome.renderOrder = -1;
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xe3c39a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -(R + 3);
  sun.shadow.camera.right = R + 3;
  sun.shadow.camera.top = R + 3;
  sun.shadow.camera.bottom = -(R + 3);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 100;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35 });
  const clouds = new THREE.Group();
  {
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    const rnd = mulberry32(5);
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      const parts = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < parts; j++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        const s = 3 + rnd() * 3;
        m.scale.set(s, s * 0.6, s * 0.9);
        m.position.set((j - parts / 2) * 3.2, rnd() * 1.2, rnd() * 2);
        c.add(m);
      }
      const a = rnd() * TAU, d = 55 + rnd() * 70;
      c.position.set(Math.cos(a) * d, -18 + rnd() * 55, Math.sin(a) * d);
      c.rotation.y = rnd() * TAU;
      clouds.add(c);
    }
  }
  scene.add(clouds);

  const stars = (() => {
    const rnd = mulberry32(3), arr = new Float32Array(1500);
    for (let i = 0; i < 500; i++) {
      const a = rnd() * TAU, y = rnd() * 1.2 - 0.2, k = Math.sqrt(Math.max(0, 1 - y * y));
      arr[i * 3] = Math.cos(a) * k * 250; arr[i * 3 + 1] = y * 250; arr[i * 3 + 2] = Math.sin(a) * k * 250;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, depthWrite: false }));
    p.renderOrder = -1; p.frustumCulled = false; p.visible = false;
    scene.add(p);
    return p;
  })();

  const SNOW_N = 260, snowPos = new Float32Array(SNOW_N * 3);
  const snowGeo = new THREE.BufferGeometry();
  {
    const rnd = mulberry32(9);
    for (let i = 0; i < SNOW_N; i++) {
      snowPos[i * 3] = (rnd() * 2 - 1) * R; snowPos[i * 3 + 1] = rnd() * 18; snowPos[i * 3 + 2] = (rnd() * 2 - 1) * R;
    }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  }
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false }));
  snow.frustumCulled = false;
  snow.visible = false;
  scene.add(snow);
  function updateSnow(dt, t) {
    for (let i = 0; i < SNOW_N; i++) {
      snowPos[i * 3 + 1] -= dt * (1.2 + (i % 5) * 0.25);
      snowPos[i * 3] += Math.sin(t + i) * dt * 0.4;
      if (snowPos[i * 3 + 1] < 0) snowPos[i * 3 + 1] = 18;
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  // The current island lives in mapGroup and is rebuilt by loadMap()
  const mapGroup = new THREE.Group();
  scene.add(mapGroup);
  const targets = [];   // meshes bullets can hit
  const shrooms = [];   // cover collision circles {x, z, r}

  function disposeObj(o) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  }

  function groundTexture(colors, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d'), rnd = mulberry32(seed);
    g.fillStyle = colors[0];
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = colors[1 + (rnd() < 0.5 ? 0 : 1)];
      g.beginPath();
      g.arc(rnd() * 512, rnd() * 512, 6 + rnd() * 34, 0, TAU);
      g.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // Cover factories: each returns a function (group, rnd, index) that builds one piece and returns {r, hits}
  const COVER = {
    mushroom() {
      const caps = [flat(0x9b6fd0, { side: THREE.DoubleSide }), flat(0x8260c4, { side: THREE.DoubleSide })];
      const stemM = flat(0xf3e4c8), gillM = flat(0xe6c99a), spotM = flat(0xfff4de);
      return (g, rnd, i) => {
        const sr = 0.55 + rnd() * 0.4, h = 3.3 + rnd() * 1.4, capR = sr * 2.4;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.8, sr, h, 10), stemM);
        stem.position.y = h / 2; stem.castShadow = true; stem.receiveShadow = true;
        const capGeo = new THREE.SphereGeometry(capR, 14, 7, 0, TAU, 0, Math.PI / 2);
        capGeo.scale(1, 0.7, 1);
        const cap = new THREE.Mesh(capGeo, caps[i % 2]);
        cap.position.y = h - 0.1; cap.castShadow = true;
        const gills = new THREE.Mesh(new THREE.CircleGeometry(capR, 14), gillM);
        gills.rotation.x = Math.PI / 2; gills.position.y = h - 0.09;
        g.add(stem, cap, gills);
        for (let k = 0; k < 6; k++) {
          const phi = 0.25 + rnd() * 0.9, az = rnd() * TAU;
          const spot = new THREE.Mesh(new THREE.SphereGeometry(capR * 0.11, 6, 4), spotM);
          spot.scale.y = 0.55;
          spot.position.set(capR * Math.sin(phi) * Math.cos(az) * 0.99, h - 0.1 + capR * 0.7 * Math.cos(phi) * 0.99, capR * Math.sin(phi) * Math.sin(az) * 0.99);
          g.add(spot);
        }
        return { r: sr + 0.1, hits: [stem, cap] };
      };
    },
    cactus() {
      const gm = flat(0x4fa05a), fm = flat(0xff6b81);
      return (g, rnd) => {
        const r = 0.4 + rnd() * 0.15, h = 3.4 + rnd() * 1.6, hits = [];
        const add = (geo, x, y, z, rz) => {
          const m = new THREE.Mesh(geo, gm);
          m.position.set(x, y, z);
          if (rz) m.rotation.z = rz;
          m.castShadow = true; g.add(m); hits.push(m);
        };
        add(new THREE.CylinderGeometry(r * 0.9, r, h, 8), 0, h / 2, 0);
        add(new THREE.SphereGeometry(r * 0.9, 8, 6), 0, h, 0);
        for (const s of [-1, 1]) {
          if (rnd() > 0.85) continue;
          const ay = h * (0.35 + rnd() * 0.25), ah = 0.8 + rnd() * 0.8;
          add(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.9, 8), s * (r + 0.45), ay, 0, Math.PI / 2);
          add(new THREE.CylinderGeometry(r * 0.5, r * 0.55, ah, 8), s * (r + 0.9), ay + ah / 2, 0);
          add(new THREE.SphereGeometry(r * 0.5, 8, 6), s * (r + 0.9), ay + ah, 0);
        }
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), fm);
        bloom.position.set(0, h + r * 0.9, 0);
        g.add(bloom);
        g.rotation.y = rnd() * TAU;
        return { r: r + 0.15, hits: hits };
      };
    },
    pine() {
      const tm = flat(0x6b4a33), gm = flat(0x2f7d5b), sm = flat(0xf4f9ff);
      return (g, rnd) => {
        const s = 0.9 + rnd() * 0.5;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.38 * s, 2.6 * s, 7), tm);
        trunk.position.y = 1.3 * s; trunk.castShadow = true;
        g.add(trunk);
        const hits = [trunk];
        for (let k = 0; k < 3; k++) {
          const rad = (2.0 - k * 0.5) * s, hh = 2.0 * s, y = (2.4 + k * 1.25) * s;
          const c = new THREE.Mesh(new THREE.ConeGeometry(rad, hh, 8), gm);
          c.position.y = y + hh / 2; c.castShadow = true;
          const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.62, hh * 0.55, 8), sm);
          cap.position.y = y + hh * 0.72;
          g.add(c, cap);
          hits.push(c);
        }
        return { r: 0.5 * s, hits: hits };
      };
    },
    crystal() {
      const mats = [0xff6fd8, 0x5ff2ff, 0xa78bff].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.75, flatShading: true, roughness: 0.25 }));
      return (g, rnd, i) => {
        const hits = [], n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const h = 2 + rnd() * 2.4, w = 0.35 + rnd() * 0.3, ang = (k / n) * TAU + rnd(), off = k === 0 ? 0 : 0.5 + rnd() * 0.3;
          const c = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), mats[(i + k) % 3]);
          c.position.set(Math.cos(ang) * off, h / 2 - 0.1, Math.sin(ang) * off);
          c.rotation.set((rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35);
          c.castShadow = true;
          g.add(c);
          hits.push(c);
        }
        return { r: 0.95, hits: hits };
      };
    }
  };

  function loadMap(i) {
    mapIndex = i;
    const m = MAPS[i];
    for (const c of mapGroup.children.slice()) { mapGroup.remove(c); c.traverse(disposeObj); }
    targets.length = 0;
    shrooms.length = 0;

    // look and light
    paintSky(m.sky);
    scene.fog.color.set(m.fog);
    scene.fog.density = m.fogD;
    renderer.setClearColor(m.fog);
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(m.hemi[1]); hemi.intensity = m.hemi[2];
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1]; sun.position.set(m.sun[2][0], m.sun[2][1], m.sun[2][2]);
    cloudMat.color.set(m.cloud); cloudMat.emissive.set(m.cloud);
    clouds.visible = !m.stars;
    stars.visible = !!m.stars;
    snow.visible = !!m.snow;

    // island
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ map: groundTexture(m.ground, m.seed), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    ground.receiveShadow = true;
    mapGroup.add(ground);

    const underGeo = new THREE.CylinderGeometry(R, R * 0.3, 11, 28, 4);
    const up = underGeo.attributes.position;
    for (let k = 0; k < up.count; k++) {
      const x = up.getX(k), y = up.getY(k), z = up.getZ(k);
      if (y < 5.4) {
        const n = Math.sin(x * 0.9 + z * 1.3 + y * 1.1) * 0.9 + Math.cos(x * 1.7 - z * 0.8) * 0.5, s = 1 + n * 0.06;
        up.setXYZ(k, x * s, y + Math.sin(x * 2.1 + z * 1.9) * 0.35, z * s);
      }
    }
    const under = new THREE.Mesh(underGeo, flat(m.under));
    under.position.y = -5.5;
    mapGroup.add(under);

    const rnd = mulberry32(m.seed + 4);
    const rockMats = m.rock.map((c) => flat(c)), rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * TAU + rnd() * 0.1, d = R - 0.2 + rnd() * 0.5, s = 0.5 + rnd() * 0.7;
      const rock = new THREE.Mesh(rockGeo, rockMats[k % 2]);
      rock.scale.set(s, s * 0.7, s);
      rock.position.set(Math.cos(a) * d, 0.15, Math.sin(a) * d);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.castShadow = true;
      mapGroup.add(rock);
    }
    const decorMats = m.decor.map((c) => m.glow ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8 }));
    const decorGeo = new THREE.SphereGeometry(m.glow ? 0.17 : 0.13, 6, 4);
    for (let k = 0; k < m.decorN; k++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * (R - 2);
      const f = new THREE.Mesh(decorGeo, decorMats[k % decorMats.length]);
      f.position.set(Math.cos(a) * d, 0.14, Math.sin(a) * d);
      mapGroup.add(f);
    }

    // cover to hide behind
    const make = COVER[m.cover](), prnd = mulberry32(m.seed);
    for (let placed = 0, tries = 0; placed < m.n && tries < 600; tries++) {
      const a = prnd() * TAU, d = 8 + prnd() * (R - 14), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (shrooms.some((s) => Math.hypot(s.x - x, s.z - z) < m.gap)) continue;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const c = make(g, prnd, placed);
      mapGroup.add(g);
      c.hits.forEach((h) => targets.push(h));
      shrooms.push({ x: x, z: z, r: c.r });
      placed++;
    }
  }
  loadMap(0);

  function collide(pos, rad) {
    for (const s of shrooms) {
      const dx = pos.x - s.x, dz = pos.z - s.z, d = Math.hypot(dx, dz), m = s.r + rad;
      if (d < m) { const k = (m - d) / (d || 1); pos.x += dx * k; pos.z += dz * k; }
    }
  }
  function clampArena(pos, margin) {
    const d = Math.hypot(pos.x, pos.z), m = R - margin;
    if (d > m) { pos.x *= m / d; pos.z *= m / d; }
  }

  /* ------------------------------------------------------------------- guns */
  // delay = seconds between shots, spread in screen units, dmg per pellet, pierce = passes through bugs.
  const WEAPONS = [
    { name: 'Blaster', delay: 0.17, pellets: 1, spread: 0, dmg: 1, pierce: false, tracer: 0xfff4de, tw: 0.03, tlife: 0.06, kick: 1, flash: 3.2, snd: 'shoot', sparks: 0 },
    { name: 'Scatter', delay: 0.8, pellets: 8, spread: 0.075, dmg: 1, pierce: false, tracer: 0xffd27a, tw: 0.018, tlife: 0.09, kick: 2.6, flash: 6, snd: 'boom', sparks: 6 },
    { name: 'Rail', delay: 1.1, pellets: 1, spread: 0, dmg: 3, pierce: true, tracer: 0x7df9ff, tw: 0.09, tlife: 0.24, kick: 3, flash: 7, snd: 'rail', sparks: 8 },
    { name: 'Needler', delay: 0.09, pellets: 1, spread: 0.03, dmg: 1, pierce: false, tracer: 0xff9ad0, tw: 0.02, tlife: 0.05, kick: 0.6, flash: 2.4, snd: 'needle', sparks: 0 },
    { name: 'Arc', delay: 0.5, pellets: 1, spread: 0, dmg: 2, pierce: false, chain: 4, chainRange: 7, chainDmg: 1, tracer: 0x9fe8ff, tw: 0.05, tlife: 0.14, kick: 1.6, flash: 5, snd: 'zap', sparks: 5 },
    { name: 'Boomer', delay: 1.5, pellets: 1, spread: 0, dmg: 3, pierce: false, splash: 4.5, splashDmg: 2, tracer: 0xffa23d, tw: 0.06, tlife: 0.12, kick: 4, flash: 8, snd: 'thump', sparks: 10 }
  ];
  const INK = 0x33223a;
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
  const matOf = (c) => (c && c.isMaterial ? c : flat(c));
  function bx(g, w, h, d, c, x, y, z, rx) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matOf(c));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    g.add(m);
    return m;
  }
  function cy(g, rt, rb, len, c, x, y, z) {   // cylinder along the barrel axis, rt end faces forward
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 12), matOf(c));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  function muzzleAt(g, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    g.add(o);
    g.userData.muz = o;
  }

  function buildBlaster() {
    const g = new THREE.Group();
    bx(g, 0.11, 0.15, 0.4, 0x1fa89a, 0, 0, 0);                  // body
    bx(g, 0.05, 0.03, 0.34, 0xfff4de, 0, 0.09, -0.01);          // top rail
    bx(g, 0.116, 0.025, 0.22, INK, 0, -0.025, 0.02);            // dark side stripe
    cy(g, 0.038, 0.042, 0.36, 0xfff4de, 0, 0.02, -0.34);        // barrel
    cy(g, 0.056, 0.056, 0.05, 0xff6a3d, 0, 0.02, -0.5);         // tip ring
    cy(g, 0.027, 0.027, 0.06, INK, 0, 0.02, -0.52);             // bore
    bx(g, 0.1, 0.03, 0.09, 0xff6a3d, 0, 0.1, 0.03);             // bulb cradle
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glow(0xffc928));
    bulb.position.set(0, 0.14, 0.03);
    g.add(bulb);
    bx(g, 0.07, 0.16, 0.09, 0xff6a3d, 0, -0.12, 0.12, 0.3);     // grip
    bx(g, 0.02, 0.05, 0.08, INK, 0, -0.08, 0.0);                // trigger guard
    muzzleAt(g, 0, 0.02, -0.55);
    return g;
  }

  function buildScatter() {
    const g = new THREE.Group();
    bx(g, 0.14, 0.17, 0.34, 0xe86a3a, 0, -0.01, 0.06);          // receiver
    bx(g, 0.15, 0.04, 0.2, INK, 0, 0.06, 0.08);                 // top band
    bx(g, 0.05, 0.03, 0.14, glow(0xffc928), 0, 0.09, 0.06);     // shell counter
    for (const s of [-1, 1]) {
      cy(g, 0.046, 0.05, 0.52, 0xfff4de, s * 0.055, 0.03, -0.36);  // barrels
      cy(g, 0.075, 0.055, 0.09, 0xff6a3d, s * 0.055, 0.03, -0.66); // flared muzzles
      cy(g, 0.05, 0.05, 0.03, INK, s * 0.055, 0.03, -0.71);        // bores
    }
    bx(g, 0.13, 0.075, 0.18, 0x1fa89a, 0, -0.07, -0.3);         // pump
    for (let i = 0; i < 3; i++) bx(g, 0.135, 0.02, 0.025, INK, 0, -0.07, -0.37 + i * 0.07);   // pump ridges
    bx(g, 0.07, 0.17, 0.09, 0x1fa89a, 0, -0.14, 0.17, 0.35);    // grip
    muzzleAt(g, 0, 0.03, -0.73);
    return g;
  }

  function buildRail() {
    const g = new THREE.Group();
    g.position.z = 0.1;
    bx(g, 0.13, 0.15, 0.3, 0xe86a3a, 0, 0, 0.1);                // rear block
    for (const s of [-1, 1]) bx(g, 0.035, 0.07, 0.78, 0x1fa89a, s * 0.055, 0, -0.3);   // twin rails
    g.userData.core = cy(g, 0.022, 0.022, 0.8, glow(0x7df9ff), 0, 0, -0.3);            // energy core
    for (const z of [-0.12, -0.32, -0.52]) cy(g, 0.09, 0.09, 0.035, 0xa78bff, 0, 0, z);   // coils
    cy(g, 0.03, 0.03, 0.22, INK, 0, 0.12, -0.05);               // scope
    cy(g, 0.026, 0.026, 0.01, glow(0x7df9ff), 0, 0.12, -0.165); // lens
    bx(g, 0.07, 0.17, 0.09, INK, 0, -0.13, 0.17, 0.3);          // grip
    muzzleAt(g, 0, 0, -0.72);
    return g;
  }

  function buildNeedler() {
    const g = new THREE.Group();
    bx(g, 0.1, 0.13, 0.34, 0xff5fa2, 0, 0, 0.04);               // body
    bx(g, 0.05, 0.03, 0.3, 0xfff4de, 0, 0.08, 0.02);            // top rail
    bx(g, 0.104, 0.03, 0.2, INK, 0, 0, 0.04);                   // dark side stripe
    bx(g, 0.07, 0.17, 0.07, 0xa83a6e, 0, -0.14, 0, 0.15);       // magazine
    bx(g, 0.02, 0.05, 0.14, glow(0xff9ad0), 0.056, 0, 0.06);    // glowing vent
    bx(g, 0.1, 0.05, 0.1, INK, 0, 0.02, -0.14);                 // barrel clamp
    for (const s of [-1, 1]) {
      cy(g, 0.018, 0.02, 0.4, 0xfff4de, s * 0.03, 0.02, -0.3);  // twin barrels
      cy(g, 0.03, 0.03, 0.04, glow(0xff9ad0), s * 0.03, 0.02, -0.5);   // glowing tips
    }
    bx(g, 0.07, 0.15, 0.09, INK, 0, -0.12, 0.17, 0.3);          // grip
    muzzleAt(g, 0, 0.02, -0.53);
    return g;
  }

  function buildArc() {
    const g = new THREE.Group();
    bx(g, 0.13, 0.15, 0.34, 0x6b4fd8, 0, 0, 0.08);              // body
    bx(g, 0.136, 0.03, 0.2, INK, 0, 0.02, 0.1);                 // band
    bx(g, 0.05, 0.03, 0.14, 0xfff4de, 0, 0.09, 0.1);            // top sight
    for (const s of [-1, 1]) bx(g, 0.03, 0.075, 0.5, 0xfff4de, s * 0.075, 0, -0.3);   // prongs
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), glow(0xb9f3ff));
    orb.position.set(0, 0, -0.1);
    g.add(orb);
    g.userData.orb = orb;
    g.userData.bars = [-0.24, -0.38, -0.52].map((z) => bx(g, 0.12, 0.014, 0.014, glow(0xb9f3ff), 0, 0, z));   // crackling arcs
    cy(g, 0.012, 0.012, 0.14, glow(0xb9f3ff), 0, 0, -0.6);      // spike
    bx(g, 0.07, 0.17, 0.09, INK, 0, -0.13, 0.2, 0.3);           // grip
    muzzleAt(g, 0, 0, -0.68);
    return g;
  }

  function buildBoomer() {
    const g = new THREE.Group();
    g.position.z = 0.04;
    cy(g, 0.11, 0.11, 0.62, 0xffb21e, 0, 0.02, -0.22);          // fat tube
    for (const z of [-0.05, -0.28, -0.46]) cy(g, 0.122, 0.122, 0.04, INK, 0, 0.02, z);   // bands
    cy(g, 0.15, 0.115, 0.1, 0xff6a3d, 0, 0.02, -0.58);          // flared muzzle
    cy(g, 0.1, 0.1, 0.03, INK, 0, 0.02, -0.64);                 // bore
    bx(g, 0.15, 0.17, 0.22, 0xe86a3a, 0, -0.01, 0.17);          // breech
    bx(g, 0.08, 0.05, 0.16, INK, 0, 0.13, 0);                   // sight mount
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(0x7dff6a));
    shell.position.set(0, 0.18, 0);
    g.add(shell);                                               // loaded-shell light
    bx(g, 0.1, 0.1, 0.12, 0x1fa89a, 0, -0.1, -0.12);            // ammo drum
    bx(g, 0.07, 0.17, 0.09, INK, 0, -0.14, 0.2, 0.3);           // grip
    muzzleAt(g, 0, 0.02, -0.66);
    return g;
  }

  const gun = new THREE.Group();   // holds all the gun models and follows the camera
  gun.position.set(0.24, -0.22, -0.5);
  gun.visible = false;
  camera.add(gun);
  const models = [buildBlaster(), buildScatter(), buildRail(), buildNeedler(), buildArc(), buildBoomer()];
  models.forEach((m) => gun.add(m));
  const flash = new THREE.PointLight(0xffd27a, 0, 9);
  gun.add(flash);

  let weapon = 0, weaponShown = -1, swapT = 0;
  function showWeapon() {
    weaponShown = weapon;
    models.forEach((m, i) => { m.visible = i === weapon; });
    flash.position.copy(models[weapon].userData.muz.position);
    flash.position.z -= 0.08;
  }
  const gunHud = $('gunHud');
  WEAPONS.forEach((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gchip';
    b.innerHTML = '<b>' + (i + 1) + '</b>' + w.name;
    b.addEventListener('click', () => switchWeapon(i));
    gunHud.appendChild(b);
  });
  function updateGunHud() { Array.prototype.forEach.call(gunHud.children, (c, i) => c.classList.toggle('on', i === weapon)); }
  function switchWeapon(i) {
    if (i === weapon || swapT > 0 || state.mode !== 'playing') return;
    weapon = i;
    swapT = 0.3;
    tone(500, 900, 0.05, 'square', 0.03);
    updateGunHud();
  }
  showWeapon();
  updateGunHud();

  // Bullet trails (a small pool, so shotgun pellets each get one)
  const tracers = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0, max: 1, w: 0.03 });
  }
  let tracerNext = 0;
  function addTracer(a, b, color, width, life) {
    const t = tracers[tracerNext++ % tracers.length];
    t.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    t.mesh.lookAt(b);
    t.mesh.scale.set(width, width, Math.max(0.01, a.distanceTo(b)));
    t.mesh.material.color.set(color);
    t.life = t.max = life;
    t.w = width;
    t.mesh.visible = true;
  }
  function updateTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      const k = t.life / t.max;
      t.mesh.material.opacity = k;
      t.mesh.scale.x = t.mesh.scale.y = t.w * (0.4 + 0.6 * k);
    }
  }

  /* -------------------------------------------------------------------- audio */
  let actx = null;
  let muted = false;
  function audioCtx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { actx = new AC(); } catch (e) { actx = null; } }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(f0, f1, dur, type, vol) {
    if (muted) return;
    const a = audioCtx();
    if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 30), t + dur);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  let lastHit = 0;
  const sfx = {
    shoot() { tone(780, 160, 0.09, 'square', 0.04); },
    hit() { const n = performance.now(); if (n - lastHit > 40) { lastHit = n; tone(320, 140, 0.07, 'triangle', 0.07); } },
    pop() { tone(520, 70, 0.22, 'sawtooth', 0.06); tone(260, 60, 0.28, 'triangle', 0.07); },
    hurt() { tone(140, 45, 0.3, 'sawtooth', 0.1); },
    pickup() { tone(560, 1180, 0.16, 'sine', 0.08); },
    wave() { tone(300, 600, 0.25, 'square', 0.05); setTimeout(() => tone(450, 900, 0.3, 'square', 0.05), 140); },
    over() { tone(400, 60, 0.9, 'sawtooth', 0.09); },
    boom() { tone(180, 40, 0.28, 'sawtooth', 0.09); tone(420, 90, 0.14, 'square', 0.05); },
    rail() { tone(1500, 110, 0.3, 'sawtooth', 0.06); tone(520, 70, 0.4, 'triangle', 0.08); },
    needle() { tone(1100, 600, 0.05, 'square', 0.03); },
    zap() { tone(900, 200, 0.18, 'sawtooth', 0.05); tone(1800, 400, 0.12, 'square', 0.03); },
    thump() { tone(110, 35, 0.4, 'sawtooth', 0.12); tone(300, 60, 0.2, 'square', 0.05); }
  };
  function toggleMute() {
    muted = !muted;
    $('muteBtn').textContent = muted ? 'Sound off' : 'Sound on';
  }

  /* ---------------------------------------------------------------- particles */
  const partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const partMats = {};
  const parts = [];
  function burst(p, color, n, spd) {
    const mat = partMats[color] || (partMats[color] = new THREE.MeshBasicMaterial({ color: color }));
    for (let i = 0; i < n && parts.length < 300; i++) {
      const mesh = new THREE.Mesh(partGeo, mat);
      mesh.position.copy(p);
      const a = Math.random() * TAU, u = Math.random() * 0.8 + 0.2;
      const vel = new THREE.Vector3(Math.cos(a) * u * spd, (0.4 + Math.random()) * spd * 0.9, Math.sin(a) * u * spd);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      scene.add(mesh);
      const life = 0.55 + Math.random() * 0.45;
      parts.push({ mesh: mesh, vel: vel, life: life, max: life });
    }
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { scene.remove(p.mesh); parts.splice(i, 1); continue; }
      p.vel.y -= 16 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.07) {
        p.mesh.position.y = 0.07;
        p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.05, p.life / p.max));
    }
  }

  /* --------------------------------------------------------------------- bugs */
  // ai: walk | hop | fly | shoot | bomb.  fly = hover height.  The rest describes how the bug is built.
  const BUG_TYPES = {
    beetle:  { name: 'Beetle', ai: 'walk', hp: 2, speed: 3.1, scale: 1, color: 0xff6a3d, dmg: 10, points: 100, r: 0.75, drop: 0.12,
               bs: [1, 0.8, 1.3], shell: 1, spots: 4, legs: 6, mand: 1, ant: 1 },
    bee:     { name: 'Bee', ai: 'fly', fly: 0.9, hp: 1, speed: 6.2, scale: 0.7, color: 0xffc928, dmg: 6, points: 150, r: 0.55, drop: 0.08,
               bs: [0.75, 0.7, 0.95], abd: [-0.62, 0.3, 0.28, 0.42], stripes: 2, wing: [0.8, 0.3, 0.28, 0.05, 42], legs: 6, ll: [0.18, 0.18], ant: 1, hs: 0.26 },
    spider:  { name: 'Spider', ai: 'walk', skitter: 1, hp: 1, speed: 5.2, scale: 0.75, color: 0x4a2360, dmg: 7, points: 120, r: 0.6, drop: 0.06,
               by: 0.78, bs: [0.7, 0.55, 0.8], abd: [-0.7, 0.34, 0.3, 0.45], mark: 0xff4d5e, legs: 8, ll: [0.5, 0.62], hs: 0.25, eye: 1.3 },
    hopper:  { name: 'Hopper', ai: 'hop', hp: 3, speed: 3.4, scale: 1, color: 0x17b6c9, dmg: 12, points: 200, r: 0.7, drop: 0.15,
               by: 0.6, bs: [0.7, 0.7, 1.35], legs: 6, hind: 1, ll: [0.3, 0.3], ant: 1, al: 1.1, hs: 0.3, eye: 1.5 },
    rhino:   { name: 'Rhino', ai: 'walk', hp: 7, speed: 2, scale: 1.8, color: 0x3a56c8, dmg: 20, points: 400, r: 1.3, drop: 0.5,
               bs: [1, 0.8, 1.3], shell: 1, spots: 5, legs: 6, mand: 1, ant: 1, horn: 1 },
    moth:    { name: 'Moth', ai: 'fly', fly: 1.8, hp: 2, speed: 3.6, scale: 1.1, color: 0xd9c7ff, dmg: 9, points: 220, r: 0.7, drop: 0.1,
               bs: [0.35, 0.35, 0.85], wing: [1.25, 0.95, 0.15, 0, 10], wc: 0xb9a0ff, wo: 1, legs: 2, ll: [0.15, 0.15], ant: 1, al: 0.8, hs: 0.24, eye: 1.4 },
    firefly: { name: 'Firefly', ai: 'bomb', hp: 2, speed: 3.8, scale: 0.9, color: 0x3b2b2f, dmg: 25, points: 250, r: 0.65, drop: 0.1,
               bs: [0.6, 0.55, 1], abd: [-0.62, 0.32, 0.3, 0.45], glow: 0xc8ff3a, wing: [0.55, 0.22, 0.3, 0, 28], legs: 6, ll: [0.3, 0.3], ant: 1, hs: 0.25 },
    wasp:    { name: 'Wasp', ai: 'shoot', fly: 2.2, hp: 3, speed: 3.4, scale: 1.05, color: 0xe23b4e, dmg: 8, points: 350, r: 0.7, drop: 0.2,
               bs: [0.7, 0.65, 1], abd: [-0.66, 0.33, 0.3, 0.5], stripes: 2, sting: 1, wing: [0.85, 0.3, 0.3, 0.05, 46], legs: 6, ll: [0.2, 0.2], mand: 1, ant: 1, hs: 0.27 },
    ladybug: { name: 'Ladybug', ai: 'walk', skitter: 1, hp: 3, speed: 4.6, scale: 0.9, color: 0xe8283c, dmg: 11, points: 260, r: 0.7, drop: 0.1,
               bs: [1, 0.8, 1.15], shell: 1, spots: 6, legs: 6, ant: 1, hs: 0.27 },
    mantis:  { name: 'Mantis', ai: 'charge', hp: 5, speed: 2.6, scale: 1.25, color: 0xcfe23c, dmg: 18, points: 420, r: 0.9, drop: 0.25,
               bs: [0.55, 0.6, 1.6], legs: 6, ll: [0.4, 0.5], mand: 1, ant: 1, al: 0.9, hs: 0.3, eye: 1.5, dash: { spd: 4.2, dur: 0.55, cd: 2.6 } },
    dragonfly: { name: 'Dragonfly', ai: 'fly', fly: 1.5, hp: 2, speed: 7.4, scale: 1.05, color: 0x2a8cff, dmg: 10, points: 380, r: 0.65, drop: 0.12,
               bs: [0.38, 0.34, 1.7], stripes: 3, wing: [1.35, 0.5, 0.15, 0.1, 36], wc: 0xbfe9ff, wo: 0.55, legs: 2, ll: [0.15, 0.15], hs: 0.26, eye: 1.7 },
    stag:    { name: 'Stag Beetle', ai: 'walk', hp: 14, speed: 1.9, scale: 2.1, color: 0x7b3fa0, dmg: 26, points: 900, r: 1.5, drop: 0.6,
               bs: [1, 0.8, 1.3], shell: 1, spots: 2, legs: 6, mand: 1, ant: 1, horn: 1 },
    // bosses (waves 10 and 15)
    titan:   { name: 'Titan Beetle', boss: 1, ai: 'charge', hp: 110, speed: 2.2, scale: 3.4, color: 0xf0b429, dmg: 24, points: 5000, r: 2.6, drop: 0,
               bs: [1, 0.8, 1.3], shell: 1, spots: 6, legs: 6, mand: 1, ant: 1, horn: 1, tusks: 1, hs: 0.28,
               dash: { spd: 3, dur: 0.8, cd: 3.2 }, summon: { types: ['beetle', 'spider', 'ladybug'], every: 9, n: 2 } },
    queen:   { name: 'Hive Queen', boss: 1, ai: 'queen', fly: 2.2, hp: 200, speed: 3.4, scale: 3, color: 0xffb820, dmg: 20, points: 12000, r: 2.3, drop: 0,
               bs: [0.9, 0.85, 1.1], abd: [-0.75, 0.5, 0.45, 0.7], stripes: 3, sting: 1, wing: [1.5, 0.5, 0.3, 0.05, 34], legs: 6, ll: [0.2, 0.2], mand: 1, ant: 1, al: 1, hs: 0.3, crown: 1,
               summon: { types: ['bee', 'wasp', 'moth'], every: 8, n: 2 } }
  };
  const BOSS_WAVES = { 10: 'titan', 15: 'queen' };
  // [type, first wave it appears, how common]
  const SPAWN_TABLE = [['beetle', 1, 10], ['bee', 2, 5], ['spider', 3, 3], ['hopper', 3, 4], ['rhino', 4, 2], ['moth', 5, 3], ['firefly', 6, 3], ['wasp', 7, 2], ['ladybug', 8, 4], ['mantis', 9, 3], ['dragonfly', 11, 3], ['stag', 12, 2]];
  const SPOT_POS = [[-0.2, -0.2], [0.2, -0.2], [-0.22, 0.12], [0.22, 0.12], [0, 0.38], [0, -0.42]];

  const SPH = new THREE.SphereGeometry(1, 10, 8);
  const CONE = new THREE.ConeGeometry(1, 1, 6); CONE.translate(0, 0.5, 0);    // base at origin, tip up
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
  const ROD = new THREE.CylinderGeometry(1, 0.7, 1, 5); ROD.translate(0, -0.5, 0);   // hangs down
  const FEEL = new THREE.CylinderGeometry(1, 0.6, 1, 5); FEEL.translate(0, 0.5, 0);  // grows up
  const WING = new THREE.PlaneGeometry(1, 1); WING.translate(0.5, 0, 0);
  const bugHitGeo = new THREE.SphereGeometry(0.85, 8, 6);
  const darkMat = flat(0x2b1d16);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff4de });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1020 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const wingMats = {}, markMats = {};
  const wingMat = (d) => wingMats[d.name] || (wingMats[d.name] = new THREE.MeshBasicMaterial({
    color: d.wc || 0xe9f6ff, transparent: (d.wo || 0.5) < 1, opacity: d.wo || 0.5, side: THREE.DoubleSide, depthWrite: (d.wo || 0.5) >= 1 }));
  const markMat = (c) => markMats[c] || (markMats[c] = new THREE.MeshBasicMaterial({ color: c }));

  function part(parent, geo, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }
  function pivot(parent, x, y, z, side) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.userData.side = side;
    parent.add(p);
    return p;
  }
  function band(parent, y, z, rx, ry, th) {   // thin dark ring around the body (stripes)
    part(parent, CYL, darkMat, 0, y, z, rx, th, ry).rotation.x = Math.PI / 2;
  }

  const bugs = [];
  let waveSpeed = 1;

  function makeBug(type, x, z) {
    const d = BUG_TYPES[type], by = d.by || 0.55, sx = d.bs[0], sy = d.bs[1], sz = d.bs[2];
    const mat = new THREE.MeshStandardMaterial({
      color: d.color, flatShading: true, roughness: 0.35, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0
    });
    const g = new THREE.Group();
    const rig = { legs: [], wings: [], ant: [], mand: [] };
    let abdMat = null;

    const body = part(g, SPH, mat, 0, by, 0, 0.5 * sx, 0.5 * sy, 0.5 * sz);
    body.castShadow = true;

    if (d.shell) {   // wing-case seam and a glossy highlight
      part(g, CYL, darkMat, 0, by, 0, 0.5 * sy * 1.03, 0.035, 0.5 * sz * 1.03).rotation.z = Math.PI / 2;
      part(g, SPH, shineMat, -0.16 * sx, by + 0.42 * sy, 0.2 * sz, 0.12, 0.05, 0.2);
    }
    for (let i = 0; i < (d.spots || 0); i++) {
      const sp = SPOT_POS[i], ex = sp[0] * 2, ez = sp[1] * 2;
      part(g, SPH, darkMat, sp[0] * sx, by + 0.5 * sy * Math.sqrt(Math.max(0.05, 1 - ex * ex - ez * ez)) * 0.98, sp[1] * sz, 0.09, 0.045, 0.09);
    }

    const stripes = (cy, cz, rx, ry, rz, n) => {
      for (let i = 0; i < n; i++) {
        const dz = (i - (n - 1) / 2) * rz * 0.7, k = Math.sqrt(Math.max(0.05, 1 - (dz / rz) * (dz / rz))) * 1.03;
        band(g, cy, cz + dz, rx * k, ry * k, 0.09);
      }
    };
    if (d.abd) {
      const a = d.abd;
      let am = mat;
      if (d.glow) {
        abdMat = new THREE.MeshStandardMaterial({ color: d.glow, flatShading: true, roughness: 0.4, emissive: d.glow, emissiveIntensity: 0.6 });
        am = abdMat;
      }
      part(g, SPH, am, 0, by - 0.03, a[0], a[1], a[2], a[3]).castShadow = true;
      if (d.stripes) stripes(by - 0.03, a[0], a[1], a[2], a[3], d.stripes);
      if (d.mark) part(g, SPH, markMat(d.mark), 0, by - 0.03 + a[2] * 0.92, a[0], a[1] * 0.35, 0.04, a[3] * 0.45);
      if (d.sting) part(g, CONE, darkMat, 0, by - 0.05, a[0] - a[3], 0.07, 0.4, 0.07).rotation.x = -Math.PI / 2 - 0.1;
    } else if (d.stripes) {
      stripes(by, 0, 0.5 * sx, 0.5 * sy, 0.5 * sz, d.stripes);
    }

    // head: eyes with pupils, mandibles, antennae
    const hs = d.hs || 0.28, hz = 0.5 * sz + hs * 0.5, hy = by - 0.05, ew = hs * 0.4 * (d.eye || 1);
    part(g, SPH, darkMat, 0, hy, hz, hs, hs * 0.9, hs).castShadow = true;
    for (const s of [-1, 1]) {
      part(g, SPH, eyeMat, s * hs * 0.55, hy + hs * 0.35, hz + hs * 0.62, ew, ew, ew);
      part(g, SPH, pupilMat, s * hs * 0.55, hy + hs * 0.35, hz + hs * 0.62 + ew * 0.7, ew * 0.5, ew * 0.55, ew * 0.5);
      if (d.mand) {
        const m = pivot(g, s * hs * 0.4, hy - hs * 0.4, hz + hs * 0.8, s);
        part(m, CONE, darkMat, 0, 0, 0, 0.05, 0.24, 0.05).rotation.x = Math.PI / 2;
        rig.mand.push(m);
      }
      if (d.ant) {
        const al = d.al || 0.6, a = pivot(g, s * hs * 0.45, hy + hs * 0.8, hz + hs * 0.3, s);
        a.rotation.z = -s * 0.35;
        part(a, FEEL, darkMat, 0, 0, 0, 0.03, al, 0.03);
        part(a, SPH, darkMat, 0, al, 0, 0.065, 0.065, 0.065);
        rig.ant.push(a);
      }
    }
    if (d.horn) part(g, CONE, darkMat, 0, by + 0.12, hz + hs * 0.6, 0.1, 0.55, 0.1).rotation.x = 1.0;
    if (d.tusks) for (const s of [-1, 1]) {
      const tk = part(g, CONE, darkMat, s * hs * 0.8, by + 0.02, hz + hs * 0.5, 0.09, 0.7, 0.09);
      tk.rotation.x = 1.25; tk.rotation.z = -s * 0.5;
    }
    if (d.crown) for (let i = -2; i <= 2; i++) part(g, CONE, markMat(0xff4d5e), i * hs * 0.3, hy + hs * 0.55, hz - hs * 0.1, 0.07, 0.34 - Math.abs(i) * 0.06, 0.07);

    // two-part legs (hip + knee)
    const nl = d.legs || 0, ll = d.ll || [0.34, 0.34];
    for (let i = 0; i < nl; i++) {
      const s = i % 2 ? 1 : -1, row = Math.floor(i / 2), rows = nl / 2;
      const lz = rows === 1 ? 0 : (0.5 - row / (rows - 1)) * 0.62 * sz;
      const big = d.hind && i >= nl - 2, k = big ? 1.5 : 1, th = big ? 0.075 : 0.042;
      const hip = pivot(g, s * 0.26 * sx, by - 0.08, lz, s);
      hip.rotation.z = s * 1.05;
      part(hip, ROD, darkMat, 0, 0, 0, th, ll[0] * k, th);
      const knee = pivot(hip, 0, -ll[0] * k, 0, s);
      knee.rotation.z = -s * 1.5;
      part(knee, ROD, darkMat, 0, 0, 0, th * 0.8, ll[1] * k, th * 0.8);
      rig.legs.push(hip);
    }

    if (d.wing) {
      for (const s of [-1, 1]) {
        const w = pivot(g, s * 0.1 * sx, by + d.wing[2], d.wing[3], s);
        w.scale.x = s;
        part(w, WING, wingMat(d), 0, 0, 0, d.wing[0], d.wing[1], 1).rotation.x = -Math.PI / 2;
        rig.wings.push(w);
      }
    }

    const hit = new THREE.Mesh(bugHitGeo, hitMat);
    hit.position.y = by;
    g.add(hit);

    g.scale.setScalar(0.01);
    g.position.set(x, -1.4, z);
    scene.add(g);
    g.updateMatrixWorld(true);

    const bug = {
      type: type, def: d, group: g, mat: mat, abdMat: abdMat, body: body, sy0: 0.5 * sy, hit: hit,
      legs: rig.legs, wings: rig.wings, ant: rig.ant, mand: rig.mand,
      pos: new THREE.Vector3(x, 0, z), hp: d.hp, maxhp: d.hp, dashT: 0, p2: false, flash: 0, kick: 0, t: Math.random() * 10, rise: 0, atk: 0,
      yaw: 0, wob: Math.random() * TAU, y: 0, ph: 0, cd: 1.2 + Math.random(), dead: false, dtm: 0, gone: false
    };
    hit.userData.bug = bug;
    bugs.push(bug);
    return bug;
  }

  function removeBug(b) {
    scene.remove(b.group);
    b.mat.dispose();
    if (b.abdMat) b.abdMat.dispose();
    const i = bugs.indexOf(b);
    if (i >= 0) bugs.splice(i, 1);
  }

  function lerpAngle(a, b, k) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return a + d * k;
  }
  const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

  // Wasp stingers
  const shots = [];
  const shotGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const shotMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
  function fireShot(b) {
    const sx = b.pos.x, sy = b.y + 0.7, sz = b.pos.z;
    const dx = player.pos.x - sx, dy = player.pos.y + 1.1 - sy, dz = player.pos.z - sz;
    const v = 13 / (Math.hypot(dx, dy, dz) || 1);
    const mesh = new THREE.Mesh(shotGeo, shotMat);
    mesh.position.set(sx, sy, sz);
    scene.add(mesh);
    shots.push({ mesh: mesh, vx: dx * v, vy: dy * v, vz: dz * v, life: 3.5 });
    tone(900, 420, 0.12, 'triangle', 0.05);
  }
  function fireFan(b, n, arc) {   // boss volley: a fan of stingers aimed at the player
    const oy = b.y + 0.55 * b.def.scale, sx = b.pos.x, sz = b.pos.z;
    let dx = player.pos.x - sx, dy = player.pos.y + 1.1 - oy, dz = player.pos.z - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * arc, c = Math.cos(a), sn = Math.sin(a);
      const mesh = new THREE.Mesh(shotGeo, shotMat);
      mesh.position.set(sx, oy, sz);
      mesh.scale.setScalar(1.4);
      scene.add(mesh);
      shots.push({ mesh: mesh, vx: (dx * c - dz * sn) * 11, vy: dy * 11, vz: (dx * sn + dz * c) * 11, life: 4 });
    }
    tone(700, 200, 0.25, 'sawtooth', 0.07);
  }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], p = s.mesh.position;
      p.x += s.vx * dt; p.y += s.vy * dt; p.z += s.vz * dt;
      s.life -= dt;
      const hitP = Math.hypot(p.x - player.pos.x, p.y - (player.pos.y + 1.1), p.z - player.pos.z) < 0.7;
      if (hitP || s.life <= 0 || p.y < 0.05) {
        if (!hitP) burst(p, 0xff3b5c, 4, 3);
        scene.remove(s.mesh);
        shots.splice(i, 1);
        if (hitP) { hurt(8); if (state.mode !== 'playing') return; }
      }
    }
  }

  // Firefly blast
  function explode(b) {
    const p = new THREE.Vector3(b.pos.x, 0.7, b.pos.z);
    burst(p, 0xc8ff3a, 18, 8);
    burst(p, 0xff9a3d, 12, 7);
    sfx.pop();
    shake = Math.max(shake, 0.5);
    b.dead = true; b.gone = true;
    if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 3.4) hurt(b.def.dmg);
  }

  function animateBug(b, sp, near) {
    const d = b.def, t = b.t, n = b.legs.length, swing = t * (4 + sp * 1.6);
    for (let i = 0; i < n; i++) {
      const p = b.legs[i];
      if (d.ai === 'hop') p.rotation.x = b.ph > 0.35 && b.ph < 0.85 ? (i >= n - 2 ? 0.9 : -0.4) : (i >= n - 2 ? 0.2 : 0);
      else if (d.fly) p.rotation.x = 0.35 + Math.sin(swing * 0.5 + i) * 0.15;
      else p.rotation.x = Math.sin(swing + (i % 2 ? 0 : Math.PI) + i * 0.9) * 0.5;
    }
    for (const w of b.wings) w.rotation.z = w.userData.side * (Math.sin(t * d.wing[4]) * 0.75 + 0.2);
    for (const a of b.ant) a.rotation.x = 0.9 + Math.sin(t * 5 + a.userData.side * 1.3) * 0.22;
    for (const m of b.mand) m.rotation.y = m.userData.side * (0.2 + (Math.sin(t * (near ? 18 : 6)) * 0.5 + 0.5) * 0.4);
    b.body.scale.y = b.sy0 * (1 + Math.sin(t * 5) * 0.04);
  }

  function updateBugs(dt) {
    for (const b of bugs) {
      const d = b.def, g = b.group;
      b.t += dt;
      if (b.dead && d.boss) {   // boss death: rumbling explosions, then shrink away
        b.dtm += dt;
        const k = Math.min(1, b.dtm / 1.4);
        b.bt = (b.bt || 0) - dt;
        if (b.bt <= 0 && k < 1) {
          b.bt = 0.11;
          burst(new THREE.Vector3(b.pos.x + (Math.random() - 0.5) * d.r * 1.6, b.y + d.scale * (0.3 + Math.random() * 0.7), b.pos.z + (Math.random() - 0.5) * d.r * 1.6),
            Math.random() < 0.5 ? d.color : 0xfff4de, 8, 6);
          sfx.pop();
        }
        g.scale.setScalar(d.scale * (1 - k * k));
        g.rotation.y += dt * 5;
        g.position.y = Math.max(0, g.position.y - dt * 3);
        shake = Math.max(shake, 0.4);
        if (k >= 1) {
          burst(new THREE.Vector3(b.pos.x, 1.5, b.pos.z), d.color, 30, 9);
          b.gone = true;
        }
        continue;
      }
      if (b.dead) {   // pop: spin, rise and shrink
        b.dtm += dt;
        const k = Math.min(1, b.dtm / 0.3);
        g.scale.setScalar(d.scale * (1 - k));
        g.rotation.y += dt * 14;
        g.position.y += dt * 3;
        if (k >= 1) b.gone = true;
        continue;
      }
      if (b.rise < 1) b.rise = Math.min(1, b.rise + dt * 2);
      if (d.boss && b.rise >= 1) {
        if (!b.p2 && b.hp <= b.maxhp * 0.5) { b.p2 = true; b.flash = 1; shake = 1; sfx.wave(); banner('Enraged!', d.name + ' is furious'); }
        if (d.summon) {   // calls in helpers every few seconds
          b.sum = (b.sum === undefined ? d.summon.every * 0.5 : b.sum) - dt;
          if (b.sum <= 0) {
            b.sum = d.summon.every * (b.p2 ? 0.65 : 1);
            const n = d.summon.n + (b.p2 ? 1 : 0);
            for (let i = 0; i < n && bugs.length < MAX_BUGS + 4; i++) {
              const a = Math.random() * TAU, ty = d.summon.types[Math.floor(Math.random() * d.summon.types.length)];
              const nb = makeBug(ty, b.pos.x + Math.cos(a) * d.r * 1.2, b.pos.z + Math.sin(a) * d.r * 1.2);
              clampArena(nb.pos, 1);
              burst(new THREE.Vector3(nb.pos.x, 0.3, nb.pos.z), 0x8b5a3c, 8, 3);
            }
          }
        }
      }

      let dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;

      let sp = d.speed * waveSpeed * (b.rise < 1 ? 0.4 : 1), mx = dx, mz = dz, kHop = 0, move = true;
      if (b.p2) sp *= 1.3;
      const wob = Math.sin(b.t * 2.2 + b.wob) * 0.35;

      if (d.ai === 'hop') {
        b.ph += dt;
        if (b.ph < 0.35) { kHop = 0.3 * (b.ph / 0.35); b.y = 0; move = false; }
        else if (b.ph < 0.85) {
          const u = (b.ph - 0.35) / 0.5;
          sp *= 2.6; b.y = Math.sin(Math.PI * u) * 1.8; kHop = -0.18 * Math.sin(Math.PI * u);
        } else { b.y = 0; kHop = 0.15 * (1 - (b.ph - 0.85) / 0.15); move = false; if (b.ph >= 1) b.ph = 0; }
      } else if (d.ai === 'fly') {
        mx = dx - dz * wob * 2.2; mz = dz + dx * wob * 2.2;
        b.y += (d.fly + Math.sin(b.t * 1.7 + b.wob) * 0.35 - b.y) * Math.min(1, dt * 3);
      } else if (d.ai === 'shoot') {
        const mv = dist > 13 ? 1 : dist < 9 ? -0.9 : 0, st = Math.sin(b.t * 0.8 + b.wob) * 0.7;
        mx = dx * mv - dz * st; mz = dz * mv + dx * st;
        b.y += (d.fly + Math.sin(b.t * 1.5 + b.wob) * 0.3 - b.y) * Math.min(1, dt * 3);
        b.cd -= dt;
        if (b.cd < 0.45) b.flash = Math.max(b.flash, (0.45 - b.cd) * 2);   // glows just before it fires
        if (b.cd <= 0 && b.rise >= 1 && dist < 24) { fireShot(b); b.cd = 2.2 + Math.random() * 0.8; }
      } else if (d.ai === 'queen') {   // hovers at range, fires fans of stingers
        const mv = dist > 17 ? 1 : dist < 11 ? -0.8 : 0, st = Math.sin(b.t * 0.6 + b.wob) * 0.8;
        mx = dx * mv - dz * st; mz = dz * mv + dx * st;
        b.y += (d.fly + Math.sin(b.t * 1.2) * 0.4 - b.y) * Math.min(1, dt * 3);
        b.cd -= dt;
        if (b.cd < 0.6) b.flash = Math.max(b.flash, (0.6 - b.cd) * 1.6);
        if (b.cd <= 0 && b.rise >= 1) { fireFan(b, b.p2 ? 7 : 5, b.p2 ? 0.95 : 0.7); b.cd = b.p2 ? 1.8 : 2.8; }
      } else {
        mx = dx - dz * wob; mz = dz + dx * wob;
        if (d.ai === 'bomb') {
          if (dist < 10) sp *= 1.7;
          if (b.rise >= 1 && dist < d.r + PLAYER_R + 0.5) { explode(b); if (state.mode !== 'playing') return; continue; }
          b.abdMat.emissiveIntensity = 0.5 + 0.5 * Math.sin(b.t * (dist < 10 ? 18 : 6));
        }
        if (d.ai === 'charge') {   // winds up (glows), then dashes in a straight line
          const dc = d.dash;
          if (b.dashT > 0) {
            b.dashT -= dt;
            mx = b.ddx; mz = b.ddz; sp *= dc.spd;
            if (b.dashT <= 0) b.cd = dc.cd * (b.p2 ? 0.65 : 1) * (0.8 + Math.random() * 0.4);
          } else {
            b.cd -= dt;
            if (b.cd < 0.5) { b.flash = Math.max(b.flash, (0.5 - b.cd) * 2); sp *= 0.15; }
            if (b.cd <= 0 && b.rise >= 1) { b.dashT = dc.dur; b.ddx = dx; b.ddz = dz; }
          }
        }
        if (d.skitter) sp *= 0.6 + 1.2 * Math.pow(Math.sin(b.t * 5 + b.wob), 2);
      }

      if (move && (dist > d.r + PLAYER_R * 0.8 || d.ai === 'shoot' || d.ai === 'queen')) {
        b.pos.x += mx * sp * dt;
        b.pos.z += mz * sp * dt;
      }
      if (!d.fly) collide(b.pos, d.r * 0.55);
      clampArena(b.pos, 0.6);

      b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
      const e = b.rise < 1 ? easeOutBack(b.rise) : 1, k = b.kick + kHop, s = d.scale * e;
      b.kick *= Math.exp(-dt * 10);
      g.scale.set(s * (1 + k), s * (1 - k), s * (1 + k));
      g.position.set(b.pos.x, (b.rise - 1) * 1.4 + b.y + (d.fly ? 0 : Math.abs(Math.sin(b.t * (3 + sp))) * 0.05), b.pos.z);
      g.rotation.y = b.yaw;
      g.rotation.x = d.fly ? 0.2 + Math.sin(b.t * 3) * 0.06 : 0;
      animateBug(b, sp, dist < 4);

      if (b.flash > 0) {
        b.flash = Math.max(0, b.flash - dt * 6);
        b.mat.emissiveIntensity = b.flash * 0.9;
      }

      b.atk -= dt;
      const reach = d.r + PLAYER_R + 0.35;
      const close = d.fly ? Math.abs(player.pos.y + 1.0 - (b.y + 0.7)) < 1.5 : b.y < 0.9 && player.pos.y < 0.9;
      if (d.ai !== 'shoot' && d.ai !== 'bomb' && d.ai !== 'queen' && b.rise >= 1 && b.atk <= 0 && close && dist < reach) {
        b.atk = 0.9;
        player.vel.x -= dx * 7;
        player.vel.z -= dz * 7;
        hurt(d.dmg);
        if (state.mode !== 'playing') return;
      }
    }

    for (let i = bugs.length - 1; i >= 0; i--) if (bugs[i].gone) removeBug(bugs[i]);

    // keep bugs from stacking on top of each other
    for (let i = 0; i < bugs.length; i++) {
      for (let j = i + 1; j < bugs.length; j++) {
        const a = bugs[i], c = bugs[j];
        if (a.dead || c.dead || a.def.fly || c.def.fly) continue;
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
        const min = (a.def.r + c.def.r) * 0.8;
        const dd = Math.hypot(dx, dz);
        if (dd < min && dd > 0.0001) {
          const push = (min - dd) / 2 / dd;
          a.pos.x -= dx * push; a.pos.z -= dz * push;
          c.pos.x += dx * push; c.pos.z += dz * push;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- pickups */
  const pickups = [];
  const pickBallGeo = new THREE.SphereGeometry(0.34, 10, 8);
  const pickBarA = new THREE.BoxGeometry(0.5, 0.13, 0.13);
  const pickBarB = new THREE.BoxGeometry(0.13, 0.5, 0.13);
  const pickBallMat = flat(0xfff4de);
  const pickBarMat = new THREE.MeshBasicMaterial({ color: 0x2fbf6a });

  function dropPickup(x, z) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pickBallGeo, pickBallMat));
    for (const zz of [-0.3, 0.3]) {
      const a = new THREE.Mesh(pickBarA, pickBarMat);
      const b = new THREE.Mesh(pickBarB, pickBarMat);
      a.position.z = b.position.z = zz;
      g.add(a, b);
    }
    g.position.set(x, 0.9, z);
    scene.add(g);
    pickups.push({ group: g, life: 12, t: Math.random() * 6 });
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.life -= dt;
      p.t += dt;
      p.group.rotation.y += dt * 2;
      p.group.position.y = 0.9 + Math.sin(p.t * 3) * 0.12;
      p.group.visible = p.life > 3 || Math.floor(p.life * 6) % 2 === 0;
      const dx = p.group.position.x - player.pos.x, dz = p.group.position.z - player.pos.z;
      let taken = Math.hypot(dx, dz) < 1.4 && player.pos.y < 1.6;
      if (taken) {
        state.health = Math.min(100, state.health + 25);
        sfx.pickup();
        burst(p.group.position, 0x2fbf6a, 8, 3);
      }
      if (taken || p.life <= 0) { scene.remove(p.group); pickups.splice(i, 1); }
    }
  }

  /* ------------------------------------------------------------------- state */
  const state = { mode: 'menu', score: 0, best: loadBest(), wave: 0, health: 100, combo: 0, comboTimer: 0, kills: 0 };

  const player = {
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    vy: 0, onGround: true, yaw: 0, pitch: 0
  };

  let fireCd = 0, recoil = 0, tracerLife = 0, hurtAlpha = 0, shake = 0, bobT = 0, bannerTimer = 0;
  let firing = false;
  let locked = false;
  let keys = {};
  const touchIn = { fwd: 0, strafe: 0, jump: false };
  let slideTimer = 0, slideCooldown = 0, slideBlend = 0;
  const slideDir = new THREE.Vector3();

  let spawnQueue = [], spawnTimer = 0, spawnEvery = 0.8, intermission = 0;

  function setMode(m) {
    state.mode = m;
    document.body.dataset.mode = m;
    gun.visible = m === 'playing' || m === 'paused';
    if (m !== 'playing') {
      slideTimer = 0;
      slideBlend = 0;
      document.body.classList.remove('sliding');
    }
  }

  /* ---------------------------------------------------------------------- HUD */
  const hud = {
    score: $('hudScore'), best: $('hudBest'), wave: $('hudWave'), left: $('hudLeft'),
    hpFill: $('hpFill'), hpText: $('hpText'),
    combo: $('combo'), comboText: $('comboText'), comboFill: $('comboFill'),
    boss: $('bossBar'), bossName: $('bossName'), bossFill: $('bossFill')
  };
  const hurtEl = $('hurt'), bannerEl = $('banner'), crossEl = $('crosshair');
  const last = {};
  function setText(el, key, val) {
    if (last[key] !== val) { last[key] = val; el.textContent = val; }
  }
  const comboMult = () => Math.min(5, 1 + Math.floor(state.combo / 3));

  function updateHud() {
    setText(hud.score, 'score', fmt(state.score));
    setText(hud.best, 'best', fmt(Math.max(state.best, state.score)));
    setText(hud.wave, 'wave', state.wave);
    setText(hud.left, 'left', spawnQueue.length + bugs.filter((b) => !b.dead).length);
    const hp = Math.round(state.health);
    if (last.hp !== hp) {
      last.hp = hp;
      hud.hpFill.style.width = hp + '%';
      hud.hpFill.style.background = hp > 55 ? '#44d17a' : hp > 28 ? '#ffc928' : '#e8453c';
      hud.hpText.textContent = hp;
    }
    const boss = bugs.find((b) => b.def.boss && !b.dead);
    if (boss) {
      if (!last.boss) { last.boss = 1; hud.boss.style.display = 'block'; }
      setText(hud.bossName, 'bossName', boss.def.name);
      hud.bossFill.style.width = Math.max(0, boss.hp) / boss.maxhp * 100 + '%';
    } else if (last.boss) { last.boss = 0; hud.boss.style.display = 'none'; }
    if (state.combo >= 2) {
      hud.combo.style.display = 'block';
      setText(hud.comboText, 'combo', 'x' + comboMult() + ' combo');
      hud.comboFill.style.width = clamp(state.comboTimer / COMBO_WINDOW, 0, 1) * 100 + '%';
    } else if (last.combo !== '') {
      hud.combo.style.display = 'none';
      last.combo = '';
    }
  }

  function banner(title, sub) {
    bannerEl.innerHTML = '<strong>' + title + '</strong>' + (sub ? '<span>' + sub + '</span>' : '');
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    bannerTimer = 2.2;
  }

  function crosshair(cls) {
    crossEl.classList.remove('hit', 'kill');
    void crossEl.offsetWidth;
    crossEl.classList.add(cls);
  }

  const radar = $('radar');
  const rctx = radar.getContext('2d');
  function drawRadar() {
    const W = radar.width, c = W / 2, rad = c - 6, range = 24, k = rad / range;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    rctx.clearRect(0, 0, W, W);
    rctx.save();
    rctx.beginPath();
    rctx.arc(c, c, rad + 4, 0, TAU);
    rctx.clip();
    rctx.fillStyle = 'rgba(255,244,222,0.92)';
    rctx.fillRect(0, 0, W, W);
    rctx.strokeStyle = 'rgba(51,34,58,0.22)';
    rctx.lineWidth = 3;
    rctx.beginPath(); rctx.arc(c, c, rad * 0.5, 0, TAU); rctx.stroke();
    rctx.beginPath(); rctx.moveTo(c, 0); rctx.lineTo(c, W); rctx.moveTo(0, c); rctx.lineTo(W, c); rctx.stroke();

    const plot = (x, z, r, fill, ink) => {
      const rx = x - player.pos.x, rz = z - player.pos.z;
      const px = c + (rx * cos - rz * sin) * k;
      const py = c - (-rx * sin - rz * cos) * k;
      rctx.beginPath();
      rctx.arc(px, py, r, 0, TAU);
      rctx.fillStyle = fill;
      rctx.fill();
      if (ink) { rctx.lineWidth = 3; rctx.strokeStyle = '#33223a'; rctx.stroke(); }
    };
    for (const s of shrooms) plot(s.x, s.z, Math.max(5, s.r * 2.2 * k), '#c9b0ec', false);
    for (const p of pickups) plot(p.group.position.x, p.group.position.z, 8, '#2fbf6a', true);
    for (const b of bugs) if (!b.dead) plot(b.pos.x, b.pos.z, 7 + b.def.scale * 3, '#' + b.def.color.toString(16).padStart(6, '0'), true);

    rctx.fillStyle = '#33223a';
    rctx.beginPath();
    rctx.moveTo(c, c - 13);
    rctx.lineTo(c + 9, c + 9);
    rctx.lineTo(c - 9, c + 9);
    rctx.closePath();
    rctx.fill();
    rctx.restore();
  }

  /* -------------------------------------------------------------- game rules */
  function buildQueue(wave) {
    const n = 5 + wave * 3, pool = SPAWN_TABLE.filter((r) => wave >= r[1]);
    const total = pool.reduce((sum, r) => sum + r[2], 0), q = [];
    while (q.length < n) {
      let x = Math.random() * total, type = pool[0][0];
      for (const r of pool) { x -= r[2]; if (x < 0) { type = r[0]; break; } }
      for (let i = 0; i < (type === 'spider' ? 3 : 1); i++) q.push(type);   // spiders come in packs of three
    }
    return q;
  }

  function startWave() {
    state.wave++;
    spawnQueue = buildQueue(state.wave);
    spawnEvery = Math.max(0.28, 0.95 - state.wave * 0.05);
    spawnTimer = 1.0;
    intermission = 0;
    waveSpeed = 1 + Math.min(state.wave - 1, 12) * 0.035;
    const fresh = SPAWN_TABLE.filter((r) => r[1] === state.wave && state.wave > 1).map((r) => BUG_TYPES[r[0]].name);
    banner('Wave ' + state.wave, state.wave === 1 ? MAPS[mapIndex].name + ': pop every bug' : fresh.length ? 'New: ' + fresh.join(' and ') : spawnQueue.length + ' bugs incoming');
    const boss = BOSS_WAVES[state.wave];
    if (boss) {
      spawnQueue = spawnQueue.slice(0, 10);
      spawnEvery = 2.2;
      spawnBoss(boss);
      banner('Boss: ' + BUG_TYPES[boss].name, 'Wave ' + state.wave + ': keep moving');
    }
    sfx.wave();
  }

  function spawnBoss(type) {
    let a = 0;
    for (let i = 0; i < 12; i++) {
      a = Math.random() * TAU;
      if (Math.hypot(Math.cos(a) * (R - 4) - player.pos.x, Math.sin(a) * (R - 4) - player.pos.z) > 18) break;
    }
    const x = Math.cos(a) * (R - 4), z = Math.sin(a) * (R - 4);
    makeBug(type, x, z);
    burst(new THREE.Vector3(x, 0.3, z), 0x8b5a3c, 24, 6);
    shake = 0.8;
  }

  let packLeft = 0, packAngle = 0;
  function spawnBug(type) {
    let a = 0;
    if (type === 'spider' && packLeft > 0) {
      a = packAngle + (Math.random() - 0.5) * 0.35;
      packLeft--;
    } else {
      for (let i = 0; i < 12; i++) {
        a = Math.random() * TAU;
        if (Math.hypot(Math.cos(a) * (R - 1.5) - player.pos.x, Math.sin(a) * (R - 1.5) - player.pos.z) > 14) break;
      }
      if (type === 'spider') { packAngle = a; packLeft = 2; }
    }
    const x = Math.cos(a) * (R - 1.5), z = Math.sin(a) * (R - 1.5);
    makeBug(type, x, z);
    burst(new THREE.Vector3(x, 0.2, z), 0x8b5a3c, 8, 3);
  }

  function updateWaves(dt) {
    if (intermission > 0) {
      intermission -= dt;
      if (intermission <= 0) startWave();
      return;
    }
    if (spawnQueue.length) {
      spawnTimer -= dt;
      if (spawnTimer <= 0 && bugs.length < MAX_BUGS) {
        spawnBug(spawnQueue.pop());
        spawnTimer = packLeft > 0 ? 0.12 : spawnEvery;
      }
    } else if (bugs.length === 0) {
      const bonus = state.wave * 250;
      state.score += bonus;
      state.health = Math.min(100, state.health + 20);
      banner('Wave cleared', '+' + fmt(bonus) + ' points, +20 health');
      sfx.pickup();
      intermission = 3;
    }
  }

  function hurt(n) {
    state.health -= n;
    hurtAlpha = 0.75;
    shake = 0.35;
    sfx.hurt();
    if (state.health <= 0) { state.health = 0; gameOver(); }
  }

  function damageBug(b, dmg, point) {
    if (b.dead) return;
    b.hp -= dmg;
    b.flash = 1;
    if (b.hp > 0) {
      b.kick = b.def.boss ? 0.04 : 0.28;
      burst(point, 0xfff4de, 4, 3);
      sfx.hit();
      crosshair('hit');
      return;
    }
    state.kills++;
    state.combo++;
    state.comboTimer = COMBO_WINDOW;
    state.score += b.def.points * comboMult();
    const p = new THREE.Vector3(b.pos.x, 0.7 * b.def.scale, b.pos.z);
    burst(p, b.def.color, 16, 6.5);
    burst(p, 0xfff4de, 6, 5);
    sfx.pop();
    crosshair('kill');
    if (Math.random() < b.def.drop) dropPickup(b.pos.x, b.pos.z);
    b.dead = true;
    b.dtm = 0;
    if (b.def.boss) bossDown(b);
  }

  function bossDown(b) {
    spawnQueue.length = 0;
    shake = 1.2;
    state.health = Math.min(100, state.health + 30);
    banner(b.def.name + ' defeated', 'The swarm scatters. +30 health');
    for (const o of bugs.slice()) if (o !== b && !o.dead) damageBug(o, 999, new THREE.Vector3(o.pos.x, 0.7, o.pos.z));
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3(b.pos.x + Math.cos(i * 2.1) * 3, 0, b.pos.z + Math.sin(i * 2.1) * 3);
      clampArena(v, 2);
      dropPickup(v.x, v.z);
    }
  }

  /* ----------------------------------------------------------------- shooting */
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const CENTER = new THREE.Vector2(0, 0), tmpV = new THREE.Vector2();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function bugCenter(b, out) { return out.set(b.pos.x, b.y + 0.7 * b.def.scale, b.pos.z); }

  function chainFrom(first, w) {   // Arc: lightning jumps to the nearest bugs
    const hitSet = [first], from = new THREE.Vector3(), to = new THREE.Vector3();
    let cur = first;
    for (let i = 0; i < w.chain; i++) {
      let best = null, bd = w.chainRange;
      bugCenter(cur, from);
      for (const o of bugs) {
        if (o.dead || hitSet.indexOf(o) >= 0) continue;
        const dd = bugCenter(o, to).distanceTo(from);
        if (dd < bd) { bd = dd; best = o; }
      }
      if (!best) break;
      bugCenter(best, to);
      addTracer(from, to, 0xd6b8ff, 0.04, 0.16);
      damageBug(best, w.chainDmg, to);
      hitSet.push(best);
      cur = best;
    }
  }

  function splashAt(p, w, direct) {   // Boomer: blast hurts every bug nearby
    const c = new THREE.Vector3();
    for (const o of bugs) {
      if (o.dead || o === direct) continue;
      if (bugCenter(o, c).distanceTo(p) < w.splash + o.def.r * 0.5) damageBug(o, w.splashDmg, c);
    }
    burst(p, 0xffa23d, 18, 7);
    burst(p, 0xfff4de, 8, 5);
    shake = Math.max(shake, 0.35);
  }

  function shoot() {
    const w = WEAPONS[weapon];
    fireCd = w.delay;
    recoil = w.kick;
    flash.intensity = w.flash;
    sfx[w.snd]();
    shake = Math.max(shake, w.kick * 0.05);
    player.pitch = clamp(player.pitch + w.kick * 0.012, -1.45, 1.45);

    scene.updateMatrixWorld(true);
    models[weapon].userData.muz.getWorldPosition(tmpA);
    if (w.sparks) burst(tmpA, w.tracer, w.sparks, 3.5);
    const list = bugs.filter((b) => !b.dead).map((b) => b.hit).concat(targets);

    for (let i = 0; i < w.pellets; i++) {
      let ndc = CENTER;
      if (w.spread) {
        const r = Math.sqrt(Math.random()) * w.spread, a = Math.random() * TAU;
        ndc = tmpV.set(Math.cos(a) * r / Math.max(1, camera.aspect), Math.sin(a) * r);
      }
      raycaster.setFromCamera(ndc, camera);
      let stopped = false;
      for (const h of raycaster.intersectObjects(list, false)) {
        const bug = h.object.userData.bug;
        if (bug && bug.dead) continue;
        tmpB.copy(h.point);
        if (bug) {
          damageBug(bug, w.dmg, h.point);
          if (w.chain) chainFrom(bug, w);
          if (w.splash) splashAt(h.point, w, bug);
          if (!w.pierce) { stopped = true; break; }   // the rail keeps going through bugs
        } else {
          burst(h.point, 0xfff4de, 3, 2.5);
          if (w.splash) splashAt(h.point, w, null);
          stopped = true;
          break;
        }
      }
      if (!stopped && w.splash) {   // shells also blow up on the ground
        const ry = raycaster.ray.direction.y;
        if (ry < -0.01) {
          const t = -raycaster.ray.origin.y / ry;
          if (t > 0 && t < 60) { raycaster.ray.at(t, tmpB); splashAt(tmpB, w, null); stopped = true; }
        }
      }
      if (!stopped) raycaster.ray.at(60, tmpB);
      addTracer(tmpA, tmpB, w.tracer, w.tw, w.tlife);
    }
  }

  /* ----------------------------------------------------------------- movement */
  function startSlide() {
    if (state.mode !== 'playing' || !player.onGround || slideTimer > 0 || slideCooldown > 0) return false;

    let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touchIn.fwd;
    let str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touchIn.strafe;
    let len = Math.hypot(fwd, str);
    // Pressing slide while standing still slides in the direction the camera faces.
    if (len < 0.12) { fwd = 1; str = 0; len = 1; }
    if (len > 1) { fwd /= len; str /= len; }

    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    slideDir.set(-sin * fwd + cos * str, 0, -cos * fwd - sin * str).normalize();
    slideTimer = SLIDE_DURATION;
    slideCooldown = SLIDE_COOLDOWN;
    return true;
  }

  function movePlayer(dt) {
    let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touchIn.fwd;
    let str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touchIn.strafe;
    const len = Math.hypot(fwd, str);
    if (len > 1) { fwd /= len; str /= len; }

    // Jumping cancels a slide, so the two movement actions stay distinct.
    if ((keys.Space || touchIn.jump) && player.onGround) {
      slideTimer = 0;
      player.vy = JUMP_V;
      player.onGround = false;
    }

    slideCooldown = Math.max(0, slideCooldown - dt);
    if (slideTimer > 0 && player.onGround) {
      slideTimer = Math.max(0, slideTimer - dt);
      const slideProgress = slideTimer / SLIDE_DURATION;
      const slideSpeed = SLIDE_SPEED * (0.58 + 0.42 * slideProgress);
      const slideK = Math.min(1, 22 * dt);
      player.vel.x += (slideDir.x * slideSpeed - player.vel.x) * slideK;
      player.vel.z += (slideDir.z * slideSpeed - player.vel.z) * slideK;
    } else {
      if (!player.onGround) slideTimer = 0;
      const speed = (keys.ShiftLeft || keys.ShiftRight) ? SPRINT : WALK;
      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      const tx = (-sin * fwd + cos * str) * speed;
      const tz = (-cos * fwd - sin * str) * speed;
      const k = Math.min(1, (player.onGround ? 12 : 3) * dt);
      player.vel.x += (tx - player.vel.x) * k;
      player.vel.z += (tz - player.vel.z) * k;
    }

    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;

    player.vy -= GRAVITY * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }

    collide(player.pos, PLAYER_R);
    clampArena(player.pos, 1.2);
  }

  function updateCamera(dt) {
    dt = dt || 1 / 60;
    const sliding = slideTimer > 0 && player.onGround;
    slideBlend += ((sliding ? 1 : 0) - slideBlend) * Math.min(1, dt * 14);
    document.body.classList.toggle('sliding', slideBlend > 0.08);
    const hs = Math.hypot(player.vel.x, player.vel.z);
    const bob = player.onGround ? Math.sin(bobT * 2) * 0.035 * Math.min(1, hs / WALK) : 0;
    camera.position.set(
      player.pos.x + (Math.random() - 0.5) * shake * 0.2,
      player.pos.y + EYE - 0.58 * slideBlend + bob + (Math.random() - 0.5) * shake * 0.2,
      player.pos.z
    );
    camera.rotation.set(player.pitch + slideBlend * 0.025, player.yaw, -slideBlend * 0.018);
    const baseFov = camera.aspect < 1 ? 86 : 72;
    const targetFov = baseFov + slideBlend * 5;
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
    const drop = swapT > 0 ? Math.sin(Math.PI * (1 - swapT / 0.3)) * 0.4 : 0, rk = Math.min(recoil, 3) / 3;
    gun.position.set(0.24, -0.22 - bob * 0.5 - drop - 0.2 * slideBlend + rk * 0.02, -0.5 + rk * 0.16 - 0.08 * slideBlend);
    gun.rotation.x = rk * 0.28 - drop * 0.8 + 0.12 * slideBlend;
    models[2].userData.core.material.color.setHex(Math.sin(performance.now() * 0.012) > 0 ? 0x7df9ff : 0xc4fdff);
    const arc = models[4].userData;
    arc.orb.scale.setScalar(1 + 0.18 * Math.sin(performance.now() * 0.02));
    arc.bars.forEach((b) => { b.visible = Math.random() > 0.35; });
  }

  /* --------------------------------------------------------------- main loop */
  function update(dt) {
    fireCd -= dt;
    recoil = Math.max(0, recoil - dt * 8);
    flash.intensity *= Math.exp(-dt * 30);
    hurtAlpha = Math.max(0, hurtAlpha - dt * 1.6);
    hurtEl.style.opacity = hurtAlpha;
    shake = Math.max(0, shake - dt * 1.6);
    bobT += Math.hypot(player.vel.x, player.vel.z) * dt * 0.85;

    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) bannerEl.classList.remove('show');
    }
    updateTracers(dt);
    if (swapT > 0) {
      swapT -= dt;
      if (swapT <= 0.15 && weaponShown !== weapon) showWeapon();
    }
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }

    movePlayer(dt);
    if (firing && fireCd <= 0 && swapT <= 0) shoot();
    updateBugs(dt);
    if (state.mode !== 'playing') return;
    updateShots(dt);
    if (state.mode !== 'playing') return;
    updatePickups(dt);
    updateParts(dt);
    updateWaves(dt);
    updateCamera(dt);
    updateHud();
    drawRadar();
  }

  function idleCamera(t) {
    const a = t * 0.12;
    camera.position.set(Math.cos(a) * 24, 9, Math.sin(a) * 24);
    camera.lookAt(0, 1.5, 0);
  }

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    clouds.rotation.y = time * 0.004;
    if (snow.visible) updateSnow(dt, time);
    if (state.mode === 'playing') update(dt);
    else if (state.mode === 'menu' || state.mode === 'over') {
      idleCamera(time);
      updateParts(dt);
    }
    dome.position.copy(camera.position);
    stars.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  /* ------------------------------------------------------- overlay and flow */
  const overlay = $('overlay');
  function showOverlay(title, html, label) {
    $('ovTitle').textContent = title;
    $('ovText').innerHTML = html;
    $('ovBtn').textContent = label;
    overlay.classList.add('show');
    if (!isTouch) $('ovBtn').focus({ preventScroll: true });
  }
  function hideOverlay() { overlay.classList.remove('show'); }

  function lock() {
    if (isTouch || !canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* the browser said no; clicking the game will retry */ }
  }

  function resetInput() {
    keys = {};
    firing = false;
    touchIn.fwd = touchIn.strafe = 0;
    touchIn.jump = false;
    slideTimer = 0;
    slideCooldown = 0;
    slideBlend = 0;
    document.body.classList.remove('sliding');
  }

  function clearWorld() {
    while (bugs.length) removeBug(bugs[0]);
    while (pickups.length) scene.remove(pickups.pop().group);
    while (shots.length) scene.remove(shots.pop().mesh);
    while (parts.length) scene.remove(parts.pop().mesh);
    tracers.forEach((t) => { t.life = 0; t.mesh.visible = false; });
    bannerEl.classList.remove('show');
  }

  function startGame() {
    clearWorld();
    if (pendingMap !== null) { loadMap(pendingMap); pendingMap = null; }
    resetInput();
    state.score = 0; state.wave = 0; state.health = 100; state.combo = 0; state.comboTimer = 0; state.kills = 0;
    player.pos.set(0, 0, 0);
    player.vel.set(0, 0, 0);
    player.vy = 0; player.onGround = true; player.yaw = 0; player.pitch = 0;
    fireCd = 0; recoil = 0; hurtAlpha = 0; shake = 0;
    spawnQueue = []; intermission = 0;
    weapon = 0; swapT = 0; showWeapon(); updateGunHud();
    setMode('playing');
    hideOverlay();
    lock();
    startWave();
    updateCamera(1 / 60);
    updateHud();
  }

  function pause() {
    if (state.mode !== 'playing') return;
    setMode('paused');
    resetInput();
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    showOverlay('Paused', 'The bugs will wait. Click to get back in.', 'Resume');
  }

  function resume() {
    if (state.mode !== 'paused') return;
    setMode('playing');
    hideOverlay();
    lock();
  }

  function gameOver() {
    if (state.mode === 'over') return;
    setMode('over');
    hud.boss.style.display = 'none'; last.boss = 0;
    firing = false;
    sfx.over();
    hurtAlpha = 0.9;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    const isBest = state.score > state.best;
    if (isBest) { state.best = state.score; saveBest(state.best); }
    pendingMap = RESPAWN_POOL[Math.floor(Math.random() * RESPAWN_POOL.length)];
    showOverlay(
      'Overrun',
      'Final score <b>' + fmt(state.score) + '</b>. You popped ' + state.kills + ' bugs and reached wave ' + state.wave + '.' +
        (isBest ? ' That is your best yet.' : ' Your best is ' + fmt(state.best) + '.') +
        ' You respawn in <b>' + MAPS[pendingMap].name + '</b>.',
      'Hunt again'
    );
    syncBoard({ name: cleanName(), score: state.score, wave: state.wave, kills: state.kills, map: MAPS[mapIndex].name });
  }

  $('ovBtn').addEventListener('click', () => {
    audioCtx();
    if (state.mode === 'paused') resume(); else startGame();
  });
  $('muteBtn').addEventListener('click', () => { audioCtx(); toggleMute(); });
  $('pauseBtn').addEventListener('click', pause);

  /* -------------------------------------------------------------------- input */
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;   // typing a name
    if (state.mode === 'playing' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyC' && !e.repeat) startSlide();
    if (e.code === 'KeyP' && state.mode === 'playing') pause();
    if (e.code === 'KeyQ') switchWeapon((weapon + 1) % WEAPONS.length);
    if (e.code.indexOf('Digit') === 0 && Number(e.code.slice(5)) <= WEAPONS.length) switchWeapon(Number(e.code.slice(5)) - 1);
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('wheel', (e) => { if (state.mode === 'playing') switchWeapon((weapon + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); });
  window.addEventListener('blur', () => { keys = {}; firing = false; });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && state.mode === 'playing' && !isTouch) pause();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  document.addEventListener('mousemove', (e) => {
    if (!locked || state.mode !== 'playing') return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
  });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && state.mode === 'playing') firing = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
  canvas.addEventListener('click', () => { if (state.mode === 'playing' && !locked) lock(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch: left stick moves, drag the right side to aim, buttons to fire and jump
  if (isTouch) {
    const joy = $('joy'), knob = $('joyKnob'), look = $('lookzone');
    let joyId = null, origin = { x: 0, y: 0 }, lookId = null, lx = 0, ly = 0;
    const opts = { passive: false };

    const moveJoy = (t) => {
      const max = 50;
      let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      knob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      touchIn.strafe = dx / max;
      touchIn.fwd = -dy / max;
    };
    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const r = joy.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      moveJoy(t);
    }, opts);
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === joyId) moveJoy(t);
    }, opts);
    const endJoy = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyId = null; touchIn.fwd = touchIn.strafe = 0; knob.style.transform = ''; }
      }
    };
    joy.addEventListener('touchend', endJoy);
    joy.addEventListener('touchcancel', endJoy);

    look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    }, opts);
    look.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        player.yaw -= (t.clientX - lx) * 0.006;
        player.pitch = clamp(player.pitch - (t.clientY - ly) * 0.006, -1.45, 1.45);
        lx = t.clientX; ly = t.clientY;
      }
    }, opts);
    const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
    look.addEventListener('touchend', endLook);
    look.addEventListener('touchcancel', endLook);

    const hold = (el, on, off) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, opts);
      el.addEventListener('touchend', (e) => { e.preventDefault(); off(); }, opts);
      el.addEventListener('touchcancel', off);
    };
    hold($('fireBtn'), () => { firing = true; }, () => { firing = false; });
    hold($('jumpBtn'), () => { touchIn.jump = true; }, () => { touchIn.jump = false; });
    $('slideBtn').addEventListener('click', startSlide);

    document.addEventListener('touchmove', (e) => { if (state.mode === 'playing') e.preventDefault(); }, opts);
  }

  // Controls cheat sheet on the title screen
  (function buildKeys() {
    const rows = isTouch
      ? [[['Left stick'], 'Move'], [['Drag right side'], 'Aim'], [['Fire'], 'Shoot'], [['Jump'], 'Hop over bugs'], [['Slide'], 'Burst forward'], [['Gun buttons'], 'Switch gun']]
      : [[['W', 'A', 'S', 'D'], 'Move'], [['Mouse'], 'Aim'], [['Click'], 'Shoot'], [['Space'], 'Hop over bugs'], [['Shift'], 'Sprint'], [['C'], 'Slide'], [['Esc'], 'Pause'], [['1-6'], 'Switch gun']];
    const box = $('ovKeys');
    rows.forEach((r) => {
      const left = document.createElement('div');
      left.className = 'kc';
      r[0].forEach((label) => {
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = label;
        left.appendChild(k);
      });
      const right = document.createElement('div');
      right.textContent = r[1];
      box.appendChild(left);
      box.appendChild(right);
    });
  })();

  /* ------------------------------------------------------- shared leaderboard */
  // Talks to a Firebase Realtime Database over plain fetch (URL set in assets/js/config.js).
  // Without a URL the game works as before and the leaderboard stays hidden.
  const DB = String(window.WEBHUNTER_DB || '').replace(/\/+$/, '');
  const nameIn = $('nameIn'), boardWrap = $('boardWrap'), boardEl = $('board'), boardNote = $('boardNote');
  try { nameIn.value = localStorage.getItem('webhunter-name') || ''; } catch (e) { /* storage blocked */ }
  nameIn.addEventListener('input', () => { try { localStorage.setItem('webhunter-name', nameIn.value.trim().slice(0, 12)); } catch (e) { /* ignore */ } });
  const cleanName = () => (nameIn.value || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12) || 'Hunter';

  async function fetchBoard() {
    const r = await fetch(DB + '/scores.json?orderBy=' + encodeURIComponent('"score"') + '&limitToLast=10', { cache: 'no-store' });
    if (!r.ok) throw new Error('read ' + r.status);
    const data = (await r.json()) || {};
    return Object.keys(data)
      .map((k) => Object.assign({ id: k }, data[k]))
      .filter((x) => x && typeof x.name === 'string' && isFinite(x.score))
      .sort((a, b) => b.score - a.score);
  }

  async function postScore(entry) {
    const body = Object.assign({}, entry, { t: { '.sv': 'timestamp' } });
    const r = await fetch(DB + '/scores.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('write ' + r.status);
    return (await r.json()).name;   // the new row's id
  }

  function renderBoard(rows, mineId) {
    boardEl.textContent = '';   // names come from strangers, so only ever set them as text
    rows.forEach((row) => {
      const li = document.createElement('li');
      if (row.id === mineId) li.className = 'me';
      const n = document.createElement('span'), w = document.createElement('span'), s = document.createElement('span');
      n.textContent = String(row.name).slice(0, 12);
      w.className = 'bw'; w.textContent = 'wave ' + (row.wave || 1);
      s.className = 'bs'; s.textContent = fmt(row.score);
      li.append(n, w, s);
      boardEl.appendChild(li);
    });
  }

  // Show the top 10; if `entry` is given and good enough to place, post it first.
  async function syncBoard(entry) {
    if (!DB) return;
    boardWrap.hidden = false;
    boardNote.textContent = 'Loading scores...';
    try {
      let rows = await fetchBoard(), mineId = null, note = '';
      if (entry && entry.score > 0) {
        if (rows.length < 10 || entry.score > rows[rows.length - 1].score) {
          mineId = await postScore(entry);
          rows = await fetchBoard();
          if (rows.some((x) => x.id === mineId)) note = 'You made the top 10.';
        } else note = 'Not in the top 10 this time.';
      }
      renderBoard(rows, mineId);
      boardNote.textContent = rows.length ? note : 'No scores yet. Be the first.';
    } catch (err) {
      boardNote.textContent = 'The leaderboard is offline right now.';
    }
  }
  if (!DB) $('nameRow').hidden = true;

  /* -------------------------------------------------------------------- go! */
  setMode('menu');
  $('hudBest').textContent = fmt(state.best);
  syncBoard(null);
  requestAnimationFrame(frame);
})();
