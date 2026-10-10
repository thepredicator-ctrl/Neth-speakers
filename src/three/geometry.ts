/*
 * Parametric loudspeaker geometry for Three.js.
 *
 * ALL positions and radii come from computeLayout() (src/physics/layout.ts) —
 * the single source of truth shared with the physics and the statistics.
 * Attachments are exact at every excursion:
 *   cone outer edge ↔ surround inner edge (shared seat plane)
 *   surround outer edge ↔ frame flange seat (flat landing tab)
 *   cone inner edge ↔ voice-coil former top (bonded, neck curve)
 *   dust dome edge ↔ cone flat shoulder (shared plane)
 *   spider inner edge ↔ former outer wall (same radius, rides with x)
 *   spider outer edge ↔ basket shelf (fixed seat)
 *   winding straddles the magnetic gap (gap centre == winding centre)
 *   basket legs land on the shelf ring and on the motor/top-plate rim
 *   motor boot wraps the stack (top face under the plate ring, bottom below)
 *
 * Cone/dust-cap/coil/former move rigidly with displacement; the surround and
 * spider are re-lathed each frame from displacement-dependent profiles whose
 * endpoints never detach; tinsel leads bond to the former and land on the
 * terminals. Axis: +Y forward, y = 0 baffle plane, motor below. Units: metres.
 *
 * Driver styling follows the reference build (Sundown X-series class):
 * deep straight cone, flat radial shoulder, raised logo dome, wide outward
 * half-roll surround, tall 8-leg basket, rubber motor boot, race terminals.
 */
import * as THREE from 'three';
import type { DriverParams, EnclosureParams } from '../physics/types';
import type { MaterialDef } from '../physics/types';
import { mm2m } from '../physics/units';
import {
  computeLayout, surroundProfile, spiderProfile,
  surroundWrinkleAmp, surroundWrinkleCount,
  rockLiftY, rockRimCapM, rockBeat,
  type DriverLayout,
} from '../physics/layout';

export interface DriverGeometry {
  group: THREE.Group;
  moving: THREE.Group;                 // cone + dust cap + coil + former (rigid)
  staticParts: THREE.Group;            // frame + motor (fixed)
  surround: THREE.Mesh;                // deformable
  spider: THREE.Mesh;                  // deformable
  leads: THREE.Group;                  // deformable tubes
  restRing: THREE.Mesh;                // displacement reference ring
  /** Geometric excursion envelope (m) — visuals are clamped inside it. */
  limits: { up: number; down: number };
  deform(x: number, drive?: DriveState): void; // per-frame deformation update
  dispose(): void;
}

/**
 * Live drive state for the flexible-body visualisation (cone breakup waves,
 * surround travelling waves AND the rocking/tilt mode). `amp01` is a
 * normalised motion intensity (0 = at rest / idle, 1 = solidly driven),
 * `fHz` the estimated dominant frequency of the displacement signal, `t`
 * the wall-clock time (s). `tilt01` is the rocking intensity — one side of
 * the cone leads the stroke while the other lags — and `tiltAxis` is the
 * slowly precessing tilt axis, so which side leads keeps changing. All
 * wave/rock amplitudes scale with the PHYSICAL signal — the enhanced-viz
 * multiplier never inflates them.
 */
export interface DriveState {
  amp01: number;
  fHz: number;
  t: number;
  tilt01: number;
  tiltAxis: number;
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

/** Procedural paper/fibre bump map — speckle + long stray fibres, like a
 *  real pressed-pulp cone surface. Adds tactile grain under studio light. */
function fiberBumpTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, s, s);
  // fine pulp speckle
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 46;
    img.data[i] = Math.max(0, Math.min(255, 128 + n));
    img.data[i + 1] = img.data[i];
    img.data[i + 2] = img.data[i];
  }
  ctx.putImageData(img, 0, 0);
  // long stray fibres catching the light
  ctx.strokeStyle = 'rgba(160,160,160,0.5)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const a = Math.random() * Math.PI * 2, l = 6 + Math.random() * 22;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.3) * l * 0.5, y + Math.sin(a + 0.3) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  return t;
}

