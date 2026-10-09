/*
 * 3D viewport manager: renderer, camera, orbit controls, lighting,
 * view presets, exploded view, section clipping, quality tiers and the
 * render loop that pulls physical displacement from the engine.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildDriver, buildEnclosure, type DriverGeometry, type EnclosureGeometry } from './geometry';
import type { DriverParams, EnclosureParams, MaterialDef } from '../physics/types';

export type ViewName = 'persp' | 'front' | 'side' | 'rear';
export type Quality = 'low' | 'med' | 'high';

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
  private frameTimes: number[] = [];
  fps = 0;

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
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.005, 40);
    this.camera.position.set(0.42, 0.5, 0.55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 8;

    // lighting — studio style
    const key = new THREE.DirectionalLight(0xfff1e0, 2.6);
    key.position.set(1.4, 2.2, 1.2);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.7);
    fill.position.set(-1.6, 0.6, -1.2);
    const rim = new THREE.DirectionalLight(0xff7a1a, 0.9);
    rim.position.set(0.4, -1.4, -1.6);
    const amb = new THREE.AmbientLight(0x404448, 1.1);
    const hemi = new THREE.HemisphereLight(0x50565e, 0x0c0d10, 0.9);
    this.scene.add(key, fill, rim, amb, hemi);

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
    this.frameView();
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

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.running) return;
    const t0 = performance.now();
    const x = this.getDisp() * this.vizScale;
    this.lastDisp = x;

    if (this.driver) {
      this.driver.moving.position.y = x;
      this.driver.deform(x);
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
