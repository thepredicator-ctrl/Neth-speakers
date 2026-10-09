/*
 * Parametric loudspeaker geometry for Three.js.
 *
 * Every component is generated from the DriverParams so dimension edits update
 * the model immediately. Cone/dust-cap/coil move rigidly with displacement;
 * the surround and spider are re-lathed each frame from displacement-dependent
 * profiles (roll flattening / corrugation unrolling); tinsel leads are
 * rebuilt as tubes with a moving attach point.
 *
 * Axis convention: speaker axis = +Y, cone radiates toward +Y ("up/front").
 * y = 0 is the baffle/gasket plane; the motor hangs below (−Y). Units: meters.
 */
import * as THREE from 'three';
import type { DriverParams, EnclosureParams } from '../physics/types';
import type { MaterialDef } from '../physics/types';
import { mm2m } from '../physics/units';

export interface DriverGeometry {
  group: THREE.Group;
  moving: THREE.Group;                 // cone + dust cap + coil (rigid)
  staticParts: THREE.Group;            // frame + motor (fixed)
  surround: THREE.Mesh;                // deformable
  spider: THREE.Mesh;                  // deformable
  leads: THREE.Group;                  // deformable tubes
  restRing: THREE.Mesh;                // displacement reference ring
  deform(x: number): void;             // per-frame deformation update
  dispose(): void;
}

const lathe = (pts: [number, number][], segments: number, material: THREE.Material): THREE.Mesh => {
  const v = pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const g = new THREE.LatheGeometry(v, segments);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Standard material with finish-aware roughness. */
function surf(color: string, finish: 'matte' | 'satin' | 'gloss', metalness = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: finish === 'gloss' ? 0.18 : finish === 'satin' ? 0.45 : 0.8,
    metalness,
    side: THREE.DoubleSide,
  });
}

