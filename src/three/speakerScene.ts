/*
 * 3D viewport manager: renderer, camera, orbit controls, lighting,
 * view presets, exploded view, section clipping, quality tiers and the
 * render loop that pulls physical displacement from the engine.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDriver, buildEnclosure, type DriverGeometry, type EnclosureGeometry, type DriveState } from './geometry';
import type { DriverParams, EnclosureParams, MaterialDef } from '../physics/types';

export type ViewName = 'persp' | 'front' | 'side' | 'rear' | 'recenter';
export type Quality = 'low' | 'med' | 'high';

/** Soft radial-gradient blob used as a fake contact shadow under the driver. */
function contactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export interface SceneOptions {
  getDisplacement: () => number;   // meters (already includes viz handling outside)
  showRestRing: boolean;
}

export class SpeakerScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private container: HTMLElement;
  private driver: DriverGeometry | null = null;
  private enclosure: EnclosureGeometry | null = null;
  private params: DriverParams | null = null;
  private mats: (id: string) => MaterialDef | undefined;
  private quality: Quality = 'med';
  private raf = 0;
  private exploded = 0;
  private sectionAngle: number | null = null;
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private getDisp: () => number;
  private lastDisp = 0;
  private showEnclosure = false;
  private showRestRing = true;
  private running = true;
  private vizScale = 1;
  private vizSmooth = 0;
  private frameTimes: number[] = [];
  private contactShadow: THREE.Mesh;
  private studioFloor: THREE.Mesh;
  fps = 0;

  /* --- flexible-body drive estimator (cone breakup / surround waves / rock) --- */
  private lastFrameT = 0;
  private lastPhysX = 0;
  private envV = 0;               // |velocity| envelope (m/s)
  private envX = 0;               // |displacement| envelope (m)
  private wave01 = 0;             // normalised flex intensity 0..1.15
  private fEst = 24;              // estimated dominant frequency (Hz)
  private xHistT: number[] = [];  // zero-crossing ring (time, s)
  private xHistX: number[] = [];
  private tilt01 = 0;             // rocking-mode intensity 0..1
  private tiltAxis = 0;           // precessing tilt axis (rad)
  private flexGain = 1;           // user gain on flex/rock intensity

  constructor(container: HTMLElement, mats: (id: string) => MaterialDef | undefined, opts: SceneOptions) {
    this.container = container;
    this.mats = mats;
    this.getDisp = opts.getDisplacement;
    this.showRestRing = opts.showRestRing;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = false;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);
    // Film-grade response: ACES gives metals and rubber real depth instead of
    // the flat, blown-out look of raw sRGB output.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Studio environment map — WITHOUT this, every metalness>0 material
    // (diecast basket, plates, terminals) reflects nothing and renders as a
    // dead black silhouette. This is the single biggest visual upgrade.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    envScene.dispose?.();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.005, 40);
    this.camera.position.set(0.42, 0.5, 0.55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 8;

    // lighting — studio style. With the environment map carrying reflections,
    // the direct lights shape form: warm key high above, cool fill, two rims
    // (brand-orange below, white behind) so near-black rubber still separates
    // from the backdrop, and a soft top light that sculpts the roll crest.
    const key = new THREE.DirectionalLight(0xfff1e0, 1.7);
    key.position.set(1.3, 2.6, 1.1);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
    fill.position.set(-1.6, 0.7, -1.2);
    const rim = new THREE.DirectionalLight(0xff8a3a, 0.4);
    rim.position.set(0.4, -1.4, -1.6);
    const back = new THREE.DirectionalLight(0xe8ecff, 0.5);
    back.position.set(-0.7, 0.35, -1.9);
    const top = new THREE.DirectionalLight(0xffffff, 0.3);
    top.position.set(0.1, 2.4, -0.4);
    const amb = new THREE.AmbientLight(0x404448, 0.32);
    const hemi = new THREE.HemisphereLight(0x585f6a, 0x0c0d10, 0.4);
    this.scene.add(key, fill, rim, back, top, amb, hemi);

    // soft contact shadow — grounds the driver so it doesn't float in the void
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true, opacity: 0.55, depthWrite: false,
      }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.renderOrder = -1;
    this.scene.add(this.contactShadow);

    // studio floor — a huge softly-fading disc with faint machinist rings so
    // the driver reads as standing in a photo studio, not in a void
    const floorTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(256, 256, 24, 256, 256, 256);
      g.addColorStop(0, '#272b34');
      g.addColorStop(0.42, '#16181e');
      g.addColorStop(1, '#0b0c0f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
      ctx.strokeStyle = 'rgba(120,130,150,0.10)';
      for (const rr of [86, 128, 176]) {
        ctx.beginPath();
        ctx.arc(256, 256, rr, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,130,150,0.05)';
      for (const rr of [46, 220, 248]) {
        ctx.beginPath();
        ctx.arc(256, 256, rr, 0, Math.PI * 2);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      return new THREE.CanvasTexture(c);
    })();
    // author the canvas in sRGB — without this the dark gradient renders
    // gamma-lifted and washes the whole viewport grey
    floorTex.colorSpace = THREE.SRGBColorSpace;
    this.studioFloor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 56),
      new THREE.MeshBasicMaterial({ map: floorTex, depthWrite: false }),
    );
    this.studioFloor.rotation.x = -Math.PI / 2;
    this.studioFloor.renderOrder = -2;
    this.scene.add(this.studioFloor);

    this.resize();
    this.loop();
    window.addEventListener('resize', this.resize);
  }

  setDriver(p: DriverParams): void {
    const rebuild = !this.driver || JSON.stringify(this.params) !== JSON.stringify(p);
    if (!rebuild) return;
    this.params = JSON.parse(JSON.stringify(p));
    if (this.driver) { this.scene.remove(this.driver.group); this.driver.dispose(); }
    this.driver = buildDriver(p, this.mats, this.quality);
    this.applyClipping(this.driver.group);
    this.scene.add(this.driver.group);
    this.placeContactShadow();
    this.frameView();
  }

  /** Scale/position the fake soft shadow from the driver's footprint + depth. */
  private placeContactShadow(): void {
    if (!this.contactShadow) return;
    const d = this.params;
    const r = d ? Math.max(d.surround.outerDiameter, d.magnet.diameter) / 2000 : 0.13;
    const h = this.driverHeight();
    this.contactShadow.scale.set(r * 4.6, r * 4.6, 1);
    this.contactShadow.position.y = -h - r * 0.06;
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = 0.5;
    if (this.studioFloor) this.studioFloor.position.y = -h - r * 0.062;
  }

  setEnclosure(enc: EnclosureParams | null, driver: DriverParams): void {
    if (this.enclosure) { this.scene.remove(this.enclosure.group); this.enclosure.dispose(); this.enclosure = null; }
    this.showEnclosure = enc != null;
    if (enc) {
      this.enclosure = buildEnclosure(enc, driver, this.quality);
      this.applyClipping(this.enclosure.group);
      this.scene.add(this.enclosure.group);
    }
  }

  setWallOpacity(o: number): void {
    this.enclosure?.setWallOpacity(o);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.75));
    if (this.params) { const p = this.params; this.params = null; this.setDriver(p); }
  }

  setView(v: ViewName): void {
    if (v === 'recenter') { this.frameView(); return; }
    const d = this.fitDistance() * 1.25;
    const target = new THREE.Vector3(0, -this.driverHeight() * 0.35, 0);
    if (v === 'front') this.camera.position.set(0.001, d + target.y, 0.001);
    else if (v === 'side') this.camera.position.set(d, target.y + d * 0.05, 0.001);
    else if (v === 'rear') this.camera.position.set(0.001, -d * 0.9, 0.001);
    else this.camera.position.set(d * 0.62, d * 0.7, d * 0.68);
    this.controls.target.copy(target);
    this.controls.update();
  }

  setExploded(t: number): void {
    this.exploded = Math.max(0, Math.min(1, t));
  }

  setSection(angleDeg: number | null): void {
    this.sectionAngle = angleDeg;
    if (this.driver) this.applyClipping(this.driver.group);
    if (this.enclosure) this.applyClipping(this.enclosure.group);
  }

  setVizScale(s: number): void { this.vizScale = s; }
  setSmoothing(a: number): void { this.vizSmooth = Math.max(0, Math.min(0.95, a)); }
  setFlexGain(g: number): void { this.flexGain = Math.max(0, Math.min(2, g)); }
  setShowRestRing(v: boolean): void { this.showRestRing = v; if (this.driver) this.driver.restRing.visible = v; }
  setRunning(v: boolean): void { this.running = v; }

  private applyClipping(root: THREE.Object3D): void {
    const planes = this.sectionAngle == null ? [] : [this.clipPlane];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        m.clippingPlanes = planes;
        m.clipShadows = true;
        m.side = THREE.DoubleSide;
      }
    });
    if (this.sectionAngle != null) {
      const a = (this.sectionAngle * Math.PI) / 180;
      this.clipPlane.normal.set(Math.sin(a), 0, -Math.cos(a));
      this.clipPlane.constant = 0.0005;
    }
  }

  private driverHeight(): number {
    const d = this.params;
    if (!d) return 0.15;
    return (d.frame.depth + d.magnet.thickness + d.magnet.backPlateThickness) / 1000;
  }

  private fitDistance(): number {
    const d = this.params;
    const size = d ? Math.max(d.magnet.diameter, d.surround.outerDiameter) / 1000 : 0.25;
    return Math.max(0.12, size);
  }

  frameView(): void {
    const d = this.fitDistance() * 1.9;
    this.controls.target.set(0, -this.driverHeight() * 0.35, 0);
    this.camera.position.set(d * 0.55, d * 0.55, d * 0.62);
    this.controls.update();
  }

  resize = (): void => {
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Estimate the flexible-body drive state from the PHYSICAL displacement
   * signal itself (never the enhanced-viz multiplier): envelope-followed
   * velocity + excursion give the intensity, zero-crossings over a sliding
   * window give the dominant frequency. The rocking (tilt) mode grows with
   * deep excursion — suspension asymmetry shows up when the coil leaves the
   * gap — and its axis precesses slowly so one side of the cone leads the
   * stroke, then the other. Everything decays to rest smoothly when the
   * audio stops, so a parked cone never ripples or tilts.
   */
  private estimateDrive(xPhys: number, limits: { up: number; down: number } | null, dt: number): DriveState {
    const t = performance.now() / 1000;
    // velocity envelope (attack fast, release slower)
    const v = dt > 1e-4 ? (xPhys - this.lastPhysX) / dt : 0;
    this.lastPhysX = xPhys;
    const av = Math.abs(v);
    this.envV += (av - this.envV) * (av > this.envV ? 0.3 : Math.min(1, dt * 7));
    // displacement envelope
    const ax = Math.abs(xPhys);
    this.envX += (ax - this.envX) * (ax > this.envX ? 0.25 : Math.min(1, dt * 4));
    // dominant frequency via zero crossings (0.6 s sliding window)
    this.xHistT.push(t); this.xHistX.push(xPhys);
    while (this.xHistT.length > 2 && t - this.xHistT[0] > 0.6) { this.xHistT.shift(); this.xHistX.shift(); }
    let crossings = 0;
    for (let i = 1; i < this.xHistX.length; i++) {
      if ((this.xHistX[i - 1] <= 0 && this.xHistX[i] > 0) || (this.xHistX[i - 1] >= 0 && this.xHistX[i] < 0)) crossings++;
    }
    const span = this.xHistT.length > 1 ? t - this.xHistT[0] : 0;
    if (span > 0.12 && crossings >= 2) {
      const fRaw = crossings / (2 * span);
      this.fEst += (fRaw - this.fEst) * Math.min(1, dt * 2.5);
    }
    // intensity: mix of excursion usage and cone velocity; requires real
    // motion (≥ 0.15 m/s) so a parked cone stays perfectly still
    const xlim = limits ? Math.max(2e-3, (limits.up + limits.down) / 2) : 0.02;
    const iExc = Math.min(1.1, this.envX / xlim);
    const iV = Math.min(1.1, this.envV / 2.2);
    const motionGate = Math.min(1, this.envV / 0.15);
    const target = motionGate * Math.min(1.15, 0.5 * iExc + 0.55 * iV);
    this.wave01 += (target - this.wave01) * (target > this.wave01 ? 0.25 : Math.min(1, dt * 3));
    // rocking mode: needs DEEP excursion (past ~35 % of the travel) — that is
    // when real suspensions start rocking. Attack quick, release slow.
    const tiltTarget = motionGate * Math.pow(Math.max(0, Math.min(1, 1.35 * iExc - 0.35)), 1.5);
    this.tilt01 += (tiltTarget - this.tilt01) * (tiltTarget > this.tilt01 ? Math.min(1, dt * 5) : Math.min(1, dt * 0.9));
    if (this.tilt01 > 0.02) {
      // precess the tilt axis — which side leads keeps drifting
      this.tiltAxis += dt * (0.35 + 0.5 * Math.min(1, this.fEst / 45));
    }
    return {
      amp01: Math.min(1.15, this.wave01 * this.flexGain),
      fHz: this.fEst,
      t,
      tilt01: Math.min(1.15, this.tilt01 * this.flexGain),
      tiltAxis: this.tiltAxis,
    };
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.running) return;
    const t0 = performance.now();
    const nowT = t0 / 1000;
    const dtFrame = this.lastFrameT > 0 ? Math.min(0.1, Math.max(1e-3, nowT - this.lastFrameT)) : 1 / 60;
    this.lastFrameT = nowT;
    let xRaw = this.getDisp() * this.vizScale;
    // Visual excursion is clamped to the ASSEMBLY's geometric envelope so no
    // view mode (including enhanced multiplier) can push the cone through the
    // basket, magnet or plates. The numeric readouts elsewhere stay unclamped.
    if (this.driver) {
      xRaw = Math.min(this.driver.limits.up, Math.max(-this.driver.limits.down, xRaw));
    }
    // display-only EMA smoothing (measured values elsewhere stay unfiltered)
    const x = this.vizSmooth > 0
      ? this.lastDisp + (xRaw - this.lastDisp) * (1 - this.vizSmooth)
      : xRaw;
    this.lastDisp = x;

    if (this.driver) {
      this.driver.moving.position.y = x;
      // flexible-body state comes from the PHYSICAL signal (no viz scale)
      const xPhys = Math.min(this.driver.limits.up, Math.max(-this.driver.limits.down, this.getDisp()));
      const drive = this.estimateDrive(xPhys, this.driver.limits, dtFrame);
      this.driver.deform(x, drive);
      this.driver.restRing.visible = this.showRestRing;
      // exploded offsets
      const k = this.exploded * 0.22;
      this.driver.staticParts.children.forEach((c) => {
        if (c.userData.baseY === undefined) c.userData.baseY = c.position.y;
        if (c.userData.explodedGroup === 'motor') c.position.y = c.userData.baseY - k * 2;
        else if (c.userData.explodedGroup === 'frame') c.position.y = c.userData.baseY - k * 0.6;
        else if (c.userData.explodedGroup === 'front') c.position.y = c.userData.baseY + k * 0.8;
      });
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const dt = performance.now() - t0;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    this.fps = 1000 / Math.max(0.1, this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.driver?.dispose();
    this.enclosure?.dispose();
    this.contactShadow?.geometry.dispose();
    (this.contactShadow?.material as THREE.Material | undefined)?.dispose();
    this.studioFloor?.geometry.dispose();
    (this.studioFloor?.material as THREE.Material | undefined)?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
