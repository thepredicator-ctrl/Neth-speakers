/* Simulation Results — compare designs, export reports. */
import React, { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Badge } from '../components/ui';
import { Plot, type Series } from '../components/Plot';
import { responseOverGrid, impedanceCurve, computeEnclosure } from '../physics/freqresp';
import { computeTS } from '../physics/tsp';
import { buildSystem, wiringInfo } from '../physics/stateSpace';
import { logspace } from '../physics/units';
import { MATERIALS } from '../physics/materials';
import type { DriverParams, EnclosureParams } from '../physics/types';
import type { ProjectRecord } from '../storage/project';

interface DesignSnapshot {
  id: string;
  name: string;
  color: string;
  driver: DriverParams;
  enclosure: EnclosureParams;
  note: string;
}

const COLORS = ['#ff7a1a', '#35c8dc', '#9b7bff', '#4fd07a', '#e05555', '#ffd166'];

const mats = (id: string) => MATERIALS.find((m) => m.id === id);

export function Results() {
  const driver = useApp((s) => s.driver);
  const enclosure = useApp((s) => s.enclosure);
  const projectName = useApp((s) => s.projectName);
  const projects = useApp((s) => s.projects);
  const loadProjectRecord = useApp((s) => s.loadProjectRecord);
  const [snaps, setSnaps] = useState<DesignSnapshot[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const addCurrent = () => {
    if (snaps.length >= 6) return;
    setSnaps([...snaps, {
      id: `s${Date.now()}`,
      name: projectName,
      color: COLORS[snaps.length % COLORS.length],
      driver: JSON.parse(JSON.stringify(driver)),
      enclosure: JSON.parse(JSON.stringify(enclosure)),
      note: `Snapshot ${snaps.length + 1}`,
    }]);
  };

  const addFromProject = (rec: ProjectRecord) => {
    if (snaps.length >= 6) return;
    setSnaps([...snaps, {
      id: rec.id,
      name: rec.name,
      color: COLORS[snaps.length % COLORS.length],
      driver: rec.driver,
      enclosure: rec.enclosure,
      note: `Saved project`,
    }]);
  };

  const data = useMemo(() => {
    const f = logspace(12, 12000, 260);
    const series: { s: DesignSnapshot; ts: ReturnType<typeof computeTS>; splDb: number[]; excMm: number[]; imp: number[] }[] = [];
    for (const s of snaps) {
      try {
        const ts = computeTS(s.driver, mats);
        const encRes = (() => {
          const driverVolL = (Math.PI / 4) * Math.pow((s.driver.magnet.diameter / 1000), 2) * ((s.driver.magnet.thickness + s.driver.magnet.backPlateThickness) / 1000) * 1000
            + (Math.PI / 4) * Math.pow((s.driver.cone.outerDiameter / 1000), 2) * ((s.driver.frame.depth * 0.45) / 1000) * 1000 * 0.35;
          return computeEnclosure(s.enclosure, ts, driverVolL);
        })();
        const sys = buildSystem({
          ts, enclosure: s.enclosure, encResult: encRes,
          wiring: wiringInfo(ts, s.enclosure.driverCount, s.enclosure.wiring, s.enclosure.coilWiring, 1),
          sourceImpedance: 0.05, sampleRate: 48000,
        });
        const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
        const exc = responseOverGrid(sys.A, sys.B, sys.cx, f);
        const imp = impedanceCurve(ts, f, s.enclosure, encRes, 0);
        const vRef = 2.83;
        series.push({
          s, ts,
          splDb: spl.mag.map((m) => 20 * Math.log10(Math.max(m * vRef * sys.splScale, 1e-12) / 2e-5)),
          excMm: exc.mag.map((m) => m * vRef * 1000),
          imp: imp.mag,
        });
      } catch { /* skip broken snapshot */ }
    }
    return { f, series };
  }, [snaps]);

  const splSeries: Series[] = data.series.map((d) => ({
    name: d.s.name, color: d.s.color, points: data.f.map((f, i) => [f, d.splDb[i]] as [number, number]),
  }));
  const excSeries: Series[] = data.series.map((d) => ({
    name: d.s.name, color: d.s.color, points: data.f.map((f, i) => [f, d.excMm[i]] as [number, number]),
  }));
  const impSeries: Series[] = data.series.map((d) => ({
    name: d.s.name, color: d.s.color, points: data.f.map((f, i) => [f, d.imp[i]] as [number, number]),
  }));

  const generateReport = () => {
    const lines: string[] = [];
    lines.push('NETH SPEAKERS — SIMULATION REPORT');
    lines.push(new Date().toISOString());
    lines.push('');
    for (const d of data.series) {
      const ts = d.ts;
      const enc = d.s.enclosure;
      lines.push(`== ${d.s.name} ==`);
      lines.push(`Enclosure: ${enc.type} ${enc.internalWidth}×${enc.internalHeight}×${enc.internalDepth} mm (int), wall ${enc.wallThickness} mm, ${enc.driverCount} driver(s) ${enc.wiring}`);
      lines.push(`Fs=${ts.Fs.toFixed(1)} Hz  Qms=${ts.Qms.toFixed(2)}  Qes=${ts.Qes.toFixed(2)}  Qts=${ts.Qts.toFixed(3)}`);
      lines.push(`Vas=${ts.Vas.toFixed(1)} L  Re=${ts.Re.toFixed(2)} Ω  Le=${(ts.Le * 1000).toFixed(2)} mH  Bl=${ts.Bl.toFixed(2)} T·m  Bgap=${ts.Bgap.toFixed(2)} T`);
      lines.push(`Sd=${(ts.Sd * 1e4).toFixed(1)} cm²  Mms=${(ts.Mms * 1000).toFixed(1)} g  Cms=${(ts.Cms * 1e6).toFixed(0)} µm/N  Rms=${ts.Rms.toFixed(2)} N·s/m`);
      lines.push(`Xmax=${ts.Xmax.toFixed(1)} mm one-way (peak-to-peak travel ${(ts.Xmax * 2).toFixed(1)} mm, mechanical ±${ts.Xmech.toFixed(1)} mm)`);
      lines.push(`eta0=${(ts.eta0 * 100).toFixed(2)} %  sens=${ts.sens.toFixed(1)} dB/2.83V/1m (piston est.)`);
      lines.push('');
    }
    lines.push('All values are model estimates (see docs/PHYSICS.md for equations and approximations).');
    setReport(lines.join('\n'));
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'neth-speakers-report.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="ws">
      <Section title="Design Comparison" right={<Btn variant="primary" small onClick={addCurrent}>+ Add current design</Btn>}>
        {snaps.length === 0 ? (
          <p className="note">Add the current design or saved projects to overlay their curves and compare Thiele–Small parameters side by side.</p>
        ) : (
          <div className="row">
            {snaps.map((s) => (
              <span key={s.id} className="row" style={{ gap: 6 }}>
                <span className="sw" style={{ width: 12, height: 12, borderRadius: 3, background: s.color, display: 'inline-block' }} />
                <b style={{ fontSize: 12 }}>{s.name}</b>
                <Btn small ghost danger onClick={() => setSnaps(snaps.filter((x) => x.id !== s.id))}>×</Btn>
              </span>
            ))}
          </div>
        )}
        {projects.length > 0 && snaps.length < 6 ? (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="note">From saved projects:</span>
            {projects.slice(0, 5).map((p) => (
              <Btn key={p.id} small ghost onClick={() => addFromProject(p)}>{p.name}</Btn>
            ))}
          </div>
        ) : null}
      </Section>

      {snaps.length > 0 ? (
        <>
          <div className="grid2">
            <Section title="Estimated SPL @2.83 V">
              <Plot height={200} xLog yLabel="dB" series={splSeries} cursorFreq={cursor} onCursor={setCursor} csvName="compare-spl" />
            </Section>
            <Section title="Impedance">
              <Plot height={200} xLog yLabel="Ω" series={impSeries} cursorFreq={cursor} onCursor={setCursor} csvName="compare-impedance" />
            </Section>
          </div>
          <Section title="Excursion @2.83 V (one-way)">
            <Plot
              height={200} xLog yLabel="mm"
              series={excSeries}
              refLines={data.series.length > 0 ? [
                { y: Math.max(...data.series.map((d) => d.ts.Xmax)), color: 'rgba(255,77,77,0.5)', label: 'max Xmax' },
                { y: -Math.max(...data.series.map((d) => d.ts.Xmax)), color: 'rgba(255,77,77,0.5)', label: '−Xmax' },
              ] : []}
              cursorFreq={cursor} onCursor={setCursor} csvName="compare-excursion"
            />
            <p className="note">One-way (Xmax) limits — peak-to-peak travel is 2× these values; total mechanical clearance is ±Xmech. Never confuse the three.</p>
          </Section>
          <Section title="Parameter Table">
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Design</th><th>Fs Hz</th><th>Qts</th><th>Vas L</th><th>Re Ω</th><th>Bl T·m</th><th>Sd cm²</th>
                    <th>Mms g</th><th>Xmax mm</th><th>η₀ %</th><th>sens dB</th><th>Box</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((d) => (
                    <tr key={d.s.id}>
                      <td><span style={{ color: d.s.color }}>●</span> {d.s.name}</td>
                      <td className="num">{d.ts.Fs.toFixed(1)}</td>
                      <td className="num">{d.ts.Qts.toFixed(3)}</td>
                      <td className="num">{d.ts.Vas.toFixed(1)}</td>
                      <td className="num">{d.ts.Re.toFixed(2)}</td>
                      <td className="num">{d.ts.Bl.toFixed(2)}</td>
                      <td className="num">{(d.ts.Sd * 1e4).toFixed(1)}</td>
                      <td className="num">{(d.ts.Mms * 1000).toFixed(1)}</td>
                      <td className="num">{d.ts.Xmax.toFixed(1)}</td>
                      <td className="num">{(d.ts.eta0 * 100).toFixed(2)}</td>
                      <td className="num">{d.ts.sens.toFixed(1)}</td>
                      <td className="num">{d.s.enclosure.type} {d.s.enclosure.internalWidth}×{d.s.enclosure.internalHeight}×{d.s.enclosure.internalDepth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : null}

      <Section title="Report" right={
        <div className="row">
          <Btn small onClick={generateReport} disabled={snaps.length === 0}>Generate</Btn>
          <Btn small onClick={downloadReport} disabled={!report}>Download .txt</Btn>
        </div>
      }>
        {report ? (
          <pre className="mono" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', background: 'var(--panel2)', padding: 12, borderRadius: 8, border: '1px solid var(--line)', maxHeight: 260, overflowY: 'auto' }}>{report}</pre>
        ) : (
          <p className="note">Generate a text summary of all compared designs (parameters + enclosure + documented assumptions) for export.</p>
        )}
      </Section>
    </div>
  );
}