/** Wire-winding stripe texture (diagonal copper lines). */
function windingTexture(copper: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#171310';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = copper;
  ctx.lineWidth = 4.5;
  for (let i = -2; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(-8, i * 8 + 2);
    ctx.lineTo(72, i * 8 + 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 3);
  return t;
}

export function buildDriver(p: DriverParams, mats: (id: string) => MaterialDef | undefined, quality: 'low' | 'med' | 'high'): DriverGeometry {
  const seg = quality === 'low' ? 40 : quality === 'high' ? 96 : 64;
  const group = new THREE.Group();
  const moving = new THREE.Group();
  const staticParts = new THREE.Group();
  const leads = new THREE.Group();
  group.add(staticParts, moving, leads);

  const coneMat = mats(p.cone.materialId);
  const coilMatDef = mats(p.coil.wireMaterialId);
  const magMatDef = mats(p.magnet.materialId);
  const steelMat = new THREE.MeshStandardMaterial({ color: '#5b6068', roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#6a6f77', roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({
    color: (p.frame as { color?: string }).color ?? '#33363c',
    roughness: (p.frame as { style?: string }).style === 'diecast' ? 0.5 : 0.6,
    metalness: (p.frame as { style?: string }).style === 'diecast' ? 0.7 : 0.55,
    side: THREE.DoubleSide,
  });
  const formerMat = new THREE.MeshStandardMaterial({ color: mats(p.coil.formerMaterialId)?.color ?? '#6b4d1e', roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
  const copper = new THREE.MeshStandardMaterial({
    map: windingTexture(coilMatDef?.id === 'aluminium-wire' ? '#c8ccd2' : '#b87333'),
    roughness: 0.4, metalness: 0.65, side: THREE.DoubleSide,
  });
  const magnetMat = new THREE.MeshStandardMaterial({
    color: magMatDef?.color ?? '#43302b',
    roughness: 0.85, metalness: magMatDef?.category === 'magnet' && magMatDef.id.startsWith('neo') ? 0.5 : 0.1,
    side: THREE.DoubleSide,
  });
  const paintedMat = new THREE.MeshStandardMaterial({ color: '#191a1d', roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide });
  const plateMat = (p.magnet as { painted?: boolean }).painted ? paintedMat : steelMat;
  const poleUseMat = (p.magnet as { painted?: boolean }).painted ? paintedMat : poleMat;

  /* ---------- key radii ---------- */
  const rConeOut = mm2m(p.cone.outerDiameter) / 2;
  const rCoil = mm2m(p.coil.windingDiameter) / 2;
  const rSurfIn = mm2m(p.surround.innerDiameter) / 2;
  const rSurfOut = mm2m(p.surround.outerDiameter) / 2;
  const rFrameOut = rSurfOut + mm2m(6);
  const depth = mm2m(p.cone.depth);
  const gapH = mm2m(p.magnet.topPlateThickness);
  const formerH = mm2m(p.coil.formerHeight);

  /* ---------- layout (y positions) ---------- */
  const ySeat = 0;                          // surround/cone seat plane
  const yConeInner = -depth;                // cone at coil junction
  const ySpider = yConeInner - formerH * 0.15 - mm2m(4);
  const yGapC = yConeInner - formerH * 0.52; // magnetic gap centre
  const yTopPlateTop = yGapC + gapH / 2;
  const yMagTop = yTopPlateTop;
  const magThk = mm2m(p.magnet.thickness);
  const backThk = mm2m(p.magnet.backPlateThickness);
  const yMagBottom = yMagTop - magThk * Math.max(1, p.magnet.count);
  const yBackTop = yMagBottom;
  const yBackBottom = yBackTop - backThk;
  const yFrameRear = yBackBottom + backThk * 0.4;
  const frameDepth = mm2m(p.frame.depth);

  /* ---------- cone ---------- */
  const coneMatMesh = surf(p.cone.color, p.cone.finish, 0.04);
  const coneProfile: [number, number][] = [];
  const nC = 16;
  const rConeIn = rCoil + mm2m(p.coil.formerThickness) + mm2m(1.5);
  for (let i = 0; i <= nC; i++) {
    const t = i / nC;
    const r = rConeIn + (rConeOut - rConeIn) * t;
    let y = yConeInner + (ySeat - yConeInner) * (p.cone.profile === 'curved' ? Math.pow(t, 0.78) : t);
    if (p.cone.profile === 'ribbed') {
      y += Math.sin(t * Math.PI * 8) * mm2m(0.7) * (1 - t * 0.4);
    }
    coneProfile.push([r, y]);
  }
  // small return lip at inner edge (glue joint)
  coneProfile.unshift([rConeIn - mm2m(1.2), yConeInner - mm2m(1.2)]);
  const cone = lathe(coneProfile, seg, coneMatMesh);
  moving.add(cone);

  /* ---------- dust cap ---------- */
  const rCap = mm2m(p.cone.dustCapDiameter) / 2;
  const capProfile: [number, number][] = [];
  const nD = 12;
  const capH = p.cone.dustCapShape === 'flat' ? mm2m(1.2) : rCap * 0.62 * (p.cone.dustCapShape === 'inverted' ? -1 : 1);
  for (let i = 0; i <= nD; i++) {
    const t = i / nD;
    const r = rCap * (1 - t);
    const y = yConeInner + mm2m(1.0) + capH * (1 - Math.pow(1 - t, 2) * 0.35) * Math.sin(t * Math.PI / 2);
    capProfile.push([Math.max(r, 1e-4), y]);
  }
  capProfile.unshift([rCap, yConeInner + mm2m(1.0)]);
  const dustCap = lathe(capProfile, seg, surf(coneMatDef_color(p), p.cone.finish === 'gloss' ? 'satin' : 'matte', 0.05));
  moving.add(dustCap);

  /* ---------- voice coil: former + winding layers ---------- */
  const rFormer = mm2m(p.coil.formerDiameter) / 2;
  const fT = Math.max(0.12e-3, mm2m(p.coil.formerThickness));
  const former = new THREE.Mesh(
    new THREE.CylinderGeometry(rFormer + fT, rFormer + fT, formerH, seg, 1, true),
    formerMat
  );
  const yFormerTop = yConeInner + mm2m(0.5); // flush with the cone junction — nothing pokes through
  former.position.y = yFormerTop - formerH / 2;
  moving.add(former);

  const wireR = mm2m(p.coil.wireDiameter) / 2;
  const layers = Math.max(1, Math.min(4, Math.round(p.coil.layers)));
  const turns = Math.max(1, Math.round(p.coil.turnsPerLayer));
  const pitch = mm2m(p.coil.wireDiameter) * 1.08;
  // AUTO-BALANCE (visual): winding stays ≥ 2.5 mm below the former top and
  // never pokes through the cone junction.
  const windTopLimit = formerH - Math.max(mm2m(2.5), formerH * 0.1);
  const windH = Math.min(turns * pitch, windTopLimit, formerH * 0.92);
  const yWindTop = yFormerTop - mm2m(2.5) - (p.coil.position / 1000);
  for (let L = 0; L < layers; L++) {
    const rIn = rFormer + fT + wireR + L * mm2m(p.coil.wireDiameter);
    const h = Math.min(windH, yWindTop - (yFormerTop - formerH));
    if (h <= 0) continue;
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn + wireR * 0.02, rIn + wireR * 0.02, h, seg, 1, true),
      copper
    );
    cyl.position.y = yWindTop - h / 2;
    moving.add(cyl);
  }

  /* ---------- magnet assembly ---------- */
  const rPole = mm2m(p.magnet.poleDiameter) / 2;
  const rMagOD = mm2m(p.magnet.diameter) / 2;
  const rMagID = mm2m(p.magnet.innerDiameter) / 2;
  const rTopOD = mm2m(p.magnet.topPlateDiameter) / 2;
  const rBackOD = mm2m(p.magnet.backPlateDiameter) / 2;
  const gapWR = mm2m(p.magnet.gapWidth);

  // pole piece: rises from backplate through magnet into the gap; top is flush
  // with the top-plate top face — nothing protrudes into the coil cavity.
  const poleTop = yTopPlateTop;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(rPole, rPole * 1.04, poleTop - yBackTop + backThk, seg), poleUseMat);
  pole.position.y = (poleTop + yBackTop - backThk) / 2;
  staticParts.add(pole);

  // top plate (annulus): ID = rPole + gapWR
  const topPlate = lathe([
    [rPole + gapWR, yTopPlateTop],
    [rTopOD, yTopPlateTop],
    [rTopOD, yTopPlateTop - gapH],
    [rPole + gapWR, yTopPlateTop - gapH],
  ], seg, plateMat);
  staticParts.add(topPlate);

  // magnet ring(s)
  for (let k = 0; k < Math.max(1, Math.round(p.magnet.count)); k++) {
    const yT = yMagTop - k * magThk - (k > 0 ? mm2m(0.4) : 0);
    const ring = lathe([
      [rMagID, yT],
      [rMagOD, yT],
      [rMagOD, yT - magThk],
      [rMagID, yT - magThk],
    ], seg, magnetMat);
    staticParts.add(ring);
  }

  // back plate
  const backPlate = lathe([
    [mm2m(3), yBackTop],
    [rBackOD, yBackTop],
    [rBackOD, yBackBottom],
    [mm2m(3), yBackBottom],
  ], seg, plateMat);
  staticParts.add(backPlate);

  /* ---------- frame / basket ---------- */
  const flangeW = mm2m(7);
  const frontFlange = lathe([
    [rSurfOut - mm2m(2), ySeat + mm2m(1.4)],
    [rFrameOut, ySeat + mm2m(1.4)],
    [rFrameOut, ySeat - flangeW],
    [rSurfOut - mm2m(4), ySeat - flangeW],
  ], seg, frameMat);
  staticParts.add(frontFlange);

  // gasket (optional)
  if ((p.frame as { gasket?: boolean }).gasket !== false) {
    const gasket = new THREE.Mesh(
      new THREE.TorusGeometry(rFrameOut - mm2m(2.6), mm2m(p.frame.gasketThickness) / 2, 10, seg),
      new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.95 })
    );
    gasket.rotation.x = Math.PI / 2;
    gasket.position.y = ySeat + mm2m(p.frame.gasketThickness) / 2 + mm2m(1.4);
    staticParts.add(gasket);
  }

  // struts: tapered basket legs slanting from the flange underside down to the
  // rear ring — each oriented along the actual connection line so they always
  // connect the two rings (never float, never poke through the cone).
  const nStruts = (p.frame as { style?: string }).style === 'diecast' ? 5 : 6;
  const legW = (p.frame as { style?: string }).style === 'diecast' ? mm2m(14) : mm2m(9);
  const yTop = ySeat - flangeW;
  const rLegTop = rFrameOut - mm2m(4);
  const rLegBot = rBackOD + mm2m(6);
  for (let i = 0; i < nStruts; i++) {
    const ang = (i / nStruts) * Math.PI * 2 + Math.PI / nStruts;
    const a = new THREE.Vector3(Math.cos(ang) * rLegTop, yTop, Math.sin(ang) * rLegTop);
    const b = new THREE.Vector3(Math.cos(ang) * rLegBot, yFrameRear + mm2m(2), Math.sin(ang) * rLegBot);
    const len = a.distanceTo(b);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, len, mm2m(4.5)), frameMat);
    leg.position.copy(a).add(b).multiplyScalar(0.5);
    // orient the box's +Y axis along (b - a)
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    leg.userData.explodedGroup = 'frame';
    staticParts.add(leg);
  }

  // rear ring + spider shelf
  const rearRing = lathe([
    [rBackOD + mm2m(5), yFrameRear + mm2m(3)],
    [rBackOD + mm2m(11), yFrameRear + mm2m(3)],
    [rBackOD + mm2m(11), yFrameRear - mm2m(6)],
    [rBackOD + mm2m(5), yFrameRear - mm2m(6)],
  ], seg, frameMat);
  staticParts.add(rearRing);

  const shelf = lathe([
    [mm2m(p.spider.outerDiameter) / 2, ySpider - mm2m(1)],
    [rMagOD + mm2m(2), ySpider - mm2m(1)],
  ], seg, frameMat);
  staticParts.add(shelf);

  // terminals
  const termMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.35, metalness: 0.85 });
  for (const sx of [-1, 1]) {
    const term = new THREE.Mesh(new THREE.BoxGeometry(mm2m(14), mm2m(10), mm2m(5)), frameMat);
    term.position.set(sx * (rBackOD + mm2m(11) + mm2m(2)), yFrameRear, 0);
    staticParts.add(term);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(mm2m(1.8), mm2m(1.8), mm2m(8), 12), termMat);
    post.position.set(sx * (rBackOD + mm2m(11) + mm2m(2)), yFrameRear + mm2m(7), 0);
    staticParts.add(post);
  }

  /* ---------- deformables ---------- */
  const surrMatDef = mats(p.surround.materialId);
  const surroundMat = new THREE.MeshStandardMaterial({
    color: (p.surround as { color?: string }).color ?? surrMatDef?.color ?? '#17181c',
    roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
  });
  const surround = lathe([[rSurfIn, 0], [rSurfIn + 0.002, 0]], seg, surroundMat);
  staticParts.add(surround); // geometry replaced per-frame; parented under static root for transforms

  const spiderMat = new THREE.MeshStandardMaterial({
    color: (p.spider as { color?: string }).color ?? mats(p.spider.materialId)?.color ?? '#8a7a5c',
    roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });
  const spider = lathe([[mm2m(p.spider.innerDiameter) / 2, ySpider], [mm2m(p.spider.outerDiameter) / 2, ySpider]], seg, spiderMat);
  staticParts.add(spider);

  const leadMat = new THREE.MeshStandardMaterial({ color: '#b87333', roughness: 0.5, metalness: 0.6 });
  const leadMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < Math.max(2, Math.min(4, p.frame.tinselLeads)); i++) {
    const lm = new THREE.Mesh(new THREE.BufferGeometry(), leadMat);
    leadMeshes.push(lm);
    leads.add(lm);
  }

  // rest-position reference ring (thin, at the surround seat)
  const restRing = new THREE.Mesh(
    new THREE.TorusGeometry(rSurfIn + mm2m(0.6), mm2m(0.35), 8, seg),
    new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.55 })
  );
  restRing.rotation.x = Math.PI / 2;
  restRing.position.y = ySeat;
  staticParts.add(restRing);

  /* ---------- per-frame deformation ---------- */
  const rollH = mm2m(p.surround.rollHeight);
  const rollW = mm2m(p.surround.rollWidth);
  const rolls = Math.max(1, Math.round(p.surround.rollCount));
  const corrN = Math.max(3, Math.round(p.spider.corrugations));
  const corrD = mm2m(p.spider.corrDepth);
  const rSpIn = mm2m(p.spider.innerDiameter) / 2;
  const rSpOut = mm2m(p.spider.outerDiameter) / 2;

  function deform(x: number): void {
    // --- surround: arcs between cone edge (moves) and frame seat (fixed) ---
    const pts: THREE.Vector2[] = [];
    const nS = 26;
    const span = rSurfOut - rSurfIn;
    const xN = Math.max(-1, Math.min(1, x / Math.max(rollH * 1.35, 1e-4)));
    const squash = Math.sqrt(Math.max(0.06, 1 - xN * xN * 0.92));
    for (let roll = 0; roll < rolls; roll++) {
      const t0 = roll / rolls, t1 = (roll + 1) / rolls;
      for (let i = 0; i <= nS; i++) {
        const t = t0 + ((t1 - t0) * i) / nS;
        const ph = ((t * rolls) % 1) * Math.PI; // 0..π per roll
        const r = rSurfIn + span * t;
        const y = ySeat + x * (1 - t) + rollH * squash * Math.sin(ph) - rollW * 0.22 * (1 - Math.sin(ph));
        pts.push(new THREE.Vector2(Math.max(r, 1e-4), y));
      }
    }
    surround.geometry.dispose();
    surround.geometry = new THREE.LatheGeometry(pts, seg);

    // --- spider: corrugations flatten as excursion grows ---
    const spts: THREE.Vector2[] = [];
    const nP = 40;
    const amp = corrD * (1 / (1 + Math.abs(x) / (0.55 * corrD + 0.4e-3)));
    for (let i = 0; i <= nP; i++) {
      const t = i / nP;
      const r = rSpIn + (rSpOut - rSpIn) * t;
      const y = ySpider + x * (1 - t) + amp * Math.sin(corrN * t * Math.PI * 2) * Math.sin(t * Math.PI);
      spts.push(new THREE.Vector2(Math.max(r, 1e-4), y));
    }
    spider.geometry.dispose();
    spider.geometry = new THREE.LatheGeometry(spts, seg);

    // --- tinsel leads: attached at the cone INNER surface, routed INSIDE the
    // basket to the terminals — never crossing the surround or frame. ---
    const rAttach = rConeIn + mm2m(3);
    const yAttach = yConeInner + mm2m(3) + x;
    const yTerm = yFrameRear + mm2m(2);
    for (let i = 0; i < leadMeshes.length; i++) {
      const ang = Math.PI * (0.25 + 0.5 * i / Math.max(1, leadMeshes.length - 1));
      const ax = Math.cos(ang) * rAttach, az = Math.sin(ang) * rAttach;
      const tx = Math.cos(ang) * (rBackOD + mm2m(10)), tz = Math.sin(ang) * (rBackOD + mm2m(10));
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(ax, yAttach, az),
        new THREE.Vector3(ax * 0.55 + tx * 0.45, (yAttach + yTerm) / 2 - mm2m(4), az * 0.55 + tz * 0.45),
        new THREE.Vector3(tx, yTerm, tz)
      );
      const g = new THREE.TubeGeometry(curve, 14, mm2m(0.55), 6, false);
      leadMeshes[i].geometry.dispose();
      leadMeshes[i].geometry = g;
    }
  }
  deform(0);

  return {
    group, moving, staticParts,
    surround, spider, leads, restRing,
    deform,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    },
  };
}