export function buildDriver(p: DriverParams, mats: (id: string) => MaterialDef | undefined, quality: 'low' | 'med' | 'high'): DriverGeometry {
  const seg = quality === 'low' ? 40 : quality === 'high' ? 96 : 64;
  const L: DriverLayout = computeLayout(p);
  const group = new THREE.Group();
  const moving = new THREE.Group();
  const staticParts = new THREE.Group();
  const leads = new THREE.Group();
  group.add(staticParts, moving, leads);

  const coneMatDef = mats(p.cone.materialId);
  const coilMatDef = mats(p.coil.wireMaterialId);
  const magMatDef = mats(p.magnet.materialId);
  const steelMat = new THREE.MeshStandardMaterial({ color: '#5b6068', roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#6a6f77', roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({
    color: (p.frame as { color?: string }).color ?? '#33363c',
    roughness: (p.frame as { style?: string }).style === 'diecast' ? 0.42 : 0.52,
    metalness: (p.frame as { style?: string }).style === 'diecast' ? 0.85 : 0.62,
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
  const bootMat = new THREE.MeshStandardMaterial({ color: '#101114', roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
  const plateMat = (p.magnet as { painted?: boolean }).painted ? paintedMat : steelMat;
  const poleUseMat = (p.magnet as { painted?: boolean }).painted ? paintedMat : poleMat;

  /* ---------- cone: former bond → concave neck → shoulder → straight body ---------- */
  // Profile (r, y), centre→out. The body runs from the shoulder corner to the
  // surround seat; the neck blends the shoulder region down to the former top
  // so the bond is a visible, continuous surface (nothing floats).
  // Matte/satin cones get a procedural pulp-fibre bump map; gloss cones get a
  // physical clearcoat (painted / glassed builds).
  const fiberBump = p.cone.finish === 'gloss' ? null : fiberBumpTexture();
  const coneMatMesh = p.cone.finish === 'gloss'
    ? new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(p.cone.color), roughness: 0.24, metalness: 0.05,
        clearcoat: 0.9, clearcoatRoughness: 0.22, side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.cone.color),
        roughness: p.cone.finish === 'satin' ? 0.5 : 0.82, metalness: 0.04,
        bumpMap: fiberBump ?? null, bumpScale: 2.6e-4,
        side: THREE.DoubleSide,
      });
  const tuck = mm2m(0.7);
  const coneProfile: [number, number][] = [];
  coneProfile.push([Math.max(1e-4, L.rConeIn - tuck), L.yConeInner - tuck]); // glue tuck behind former wall
  coneProfile.push([L.rConeIn, L.yConeInner]);                                // bonded: former top
  // concave neck (cove) from the former bond up to the shoulder corner
  const nN = 8;
  const c1R = L.rConeIn + 0.30 * (L.rShoulder - L.rConeIn);
  const c1Y = L.yConeInner + 0.10 * (L.yShoulder - L.yConeInner);
  for (let i = 1; i <= nN; i++) {
    const t = i / nN;
    const mt = 1 - t;
    const r = mt * mt * L.rConeIn + 2 * mt * t * c1R + t * t * L.rShoulder;
    const y = mt * mt * L.yConeInner + 2 * mt * t * c1Y + t * t * L.yShoulder;
    coneProfile.push([r, y]);
  }
  // straight (or styled) body from the shoulder to the surround seat
  const nC = 18;
  for (let i = 1; i <= nC; i++) {
    const t = i / nC;
    const r = L.rShoulder + (L.rConeOut - L.rShoulder) * t;
    let y = L.yShoulder + (L.ySeat - L.yShoulder) * (p.cone.profile === 'curved' ? Math.pow(t, 0.86) : t);
    if (p.cone.profile === 'ribbed') {
      y += Math.sin(t * Math.PI * 7) * mm2m(0.7) * (1 - t * 0.35);
    }
    coneProfile.push([r, y]);
  }
  // rim curl under the surround root (clean seat edge, no sliver gap)
  coneProfile.push([L.rConeOut + mm2m(0.4), L.ySeat - mm2m(0.5)]);
  const cone = lathe(coneProfile, seg, coneMatMesh);
  moving.add(cone);

  // --- cone flex cache -----------------------------------------------------
  // The cone body is the flexible surface: ring standing waves + subtle
  // sector lobes (breakup) ride on top of the rigid motion. The envelope is
  // EXACTLY zero from the former bond through the shoulder (dust cap stays
  // attached) and at the surround seat (bond never detaches) — only the
  // free body between shoulder and rim can flex.
  const conePosAttr = cone.geometry.getAttribute('position') as THREE.BufferAttribute;
  const coneBase = Float32Array.from(conePosAttr.array as Float32Array);
  const coneCount = conePosAttr.count;
  const coneR = new Float32Array(coneCount);
  const coneTheta = new Float32Array(coneCount);
  const coneW = new Float32Array(coneCount);       // flex envelope per vertex
  {
    const rA = L.rShoulder;                        // rigid inboard of here
    const rB = L.rConeOut;                         // surround bond — pinned
    for (let i = 0; i < coneCount; i++) {
      const x = coneBase[i * 3], z = coneBase[i * 3 + 2];
      const r = Math.hypot(x, z);
      coneR[i] = r;
      coneTheta[i] = Math.atan2(z, x);
      const u = (r - rA) / Math.max(1e-6, rB - rA);
      coneW[i] = u > 0 && u < 1 ? Math.pow(Math.sin(Math.PI * u), 1.15) : 0;
    }
  }

  /* ---------- dust dome: flat land + raised dome, seated on the shoulder ---------- */
  const capProfile: [number, number][] = [];
  capProfile.push([L.rShoulder, L.yShoulder]);                 // outer land on the cone shoulder
  capProfile.push([L.rCap, L.yShoulder]);                      // flat annulus
  if (p.cone.dustCapShape === 'inverted') {
    const nD = 14;
    for (let i = 1; i <= nD; i++) {
      const u = i / nD;
      const r = L.rCap * (1 - u);
      const y = L.yShoulder + mm2m(0.6) - L.capH * 0.45 * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.2)));
      capProfile.push([Math.max(r, 1e-4), y]);
    }
  } else if (p.cone.dustCapShape === 'flat') {
    capProfile.push([mm2m(2), L.yShoulder + mm2m(1.2)]);
    capProfile.push([1e-4, L.yShoulder + mm2m(1.2)]);
  } else {
    // raised dome (superellipse — full sides, slightly flattened logo pad)
    const nD = 18;
    for (let i = 1; i <= nD; i++) {
      const u = i / nD;
      const r = L.rCap * (1 - u);
      const y = L.yShoulder + L.capH * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.2)));
      capProfile.push([Math.max(r, 1e-4), y]);
    }
  }
  const dustCap = lathe(capProfile, seg, p.cone.finish === 'gloss'
    ? new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(coneMatDef_color(p)), roughness: 0.24, metalness: 0.05,
        clearcoat: 0.9, clearcoatRoughness: 0.22, side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        color: new THREE.Color(coneMatDef_color(p)),
        roughness: p.cone.finish === 'satin' ? 0.5 : 0.84, metalness: 0.04,
        bumpMap: fiberBump ?? null, bumpScale: 2.2e-4,
        side: THREE.DoubleSide,
      }));
  moving.add(dustCap);

  /* ---------- voice coil: former + winding straddling the gap ---------- */
  const former = new THREE.Mesh(
    new THREE.CylinderGeometry(L.rFormerOut, L.rFormerOut, L.yFormerTop - L.yFormerBottom, seg, 1, true),
    formerMat
  );
  former.position.y = (L.yFormerTop + L.yFormerBottom) / 2;
  moving.add(former);

  const wireR = mm2m(p.coil.wireDiameter) / 2;
  const layers = Math.max(1, Math.min(4, Math.round(p.coil.layers)));
  // winding centred on the magnetic gap (+ coil.position toward the front);
  // every layer sits ON the former, stacked outward by one wire diameter.
  const yWindC = L.yWindC;
  const windMeshes: THREE.Mesh[] = [];
  for (let k = 0; k < layers; k++) {
    const rMid = L.rFormerOut + wireR + k * mm2m(p.coil.wireDiameter);
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(rMid, rMid, L.windH, seg, 1, true),
      copper
    );
    cyl.position.y = yWindC;
    moving.add(cyl);
    windMeshes.push(cyl);
  }

  /* ---------- magnet assembly (gap centre == winding centre) ---------- */
  // pole piece: from the back plate up to the top-plate top face — flush,
  // nothing protrudes into the coil bore.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(L.rPole, L.rPole * 1.04, L.yTopPlateTop - L.yBackBottom, seg),
    poleUseMat
  );
  pole.position.y = (L.yTopPlateTop + L.yBackBottom) / 2;
  staticParts.add(pole);

  // top plate (annulus): bore = rPole + gapWidth, exactly gapH tall
  const topPlate = lathe([
    [L.rGapInner, L.yTopPlateTop],
    [L.rTopOD, L.yTopPlateTop],
    [L.rTopOD, L.yTopPlateBottom],
    [L.rGapInner, L.yTopPlateBottom],
  ], seg, plateMat);
  staticParts.add(topPlate);

  // magnet ring(s) stacked under the top plate
  const magThk = (L.yMagTop - L.yMagBottom) / Math.max(1, Math.round(p.magnet.count));
  for (let k = 0; k < Math.max(1, Math.round(p.magnet.count)); k++) {
    const yT = L.yMagTop - k * magThk - (k > 0 ? mm2m(0.4) : 0);
    const ring = lathe([
      [L.rMagID, yT],
      [L.rMagOD, yT],
      [L.rMagOD, yT - magThk],
      [L.rMagID, yT - magThk],
    ], seg, magnetMat);
    staticParts.add(ring);
  }

  // back plate
  const backPlate = lathe([
    [mm2m(3), L.yBackTop],
    [L.rBackOD, L.yBackTop],
    [L.rBackOD, L.yBackBottom],
    [mm2m(3), L.yBackBottom],
  ], seg, plateMat);
  staticParts.add(backPlate);

  /* ---------- motor boot (rubber cover over the stack) ---------- */
  if (L.boot) {
    const rb = L.rBoot;
    const h = L.yBootTop - L.yBootBottom;
    const rC = Math.min(rb * 0.16, h * 0.28);
    const bp: [number, number][] = [];
    bp.push([rb * 0.28, L.yBootTop]);                 // top face (under the plate ring)
    bp.push([rb, L.yBootTop]);                        // top outer edge
    bp.push([rb, L.yBootBottom + rC]);                // straight wall
    for (let i = 1; i <= 6; i++) {                    // rounded bottom corner
      const a = (i / 6) * Math.PI / 2;
      bp.push([rb - rC * (1 - Math.sin(a)), L.yBootBottom + rC - rC * (1 - Math.cos(a))]);
    }
    bp.push([rb * 0.55, L.yBootBottom]);              // bottom face
    bp.push([rb * 0.30, L.yBootBottom - h * 0.06]);   // centre vents down (pole vent)
    bp.push([mm2m(2), L.yBootBottom - h * 0.075]);
    const bootMesh = lathe(bp, seg, bootMat);
    bootMesh.userData.explodedGroup = 'motor';
    staticParts.add(bootMesh);
  }

  /* ---------- frame / basket ---------- */
  const flangeW = mm2m(7);
  // rolled lip: both outer corners filleted like a real stamped/cast flange
  const flangePts: [number, number][] = [];
  {
    const lipR = mm2m(2);
    const rIn = L.rSurfOut - mm2m(2), rOut = L.rFrameOut;
    const yT = L.yFrameSeat, yB = L.yFrameSeat - flangeW;
    flangePts.push([rIn, yT]);
    // top face → rounded top-outer corner
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * Math.PI / 2;
      flangePts.push([rOut - lipR + lipR * Math.sin(a), yT - lipR + lipR * Math.cos(a)]);
    }
    // outer wall → rounded bottom-outer corner
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * Math.PI / 2;
      flangePts.push([rOut - lipR + lipR * Math.cos(a), yB + lipR - lipR * Math.sin(a)]);
    }
    flangePts.push([L.rSurfOut - mm2m(4), yB]);
  }
  const frontFlange = lathe(flangePts, seg, frameMat);
  frontFlange.userData.explodedGroup = 'front';
  staticParts.add(frontFlange);

  // countersunk bolt circle: dark recesses sunk into the flange top face —
  // instantly reads as a real mounting flange instead of a plain ring
  {
    const nBolts = Math.max(4, Math.min(12, Math.round((p.frame as { mountingHoles?: number }).mountingHoles ?? 4)));
    const rBolt = (L.rSurfOut + L.rFrameOut) / 2 - mm2m(1.5);
    const rHole = Math.min(mm2m(2.1), (L.rFrameOut - L.rSurfOut) * 0.22);
    if (rHole > mm2m(0.8)) {
      const holeMat = new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.92, metalness: 0.2 });
      for (let i = 0; i < nBolts; i++) {
        const ang = (i / nBolts) * Math.PI * 2 + Math.PI / nBolts;
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(rHole, rHole, mm2m(2), 14), holeMat);
        hole.position.set(Math.cos(ang) * rBolt, L.yFrameSeat - mm2m(0.7), Math.sin(ang) * rBolt);
        hole.userData.explodedGroup = 'front';
        staticParts.add(hole);
      }
    }
  }

  // gasket (optional)
  if ((p.frame as { gasket?: boolean }).gasket !== false) {
    const gasket = new THREE.Mesh(
      new THREE.TorusGeometry(L.rFrameOut - mm2m(2.6), mm2m(p.frame.gasketThickness) / 2, 10, seg),
      new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.95 })
    );
    gasket.rotation.x = Math.PI / 2;
    gasket.position.y = L.yFrameSeat + mm2m(p.frame.gasketThickness) / 2;
    gasket.userData.explodedGroup = 'front';
    staticParts.add(gasket);
  }

  // spider shelf: sits exactly at the spider plane, inner radius == spider
  // outer radius — the spider outer edge rests ON this face (no air gap).
  const rShelfOut = Math.max(L.rMagOD + mm2m(2), L.rSpOut + mm2m(6));
  const shelf = lathe([
    [L.rSpOut, L.yShelfTop],
    [rShelfOut, L.yShelfTop],
    [rShelfOut, L.yShelfTop - mm2m(3)],
    [L.rSpOut, L.yShelfTop - mm2m(3)],
  ], seg, frameMat);
  shelf.userData.explodedGroup = 'motor';
  staticParts.add(shelf);

  // basket legs: extruded CAST RIBS (not boxes) — wide at the flange, waisted
  // through the window, flared foot, rounded edges from the extrude bevel;
  // diecast ribs carry a lightening window like a real casting. Two bonded
  // segments per leg: flange→shelf, shelf→motor rim.
  const nLegs = 8;
  const diecast = (p.frame as { style?: string }).style === 'diecast';
  const legW = diecast ? mm2m(15) : mm2m(9);
  const yLegTop = L.yFrameSeat - flangeW;
  const rLegTop = L.rFrameOut - mm2m(4);
  const rShelfLand = rShelfOut - mm2m(2);
  const rFoot = L.rLegFoot - mm2m(1.5);

  /** Rib plate in the leg plane (local X = tangential width, local Y = along
   *  the strut) with concave cast waist, extruded across the radial thickness
   *  with rounded edges. Optional lightening window sized to the local width. */
  const ribPlate = (len: number, wTop: number, wBot: number, thk: number, window: boolean): THREE.BufferGeometry => {
    const xT = wTop / 2, xB = wBot / 2;
    const cX = xB * 0.35;                                   // waist control
    const s = new THREE.Shape();
    s.moveTo(-xT, len);
    s.lineTo(xT, len);
    s.quadraticCurveTo(cX, len * 0.52, xB, 0);
    s.lineTo(-xB, 0);
    s.quadraticCurveTo(-cX, len * 0.52, -xT, len);
    if (window) {
      // half-width of the side bezier at the window centre (y = 0.6·len)
      const t = 1 - 0.6;
      const xW = (1 - t) * (1 - t) * xT + 2 * (1 - t) * t * cX + t * t * xB;
      const rH = Math.min(xW * 0.42, len * 0.17);
      if (rH > mm2m(1.1)) {
        const h = new THREE.Path();
        h.absarc(0, len * 0.6, rH, 0, Math.PI * 2);
        s.holes.push(h);
      }
    }
    const g = new THREE.ExtrudeGeometry(s, {
      depth: thk, bevelEnabled: true,
      bevelThickness: Math.min(thk * 0.3, mm2m(1.4)),
      bevelSize: Math.min(thk * 0.3, mm2m(1.4)),
      bevelSegments: 2, curveSegments: 12,
    });
    g.translate(0, 0, -thk / 2);
    return g;
  };

  const addRib = (
    aR: number, aY: number, bR: number, bY: number, ang: number,
    wTop: number, wBot: number, thk: number, window: boolean,
  ): void => {
    const a = new THREE.Vector3(Math.cos(ang) * aR, aY, Math.sin(ang) * aR);
    const b = new THREE.Vector3(Math.cos(ang) * bR, bY, Math.sin(ang) * bR);
    const len = a.distanceTo(b);
    const leg = new THREE.Mesh(ribPlate(len, wTop, wBot, thk, window), frameMat);
    leg.position.copy(a).add(b).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    leg.userData.explodedGroup = 'frame';
    staticParts.add(leg);
  };
  for (let i = 0; i < nLegs; i++) {
    const ang = (i / nLegs) * Math.PI * 2;
    const thk = diecast ? mm2m(5.5) : mm2m(3.5);
    addRib(rLegTop, yLegTop, rShelfLand, L.yShelfTop - mm2m(0.5), ang, legW, legW * 0.82, thk, diecast);
    addRib(rShelfLand, L.yShelfTop - mm2m(2.5), rFoot, L.yLegFoot, ang, legW * 0.72, legW * 0.58, thk * 0.9, false);
    // foot pad — bonds the leg to the plate/boot rim (no floating ends)
    const pad = new THREE.Mesh(new THREE.BoxGeometry(legW * 0.9, mm2m(3), mm2m(7)), frameMat);
    pad.position.set(Math.cos(ang) * rFoot, L.yLegFoot + mm2m(0.8), Math.sin(ang) * rFoot);
    pad.rotation.y = -ang;
    pad.userData.explodedGroup = 'frame';
    staticParts.add(pad);
  }

  // terminals: race-style blocks on the ±X legs between shelf and motor rim,
  // each with two gold push posts; the tinsel lands here.
  const termMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.35, metalness: 0.85 });
  const yTerm = (L.yShelfTop + L.yLegFoot) / 2;
  const fTerm = Math.max(0, Math.min(1, (L.yShelfTop - mm2m(2.5) - yTerm) / Math.max(1e-6, L.yShelfTop - mm2m(2.5) - L.yLegFoot)));
  const rTerm = rShelfLand + (rFoot - rShelfLand) * fTerm + mm2m(3);
  const termPos: { x: number; y: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(mm2m(13), mm2m(11), mm2m(11)), frameMat);
    block.position.set(sx * rTerm, yTerm, 0);
    block.rotation.y = Math.PI / 2;
    block.userData.explodedGroup = 'frame';
    staticParts.add(block);
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(mm2m(1.7), mm2m(1.7), mm2m(9), 12), termMat);
      post.position.set(sx * rTerm, yTerm + mm2m(7), sz * mm2m(3));
      post.userData.explodedGroup = 'frame';
      staticParts.add(post);
      // colour-coded insulator collar at the post base (+ red / − black)
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(mm2m(2.9), mm2m(1.05), 10, 20),
        new THREE.MeshStandardMaterial({ color: sz > 0 ? '#a33028' : '#101113', roughness: 0.6, metalness: 0.05 }),
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.set(sx * rTerm, yTerm + mm2m(2.6), sz * mm2m(3));
      collar.userData.explodedGroup = 'frame';
      staticParts.add(collar);
      termPos.push({ x: sx * rTerm, y: yTerm + mm2m(11), z: sz * mm2m(3) });
    }
  }

  /* ---------- deformables (profiles from layout.ts) ---------- */
  const surrMatDef = mats(p.surround.materialId);
  // Rubber half-roll: physical material with a soft clearcoat so the crest
  // catches a believable sheen instead of rendering as flat black plastic.
  const surroundMat = new THREE.MeshPhysicalMaterial({
    color: (p.surround as { color?: string }).color ?? surrMatDef?.color ?? '#17181c',
    roughness: 0.78, metalness: 0.0,
    clearcoat: 0.42, clearcoatRoughness: 0.55,
    sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color('#3a3d45'),
    side: THREE.DoubleSide,
  });
  const surround = lathe(surroundProfile(L, mm2m(p.surround.rollHeight), p.surround.rollCount, 0), seg, surroundMat);
  surround.userData.explodedGroup = 'front';
  staticParts.add(surround);

  const spiderMat = new THREE.MeshStandardMaterial({
    color: (p.spider as { color?: string }).color ?? mats(p.spider.materialId)?.color ?? '#8a7a5c',
    roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });
  const spider = lathe(spiderProfile(L, p.spider.corrugations, mm2m(p.spider.corrDepth), 0), seg, spiderMat);
  spider.userData.explodedGroup = 'motor';
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
    new THREE.TorusGeometry(L.rSurfIn + mm2m(0.6), mm2m(0.35), 8, seg),
    new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.55 })
  );
  restRing.rotation.x = Math.PI / 2;
  restRing.position.y = L.ySeat;
  staticParts.add(restRing);

  /* ---------- per-frame deformation ---------- */
  const rollH = mm2m(p.surround.rollHeight);
  const rolls = Math.max(1, Math.round(p.surround.rollCount));
  const corrN = Math.max(0, Math.round(p.spider.corrugations));
  const corrD = mm2m(p.spider.corrDepth);

  /** Higher tones flex the diaphragm more (breakup is frequency-dependent). */
  const flexFFac = (fHz: number): number => Math.min(1.35, Math.max(0.4, 0.4 + fHz / 90));

  /* ---------- rock (tilt) field ----------
   * ONE angular lift field shared by every moving part, so the assembly
   * seesaws as a coherent body (see layout.rockLiftY):
   *   cone rim (rConeOut)  ↔ surround inner edge  — same radius, same lift
   *   former wall (rFormerOut) ↔ spider inner bond — same radius, same lift
   * The flexible surfaces decay the lift linearly across their span so the
   * outer bonds stay exactly seated while the front of the roll rocks. */
  const rimCap = rockRimCapM(Math.max(L.maxUp, L.maxDown), rollH);
  const rRef = L.rConeOut;

  /** Per-vertex r/θ snapshot of a mesh's rest geometry (for rigid tilt). */
  const flexCacheOf = (mesh: THREE.Mesh) => {
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = Float32Array.from(attr.array as Float32Array);
    const n = attr.count;
    const r = new Float32Array(n);
    const th = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      r[i] = Math.hypot(base[i * 3], base[i * 3 + 2]);
      th[i] = Math.atan2(base[i * 3 + 2], base[i * 3]);
    }
    return { mesh, attr, base, r, th, n };
  };
  const capCache = flexCacheOf(dustCap);
  const formerCache = flexCacheOf(former);
  const windCaches = windMeshes.map(flexCacheOf);
  const rockSolids = [capCache, formerCache, ...windCaches];
  let rockSolidActive = false;
  let coneFlexActive = false;

  interface RockState { lift: number; axis: number }

  /** Rock lift + axis for this frame (zero when idle). The axis precesses
   *  slowly and the amplitude carries a ~7 s beat, so first one side leads,
   *  then the other — never a static list. */
  const rockStateOf = (drive?: DriveState): RockState => {
    const tilt01 = drive ? Math.min(1.15, Math.max(0, drive.tilt01)) : 0;
    if (tilt01 <= 0.004 || !drive) return { lift: 0, axis: 0 };
    const lift = Math.pow(tilt01, 1.35) * rimCap * rockBeat(drive.t);
    return { lift, axis: drive.tiltAxis + 0.35 * Math.sin(drive.t * 0.11 + 0.8) };
  };

  /** Rigid tilt of the moving solids (dust cap, former, winding layers). */
  function rockSolidsApply(rs: RockState): void {
    if (rs.lift <= 1e-6) {
      if (rockSolidActive) {
        rockSolidActive = false;
        for (const c of rockSolids) {
          (c.attr.array as Float32Array).set(c.base);
          c.attr.needsUpdate = true;
          c.mesh.geometry.computeVertexNormals();
        }
      }
      return;
    }
    rockSolidActive = true;
    for (const c of rockSolids) {
      const arr = c.attr.array as Float32Array;
      for (let i = 0; i < c.n; i++) {
        arr[i * 3 + 1] = c.base[i * 3 + 1] + rockLiftY(c.r[i], c.th[i], rs.axis, rs.lift, rRef);
      }
      c.attr.needsUpdate = true;
      c.mesh.geometry.computeVertexNormals();
    }
  }

  /**
   * Cone flexible body, ONE writer for both modes so the array is always
   * rebuilt from the rest snapshot (no drift/accumulation):
   *  1. breakup waves — ring standing waves crawling slowly + faint sector
   *     lobes, gated by the `coneW` envelope (EXACTLY zero from the former
   *     bond through the shoulder and at the surround seat: bonds stay put);
   *  2. rock/tilt — the coherent rigid-body seesaw applied to EVERY vertex
   *     (bonds included — the whole moving assembly tilts together).
   * Amplitudes follow the PHYSICAL drive state, never the enhanced-viz
   * multiplier, so ×8 display stays honest about the flexible body.
   */
  function applyConeFlex(rs: RockState, drive?: DriveState): void {
    const wave01 = drive ? Math.min(1.15, Math.max(0, drive.amp01)) : 0;
    const waveOn = wave01 >= 0.004;
    if (!waveOn && rs.lift <= 1e-6) {
      if (coneFlexActive) {                    // decayed to rest: restore once
        coneFlexActive = false;
        const posAttr = cone.geometry.getAttribute('position') as THREE.BufferAttribute;
        (posAttr.array as Float32Array).set(coneBase);
        posAttr.needsUpdate = true;
        cone.geometry.computeVertexNormals();
      }
      return;
    }
    coneFlexActive = true;
    let amp = 0, k = 0, drift = 0, sector = 0;
    if (waveOn) {
      const fHz = Math.max(1, drive!.fHz);
      const depthM = Math.max(4e-3, L.ySeat - L.yConeInner);
      // cap scales with the driver: ~1.5 mm on an 8", ~5 mm on a 24"
      const ampCap = Math.min(5e-3, Math.max(1.5e-3, 0.016 * L.rConeOut));
      amp = wave01 * Math.min(0.10 * depthM, ampCap) * flexFFac(fHz);
      const span = Math.max(1e-3, L.rConeOut - L.rShoulder);
      k = (2 * Math.PI) / (span / 2.3);        // ~2.3 ring waves across the body
      drift = drive!.t * Math.PI * Math.min(2.2, Math.max(0.6, fHz / 25));
      sector = 0.45 * Math.min(1, wave01);     // subtle breakup lobes
    }
    const posAttr = cone.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < coneCount; i++) {
      let dy = rs.lift > 0 ? rockLiftY(coneR[i], coneTheta[i], rs.axis, rs.lift, rRef) : 0;
      if (waveOn) {
        const w = coneW[i];
        if (w !== 0) {
          const ring = Math.sin((coneR[i] - L.rShoulder) * k - drift);
          const lobes = sector * Math.cos(4 * coneTheta[i] + drive!.t * 1.3);
          dy += amp * w * (ring + lobes);
        }
      }
      arr[i * 3 + 1] = coneBase[i * 3 + 1] + dy;
    }
    posAttr.needsUpdate = true;
    cone.geometry.computeVertexNormals();
  }

  /**
   * Surround surface behaviour on top of the exact roll kinematics:
   *  1. the ROCK — the inner edge rides the cone rim lift exactly (same
   *     radius, same field) and decays linearly to zero at the frame seat,
   *     so the roll visibly seesaws with the cone and the outer bond stays
   *     glued;
   *  2. high-excursion buckling — past ~55 % of the roll capability the
   *     rubber creases into radial wrinkles that deepen toward the limit;
   *  3. travelling waves while music plays — gentle ripples rolling outward
   *     across the roll, scaled by the live drive intensity.
   * The wrinkle/wave envelopes live only between the bonded tabs (zero on
   * the 6 % inner / 10 % outer landings); the rock envelope is exact at the
   * inner tab and zero at the outer landing.
   */
  function flexSurround(x: number, rs: RockState, drive?: DriveState): void {
    const wrAmp = surroundWrinkleAmp(x, L.surroundLimit, rollH);
    const wave01 = drive ? Math.min(1.15, Math.max(0, drive.amp01)) : 0;
    const waveAmp = drive ? wave01 * rollH * 0.055 * flexFFac(Math.max(1, drive.fHz)) : 0;
    if (wrAmp <= 1e-6 && waveAmp <= 1e-6 && rs.lift <= 1e-6) return;
    const posAttr = surround.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const span = L.rSurfOut - L.rSurfIn;
    const m = surroundWrinkleCount((L.rSurfOut + L.rSurfIn) / 2, rollH);
    const tSec = drive ? drive.t : 0;
    const wSpeed = 2 * Math.PI * Math.min(2.5, Math.max(0.5, (drive ? drive.fHz : 20) / 30));
    for (let i = 0; i < posAttr.count; i++) {
      const px = arr[i * 3], py = arr[i * 3 + 1], pz = arr[i * 3 + 2];
      const r = Math.hypot(px, pz);
      const t = (r - L.rSurfIn) / span;
      // rock: full rim lift at the inner bond → zero at the frame seat
      let dy = rs.lift > 0 ? rockLiftY(r, Math.atan2(pz, px), rs.axis, rs.lift, rRef) * (1 - t) : 0;
      const u = Math.min(1, Math.max(0, (t - 0.06) / 0.82));
      let env = Math.sin(Math.PI * u);
      env *= env;
      if (env > 1e-4) {                          // bonded tabs: no wrinkle/wave
        const th = Math.atan2(pz, px);
        if (wrAmp > 0) {
          // radial creases: sharp valleys, rounded crests (|sin|^1.4 shaping)
          dy += wrAmp * env * (Math.pow(Math.abs(Math.sin(m * th / 2)), 1.4) * 2 - 0.9);
        }
        if (waveAmp > 0) {
          // waves travel from the cone edge toward the frame while playing
          dy += waveAmp * env * Math.sin(t * Math.PI * 4 - tSec * wSpeed);
        }
      }
      arr[i * 3 + 1] = py + dy;
      if (wrAmp > 0) {
        // slight radial buckle: crests push outward, valleys pull inward
        const th2 = Math.atan2(pz, px);
        const dr = wrAmp * 0.3 * env * Math.cos(m * th2 + 0.7);
        const rn = Math.max(1e-4, r + dr);
        arr[i * 3] *= rn / r;
        arr[i * 3 + 2] *= rn / r;
      }
    }
    posAttr.needsUpdate = true;
    surround.geometry.computeVertexNormals();
  }

  /** Spider rock: the inner bond rides the former wall lift exactly (same
   *  radius, same field) and decays to zero at the basket shelf. */
  function rockSpider(rs: RockState): void {
    if (rs.lift <= 1e-6) return;
    const posAttr = spider.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const span = L.rSpOut - L.rSpIn;
    for (let i = 0; i < posAttr.count; i++) {
      const px = arr[i * 3], pz = arr[i * 3 + 2];
      const r = Math.hypot(px, pz);
      const t = Math.min(1, Math.max(0, (r - L.rSpIn) / span));
      arr[i * 3 + 1] += rockLiftY(r, Math.atan2(pz, px), rs.axis, rs.lift, rRef) * (1 - t);
    }
    posAttr.needsUpdate = true;
    spider.geometry.computeVertexNormals();
  }

  function deform(x: number, drive?: DriveState): void {
    const rs = rockStateOf(drive);
    // surround: inner edge rides exactly on the cone edge, outer lands on the
    // frame seat (see surroundProfile — endpoints exact at every x); the
    // flexible-surface passes below never detach the bonded tabs.
    surround.geometry.dispose();
    surround.geometry = new THREE.LatheGeometry(
      surroundProfile(L, rollH, rolls, x).map(([r, y]) => new THREE.Vector2(r, y)), seg);
    flexSurround(x, rs, drive);

    // spider: inner edge bonded to the former (rides), outer seated on shelf
    spider.geometry.dispose();
    spider.geometry = new THREE.LatheGeometry(
      spiderProfile(L, corrN, corrD, x).map(([r, y]) => new THREE.Vector2(r, y)), seg);
    rockSpider(rs);

    applyConeFlex(rs, drive);
    rockSolidsApply(rs);

    // tinsel leads: bonded to the FORMER just above the spider bond, routed
    // through the basket to the actual terminal posts. The bond point rides
    // the rock field too (same radius → same lift as the former wall).
    const rAttach = L.rFormerOut + mm2m(0.4);
    const yAttach = L.ySpider + mm2m(1.2) + x;
    for (let i = 0; i < leadMeshes.length; i++) {
      // spread the lead roots around the former; land on the nearest post
      const frac = leadMeshes.length === 1 ? 0.5 : i / (leadMeshes.length - 1);
      const ang = Math.PI * (0.15 + 0.7 * frac);           // 27°..153° around +Z side
      const side = i < leadMeshes.length / 2 ? 1 : -1;      // left/right terminal
      const ax = Math.cos(ang) * rAttach, az = Math.sin(ang) * rAttach;
      const post = termPos[i % termPos.length];
      const tx = side * Math.abs(post.x), tz = Math.abs(post.z);
      const yRock = rs.lift > 0 ? rockLiftY(rAttach, ang, rs.axis, rs.lift, rRef) : 0;
      const midX = (ax + tx) / 2, midZ = (az + tz) / 2;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(ax, yAttach + yRock, az),
        new THREE.Vector3(midX, (yAttach + yRock + post.y) / 2 - mm2m(3), midZ),
        new THREE.Vector3(tx, post.y, tz)
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
    limits: { up: L.maxUp, down: L.maxDown },
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
