/* Parts Editor — cone, surround, spider, voice coil, magnet, frame detail editing. */
import React, { useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Param, Sel, Badge, Readout, Toggle } from '../components/ui';
import { Viewport3D } from '../components/Viewport3D';
import { MATERIALS } from '../physics/materials';
import { fmtSI, mm2m, g2kg } from '../physics/units';
import type { MaterialDef } from '../physics/types';

type Part = 'cone' | 'surround' | 'spider' | 'coil' | 'magnet' | 'frame';

export function PartsEditor() {
  const driver = useApp((s) => s.driver);
  const ts = useApp((s) => s.derived.ts);
  const derived = useApp((s) => s.derived);
  const patch = {
    cone: useApp((s) => s.patchCone),
    surround: useApp((s) => s.patchSurround),
    spider: useApp((s) => s.patchSpider),
    coil: useApp((s) => s.patchCoil),
    magnet: useApp((s) => s.patchMagnet),
    frame: useApp((s) => s.patchFrame),
  };
  const [part, setPart] = useState<Part>('coil');
  const [exploded, setExploded] = useState(0.35);
  const [section, setSection] = useState<number>(40);
  const [quality, setQuality] = useState<'low' | 'med' | 'high'>('high');

  const customMats = useApp((s) => s.customMaterials);
  const allMats: MaterialDef[] = [...MATERIALS, ...customMats];
  const matOpts = (cats: MaterialDef['category'][]) =>
    allMats.filter((m) => cats.includes(m.category)).map((m) => ({ value: m.id, label: `${m.name}${m.illustrative ? ' (typ.)' : ''}` }));
  const badgeOf = (id: string): 'est' | 'user' | 'ok' => {
    const m = allMats.find((x) => x.id === id);
    return m?.illustrative ? 'est' : 'ok';
  };

  const w = derived.winding;
  const mag = derived.magnet;

  return (
    <div className="ws no-scroll" style={{ height: '100%' }}>
      <div className="split" style={{ flex: 1 }}>
        <div className="side">
          <Section title="Component">
            <div className="tabs">
              {(['cone', 'surround', 'spider', 'coil', 'magnet', 'frame'] as Part[]).map((p) => (
                <button key={p} className={part === p ? 'active' : ''} onClick={() => setPart(p)}>{p.toUpperCase()}</button>
              ))}
            </div>
          </Section>

          {part === 'cone' ? (
            <Section title="Cone Diaphragm">
              <Param label="Outer Ø" value={driver.cone.outerDiameter} min={20} max={600} unit="mm" onChange={(v) => patch.cone({ outerDiameter: v })} />
              <div className="note mono" style={{ margin: '2px 0 6px' }}>Effective radiating Ø (auto): {driver.cone.effectiveDiameter.toFixed(1)} mm = cone {driver.cone.outerDiameter.toFixed(1)} + ½×{driver.surround.rollWidth.toFixed(1)} roll — drives Sd</div>
              <Param label="Depth" value={driver.cone.depth} min={2} max={120} unit="mm" onChange={(v) => patch.cone({ depth: v })} />
              <Param label="Side angle (derived)" value={driver.cone.angleDeg} min={5} max={89} unit="°" badge="est" onChange={(v) => patch.cone({ depth: Math.max(2, (driver.cone.outerDiameter / 2 - 25) / Math.tan((v * Math.PI) / 180)) })} />
              <Param label="Thickness" value={driver.cone.thickness} min={0.1} max={5} step={0.05} digits={2} unit="mm" onChange={(v) => patch.cone({ thickness: v })} />
              <Sel label="Material" value={driver.cone.materialId} options={matOpts(['cone', 'custom'])} onChange={(v) => patch.cone({ materialId: v })} />
              <Sel label="Profile" value={driver.cone.profile} options={[{ value: 'straight', label: 'Straight' }, { value: 'curved', label: 'Curved' }, { value: 'ribbed', label: 'Ribbed' }]} onChange={(v) => patch.cone({ profile: v as typeof driver.cone.profile })} />
              <Param label="Cone mass" value={driver.cone.mass ?? autoConeMass(driver.cone.outerDiameter, driver.cone.depth, driver.cone.thickness)} min={0.5} max={500} step={0.5} digits={1} unit="g"
                badge={driver.cone.mass != null ? 'user' : 'est'}
                onChange={(v) => patch.cone({ mass: v })} />
              {driver.cone.mass != null ? <Btn small ghost onClick={() => patch.cone({ mass: null })}>Auto mass from geometry</Btn> : null}
              <Section title="Dust Cap">
                <Param label="Diameter" value={driver.cone.dustCapDiameter} min={5} max={250} unit="mm" onChange={(v) => patch.cone({ dustCapDiameter: v })} />
                <Sel label="Shape" value={driver.cone.dustCapShape} options={[{ value: 'dome', label: 'Dome' }, { value: 'flat', label: 'Flat' }, { value: 'inverted', label: 'Inverted' }]} onChange={(v) => patch.cone({ dustCapShape: v as typeof driver.cone.dustCapShape })} />
                <Sel label="Material" value={driver.cone.dustCapMaterialId} options={matOpts(['cone', 'custom'])} onChange={(v) => patch.cone({ dustCapMaterialId: v })} />
              </Section>
              <Section title="Appearance">
                <div className="param"><label>Color</label>
                  <input type="color" value={driver.cone.color} onChange={(e) => patch.cone({ color: e.target.value })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
                </div>
                <Sel label="Finish" value={driver.cone.finish} options={[{ value: 'matte', label: 'Matte' }, { value: 'satin', label: 'Satin' }, { value: 'gloss', label: 'Gloss' }]} onChange={(v) => patch.cone({ finish: v as typeof driver.cone.finish })} />
              </Section>
            </Section>
          ) : null}

          {part === 'surround' ? (
            <Section title="Surround">
              <Param label="Inner Ø" value={driver.surround.innerDiameter} min={20} max={600} unit="mm" onChange={(v) => patch.surround({ innerDiameter: v })} />
              <Param label="Outer Ø" value={driver.surround.outerDiameter} min={30} max={650} unit="mm" onChange={(v) => patch.surround({ outerDiameter: v })} />
              <Param label="Roll count" value={driver.surround.rollCount} min={1} max={3} step={1} digits={0} unit="rolls" onChange={(v) => patch.surround({ rollCount: Math.round(v) })} />
              <Param label="Roll height" value={driver.surround.rollHeight} min={2} max={40} unit="mm" hint="Taller roll = more excursion capability" onChange={(v) => patch.surround({ rollHeight: v })} />
              <Param label="Roll width" value={driver.surround.rollWidth} min={3} max={60} unit="mm" onChange={(v) => patch.surround({ rollWidth: v })} />
              <Sel label="Material" value={driver.surround.materialId} options={matOpts(['surround', 'custom'])} onChange={(v) => patch.surround({ materialId: v })} />
              <Param label="Thickness" value={driver.surround.thickness} min={0.1} max={5} step={0.05} digits={2} unit="mm" onChange={(v) => patch.surround({ thickness: v })} />
              <Param label="Axial stiffness" value={driver.surround.stiffness} min={20} max={4000} step={5} digits={0} unit="N/m" badge="user" onChange={(v) => patch.surround({ stiffness: v })} />
              <Param label="Damping" value={driver.surround.damping} min={0} max={5} step={0.05} digits={2} unit="N·s/m" onChange={(v) => patch.surround({ damping: v })} />
              <div className="param"><label>Color</label>
                <input type="color" value={driver.surround.color} onChange={(e) => patch.surround({ color: e.target.value })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
              </div>
              <p className="note">Kms = K_spider + K_surround = {fmtSI(ts.Kms, 'N/m', 2)}. The roll visibly flattens/unrolls with excursion in 3D.</p>
            </Section>
          ) : null}

          {part === 'spider' ? (
            <Section title="Spider (suspension)">
              <Param label="Inner Ø" value={driver.spider.innerDiameter} min={10} max={200} unit="mm" onChange={(v) => patch.spider({ innerDiameter: v })} />
              <Param label="Outer Ø" value={driver.spider.outerDiameter} min={30} max={400} unit="mm" onChange={(v) => patch.spider({ outerDiameter: v })} />
              <Param label="Corrugations" value={driver.spider.corrugations} min={3} max={20} step={1} digits={0} onChange={(v) => patch.spider({ corrugations: Math.round(v) })} />
              <Param label="Corrugation depth" value={driver.spider.corrDepth} min={0.5} max={15} step={0.1} digits={1} unit="mm" onChange={(v) => patch.spider({ corrDepth: v })} />
              <Sel label="Material" value={driver.spider.materialId} options={matOpts(['spider', 'custom'])} onChange={(v) => patch.spider({ materialId: v })} />
              <Param label="Thickness" value={driver.spider.thickness} min={0.05} max={2} step={0.01} digits={2} unit="mm" onChange={(v) => patch.spider({ thickness: v })} />
              <Param label="Stiffness" value={driver.spider.stiffness} min={50} max={8000} step={10} digits={0} unit="N/m" badge="user" onChange={(v) => patch.spider({ stiffness: v })} />
              <Param label="Damping" value={driver.spider.damping} min={0} max={6} step={0.05} digits={2} unit="N·s/m" onChange={(v) => patch.spider({ damping: v })} />
              <div className="param"><label>Color</label>
                <input type="color" value={driver.spider.color} onChange={(e) => patch.spider({ color: e.target.value })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
              </div>
              <p className="note">Inner Ø auto-tracks the former outer wall, outer Ø is limited by the top plate — the spider always bonds correctly.</p>
            </Section>
          ) : null}

          {part === 'coil' ? (
            <Section title="Voice Coil">
              <Param label="Winding Ø (mean)" value={driver.coil.windingDiameter} min={8} max={200} unit="mm" onChange={(v) => patch.coil({ windingDiameter: v })} />
              <Param label="Former Ø (inner)" value={driver.coil.formerDiameter} min={8} max={190} unit="mm" onChange={(v) => patch.coil({ formerDiameter: v })} />
              <Param label="Former height" value={driver.coil.formerHeight} min={5} max={120} unit="mm" onChange={(v) => patch.coil({ formerHeight: v })} />
              <Param label="Former thickness" value={driver.coil.formerThickness} min={0.05} max={2} step={0.01} digits={2} unit="mm" onChange={(v) => patch.coil({ formerThickness: v })} />
              <Sel label="Former material" value={driver.coil.formerMaterialId} options={matOpts(['former', 'custom'])} onChange={(v) => patch.coil({ formerMaterialId: v })} />
              <Param label="Wire Ø (bare)" value={driver.coil.wireDiameter} min={0.08} max={1.5} step={0.01} digits={2} unit="mm" onChange={(v) => patch.coil({ wireDiameter: v })} />
              <Sel label="Wire material" value={driver.coil.wireMaterialId} options={matOpts(['wire', 'custom'])} onChange={(v) => patch.coil({ wireMaterialId: v })} />
              <Param label="Layers" value={driver.coil.layers} min={1} max={4} step={1} digits={0} onChange={(v) => patch.coil({ layers: Math.round(v) })} />
              <Param label="Turns per layer" value={driver.coil.turnsPerLayer} min={5} max={120} step={1} digits={0} onChange={(v) => patch.coil({ turnsPerLayer: Math.round(v) })} />
              <Param label="Winding height" value={w.windingHeight * 1000} min={1} max={100} step={0.1} digits={2} unit="mm" badge="est" onChange={(v) => patch.coil({ turnsPerLayer: Math.max(1, Math.round(v / (w.pitch * 1000))) })} hint="Editing this adjusts turns per layer (pitch = wire Ø × 1.08)" />
              <Param label="Coil temperature" value={driver.coil.temperatureC} min={20} max={200} step={1} digits={0} unit="°C" onChange={(v) => patch.coil({ temperatureC: v })} />
              <Sel label="Config" value={driver.coil.config} options={[{ value: 'overhung', label: 'Overhung' }, { value: 'underhung', label: 'Underhung' }]} onChange={(v) => patch.coil({ config: v as typeof driver.coil.config })} />
              <Param label="Coil position" value={driver.coil.position} min={-10} max={10} step={0.1} digits={1} unit="mm" onChange={(v) => patch.coil({ position: v })} hint="+ = winding shifted toward the front (out of the gap)" />
              <div className="row" style={{ marginTop: 6 }}>
                <Badge kind="est">wire {w.wireLength.toFixed(2)} m</Badge>
                <Badge kind="est">Re20 {w.Re20.toFixed(2)} Ω</Badge>
                <Badge kind={driver.coil.re != null ? 'user' : 'est'}>Re @{driver.coil.temperatureC}°C {ts.Re.toFixed(2)} Ω</Badge>
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <Badge kind="est">coil mass {fmtSI(w.coilMass * 1000, 'g', 1)}</Badge>
                <Badge kind="est">j {(w.currentDensityAt1W).toFixed(2)} A/mm² @1W</Badge>
              </div>
              {driver.coil.re != null ? <Btn small ghost onClick={() => patch.coil({ re: null })}>Re: use calculated ({w.Re.toFixed(2)} Ω)</Btn> : (
                <Param label="Re override" value={ts.Re} min={0.5} max={60} step={0.1} digits={2} unit="Ω" badge="user" onChange={(v) => patch.coil({ re: v })} />
              )}
              {driver.coil.le != null ? <Btn small ghost onClick={() => patch.coil({ le: null })}>Le: use estimate ({(ts.Le * 1000).toFixed(2)} mH)</Btn> : (
                <Param label="Le override" value={ts.Le * 1000} min={0.01} max={10} step={0.01} digits={2} unit="mH" badge="user" onChange={(v) => patch.coil({ le: v })} />
              )}
              <Param label="Coil mass override" value={driver.coil.mass ?? w.coilMass * 1000} min={0.5} max={400} step={0.5} digits={1} unit="g"
                badge={driver.coil.mass != null ? 'user' : 'est'}
                onChange={(v) => patch.coil({ mass: v })} />
            </Section>
          ) : null}

          {part === 'magnet' ? (
            <Section title="Magnet Assembly">
              <Sel label="Magnet material" value={driver.magnet.materialId} options={matOpts(['magnet', 'custom'])} onChange={(v) => patch.magnet({ materialId: v })} />
              <Param label="Magnets stacked" value={driver.magnet.count} min={1} max={4} step={1} digits={0} onChange={(v) => patch.magnet({ count: Math.round(v) })} />
              <Param label="Ring outer Ø" value={driver.magnet.diameter} min={20} max={400} unit="mm" onChange={(v) => patch.magnet({ diameter: v })} />
              <Param label="Ring inner Ø" value={driver.magnet.innerDiameter} min={10} max={380} unit="mm" onChange={(v) => patch.magnet({ innerDiameter: v })} />
              <Param label="Thickness (each)" value={driver.magnet.thickness} min={3} max={60} unit="mm" onChange={(v) => patch.magnet({ thickness: v })} />
              <Param label="Pole piece Ø" value={driver.magnet.poleDiameter} min={5} max={200} unit="mm" onChange={(v) => patch.magnet({ poleDiameter: v })} />
              <Param label="Top plate Ø" value={driver.magnet.topPlateDiameter} min={20} max={380} unit="mm" onChange={(v) => patch.magnet({ topPlateDiameter: v })} />
              <Param label="Top plate thickness (gap)" value={driver.magnet.topPlateThickness} min={1} max={30} step={0.1} digits={1} unit="mm" onChange={(v) => patch.magnet({ topPlateThickness: v })} />
              <Param label="Back plate Ø" value={driver.magnet.backPlateDiameter} min={20} max={400} unit="mm" onChange={(v) => patch.magnet({ backPlateDiameter: v })} />
              <Param label="Back plate thickness" value={driver.magnet.backPlateThickness} min={3} max={60} unit="mm" onChange={(v) => patch.magnet({ backPlateThickness: v })} />
              <Param label="Gap width (radial)" value={driver.magnet.gapWidth} min={0.2} max={8} step={0.05} digits={2} unit="mm" onChange={(v) => patch.magnet({ gapWidth: v })} />
              <Param label="Leakage factor σ" value={driver.magnet.leakageFactor} min={1} max={4} step={0.05} digits={2} onChange={(v) => patch.magnet({ leakageFactor: v })} hint="1 = ideal; real ferrite structures 1.8–2.8" />
              <Toggle label="Painted plates & pole" value={driver.magnet.painted} onChange={(v) => patch.magnet({ painted: v })} hint="Black painted steel in the 3D model (visual only)" />
              <div className="row" style={{ marginTop: 6 }}>
                <Badge kind={driver.magnet.bGap != null ? 'user' : 'est'}>B gap {ts.Bgap.toFixed(2)} T</Badge>
                <Badge kind={driver.magnet.bl != null ? 'user' : 'est'}>Bl {ts.Bl.toFixed(2)} T·m</Badge>
                <Badge kind="est">{(mag.utilization * 100).toFixed(0)}% wire in gap</Badge>
              </div>
              {mag.saturationWarn ? <div className="warnbox" style={{ marginTop: 6 }}>Estimated pole flux suggests steel saturation — increase pole Ø or gap height.</div> : null}
              {driver.magnet.bl != null ? <Btn small ghost onClick={() => patch.magnet({ bl: null, bGap: null })}>Use magnetic-circuit estimate</Btn> : (
                <>
                  <Param label="B gap override" value={ts.Bgap} min={0.1} max={2} step={0.01} digits={2} unit="T" badge="user" onChange={(v) => patch.magnet({ bGap: v })} />
                  <Param label="Bl override" value={ts.Bl} min={0.2} max={50} step={0.1} digits={2} unit="T·m" badge="user" onChange={(v) => patch.magnet({ bl: v })} />
                </>
              )}
              <p className="note" style={{ marginBottom: 0 }}>
                1-D reluctance model: B = Br·Am/(σ·Ag + μr·Am·lg/lm), capped by steel saturation (~1.6 T). No FEM —
                fringing/leakage are lumped into σ. See docs/PHYSICS.md.
              </p>
            </Section>
          ) : null}

          {part === 'frame' ? (
            <Section title="Frame & Chassis">
              <Param label="Frame depth" value={driver.frame.depth} min={30} max={300} unit="mm" hint="Auto-grows to house the motor stack if the design needs it" onChange={(v) => patch.frame({ depth: v })} />
              <Param label="Gasket thickness" value={driver.frame.gasketThickness} min={0.5} max={6} step={0.1} digits={1} unit="mm" onChange={(v) => patch.frame({ gasketThickness: v })} />
              <Sel label="Terminals" value={driver.frame.terminals} options={[{ value: 'push', label: 'Push tabs' }, { value: 'solder', label: 'Solder lugs' }, { value: 'spring', label: 'Spring clips' }]} onChange={(v) => patch.frame({ terminals: v as typeof driver.frame.terminals })} />
              <Param label="Tinsel leads" value={driver.frame.tinselLeads} min={2} max={4} step={1} digits={0} onChange={(v) => patch.frame({ tinselLeads: Math.round(v) })} />
              <Param label="Mounting holes" value={driver.frame.mountingHoles} min={4} max={8} step={1} digits={0} onChange={(v) => patch.frame({ mountingHoles: Math.round(v) })} />
              <Sel label="Frame material" value={driver.frame.materialId} options={matOpts(['frame', 'custom'])} onChange={(v) => patch.frame({ materialId: v })} />
              <Sel label="Basket style" value={driver.frame.style} options={[{ value: 'stamped', label: 'Stamped steel' }, { value: 'diecast', label: 'Die-cast' }]} onChange={(v) => patch.frame({ style: v as typeof driver.frame.style })} />
              <Toggle label="Front gasket ring" value={driver.frame.gasket} onChange={(v) => patch.frame({ gasket: v })} />
              <div className="param"><label>Frame color</label>
                <input type="color" value={driver.frame.color} onChange={(e) => patch.frame({ color: e.target.value })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
              </div>
            </Section>
          ) : null}

          <Section title="Nonlinearity (Advanced sim mode)">
            <Param label="BL droop @ Xmech" value={driver.blDropAtXmech} min={0} max={0.9} step={0.05} digits={2} unit="fraction" badge="user" onChange={(v) => useApp.getState().patchDriver({ blDropAtXmech: v })} />
            <Param label="Kms rise @ Xmax" value={driver.kmsRiseAtXmax} min={0} max={3} step={0.1} digits={1} unit="×" badge="user" onChange={(v) => useApp.getState().patchDriver({ kmsRiseAtXmax: v })} />
            <p className="note">Used by the Advanced simulation mode (semi-implicit integration with BL(x), Kms(x)) in the Audio Lab.</p>
          </Section>
        </div>

        <div className="main-area">
          <Viewport3D
            quality={quality} exploded={exploded} section={section}
            hudExtras={<span>Component inspector — {part}</span>}
          />
          <div className="card">
            <div className="row">
              <Param label="Exploded" value={exploded} min={0} max={1} step={0.01} digits={2} unit="" onChange={setExploded} />
              <Param label="Section" value={section} min={0} max={180} step={1} digits={0} unit="°" onChange={setSection} />
              <Sel label="Quality" value={quality} options={[{ value: 'low', label: 'Low' }, { value: 'med', label: 'Medium' }, { value: 'high', label: 'High' }]} onChange={(v) => setQuality(v as typeof quality)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function autoConeMass(od: number, depth: number, thickness: number): number {
  // same geometry estimate as tsp.ts (cone lateral surface × thickness × density)
  const rIn = mm2m(od) / 4;
  const rOut = mm2m(od) / 2;
  const slant = Math.sqrt(Math.pow(rOut - rIn, 2) + mm2m(depth) * mm2m(depth));
  const area = Math.PI * (rIn + rOut) * slant;
  return g2kg(0) + area * mm2m(thickness) * 480 * 1000; // paper density default
}

void fmtSI;