function coneMatDef_color(p: DriverParams): string {
  // dust cap slightly darker than the cone
  const c = new THREE.Color(p.cone.color);
  c.multiplyScalar(0.8);
  return `#${c.getHexString()}`;
}

/* ---------------------------------------------------------------------------
 * Enclosure (cutaway) geometry
 * ------------------------------------------------------------------------- */
export interface EnclosureGeometry { group: THREE.Group; setWallOpacity(o: number): void; dispose(): void }

export function buildEnclosure(enc: EnclosureParams, driver: DriverParams, quality: 'low' | 'med' | 'high'): EnclosureGeometry {
  const group = new THREE.Group();
  const W = mm2m(enc.internalWidth) + mm2m(enc.wallThickness) * 2;
  const D = mm2m(enc.internalDepth) + mm2m(enc.wallThickness);
  const H = mm2m(enc.internalHeight) + mm2m(enc.wallThickness) * 2;
  const t = mm2m(enc.wallThickness);

  const wallMat = new THREE.MeshStandardMaterial({
    color: (enc as { finishColor?: string }).finishColor || mats_enc_color(enc),
    roughness: 0.85, metalness: 0.02,
    transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#3a3f49', transparent: true, opacity: 0.7 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(W, D, H), wallMat);
  group.add(box);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, D, H)), edgeMat);
  group.add(edges);

  // front baffle hole indication: driver sits on front face; shift box so front face at y=0
  group.position.y = -D / 2 + t / 2;

  // port tube(s) — length clamped to the internal depth so nothing protrudes
  if (enc.type === 'ported') {
    const portMat = new THREE.MeshStandardMaterial({ color: '#20232a', roughness: 0.6, side: THREE.DoubleSide });
    const flareMat = new THREE.MeshStandardMaterial({ color: '#191b20', roughness: 0.75, side: THREE.DoubleSide });
    const count = Math.max(1, Math.min(4, enc.port.count));
    const maxLen = D - 2 * t - mm2m(5);
    for (let i = 0; i < count; i++) {
      const r = mm2m(enc.port.diameter) / 2;
      const len = Math.min(mm2m(enc.port.length), maxLen);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, quality === 'low' ? 20 : 40, 1, true), portMat);
      const ang = count === 1 ? 0 : (i / (count - 1) - 0.5) * Math.PI * 0.7;
      tube.position.set(Math.sin(ang) * W * 0.3, -len / 2 + t, Math.cos(ang) * H * 0.28);
      tube.rotation.y = -ang * 0.4;
      group.add(tube);
      if (enc.port.flared) {
        // flare ring on the baffle side
        const flare = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, Math.max(r * 0.1, mm2m(2)), 10, quality === 'low' ? 24 : 40), flareMat);
        flare.rotation.x = Math.PI / 2;
        flare.position.set(tube.position.x, t + mm2m(0.5), tube.position.z);
        group.add(flare);
      }
      void r; void len;
    }
  }

  // front grille (optional): a slim mesh disc just in front of the driver
  if ((enc as { grille?: { enabled?: boolean; color?: string } }).grille?.enabled) {
    const gColor = (enc as { grille?: { color?: string } }).grille?.color ?? '#141414';
    const grilleMat = new THREE.MeshStandardMaterial({
      color: gColor, roughness: 0.8, metalness: 0.1,
      transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    });
    const rG = mm2m(driver.surround.outerDiameter) / 2 + mm2m(10);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(rG, quality === 'low' ? 32 : 56), grilleMat);
    grille.rotation.x = -Math.PI / 2;
    grille.position.y = mm2m(14);
    group.add(grille);
    const grilleRing = new THREE.Mesh(
      new THREE.TorusGeometry(rG, mm2m(4), 8, quality === 'low' ? 32 : 56),
      new THREE.MeshStandardMaterial({ color: gColor, roughness: 0.6, metalness: 0.3 })
    );
    grilleRing.rotation.x = Math.PI / 2;
    grilleRing.position.y = mm2m(13);
    group.add(grilleRing);
  }

  // passive radiator on the rear wall
  if (enc.type === 'passiveRadiator' && enc.passive.enabled) {
    const r = mm2m(enc.passive.diameter) / 2;
    const pr = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, mm2m(14), quality === 'low' ? 28 : 48, 1, false),
      new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.9 })
    );
    pr.rotation.x = Math.PI / 2;
    pr.position.set(0, -D + t, 0);
    group.add(pr);
  }

  // bracing
  const braceMat = new THREE.MeshStandardMaterial({ color: '#4a3d2c', roughness: 0.9 });
  for (const yy of [-D * 0.33, -D * 0.66]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, mm2m(18), mm2m(30)), braceMat);
    brace.position.y = yy;
    group.add(brace);
  }

  void driver;
  return {
    group,
    setWallOpacity(o: number) { wallMat.opacity = o; },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };
}

function mats_enc_color(enc: EnclosureParams): string {
  const map: Record<string, string> = { mdf: '#7a5c3e', 'birch-ply': '#a3814f', particleboard: '#6b543a' };
  return map[enc.wallMaterialId] ?? '#7a5c3e';
}
