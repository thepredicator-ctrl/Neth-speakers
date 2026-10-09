/* Project Manager — save/load/duplicate/rename/import/export + materials database. */
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Badge, FileDrop } from '../components/ui';
import { serializeProject, validateProject, newProjectRecord, generateId, type ProjectRecord } from '../storage/project';
import * as db from '../storage/db';
import { MATERIALS, CUSTOM_MATERIAL_PREFIX } from '../physics/materials';
import { engine } from '../audio/engine';
import { applyPreset, defaultDriver, defaultEnclosure, defaultAmplifier } from '../physics/defaults';
import type { MaterialDef } from '../physics/types';

export function ProjectManager() {
  const store = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [storage, setStorage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const importedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void store.refreshProjects();
    void db.storageEstimate().then(setStorage);
    // load custom materials once
    void db.listCustomMaterials().then((mats) => {
      useApp.setState({ customMaterials: mats });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (asNew = false) => {
    setBusy(true);
    try {
      const state = useApp.getState();
      const name = state.projectName || 'Untitled Design';
      const existing = !asNew && state.currentProjectId ? state.projects.find((p) => p.id === state.currentProjectId) : null;
      const rec: ProjectRecord = existing
        ? { ...serializeProject(name, state), id: existing.id, createdAt: existing.createdAt, modifiedAt: new Date().toISOString() }
        : { ...serializeProject(name, state), id: generateId(), createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
      await db.putProject(rec);
      await useApp.getState().refreshProjects();
      useApp.setState({ currentProjectId: rec.id, projectName: name });
      setMsg(existing ? 'Project updated.' : 'Project saved.');
    } finally {
      setBusy(false);
    }
  };

  const openProject = (rec: ProjectRecord) => {
    store.loadProjectRecord(rec);
    engine.resetSim();
    setMsg(`Opened “${rec.name}”.`);
  };

  const duplicate = async (rec: ProjectRecord) => {
    const copy: ProjectRecord = {
      ...rec,
      id: generateId(),
      name: `${rec.name} (copy)`,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    await db.putProject(copy);
    await useApp.getState().refreshProjects();
  };

  const rename = async (rec: ProjectRecord) => {
    const name = prompt('Project name', rec.name);
    if (!name) return;
    await db.putProject({ ...rec, name, modifiedAt: new Date().toISOString() });
    await useApp.getState().refreshProjects();
    if (useApp.getState().currentProjectId === rec.id) useApp.getState().setProjectName(name);
  };

  const remove = async (rec: ProjectRecord) => {
    if (!confirm(`Delete “${rec.name}”? This cannot be undone.`)) return;
    await db.deleteProject(rec.id);
    await useApp.getState().refreshProjects();
    if (useApp.getState().currentProjectId === rec.id) useApp.setState({ currentProjectId: null });
  };

  const exportJson = (rec: ProjectRecord) => {
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${rec.name.replace(/[^a-z0-9\-_ ]/gi, '')}.neth.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportCurrent = () => {
    const s = useApp.getState();
    const rec = { ...serializeProject(s.projectName, s), id: s.currentProjectId ?? generateId(), createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
    exportJson(rec);
  };

  const importFile = async (f: File) => {
    setImportErr(null);
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const v = validateProject(parsed);
      if (!v.ok) { setImportErr(v.error); return; }
      const rec: ProjectRecord = { ...v.project, id: generateId(), createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
      await db.putProject(rec);
      await useApp.getState().refreshProjects();
      openProject(rec);
    } catch (e) {
      setImportErr(`Invalid file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const newDesign = () => {
    useApp.setState({
      driver: defaultDriver(),
      enclosure: defaultEnclosure(),
      amplifier: defaultAmplifier(),
      projectName: 'Untitled Design',
      currentProjectId: null,
    });
    useApp.getState().recompute();
    engine.resetSim();
    setMsg('New blank design created.');
  };

  const resetDemo = () => {
    const { driver, enclosure } = applyPreset('neth10');
    useApp.setState({ driver, enclosure: { ...useApp.getState().enclosure, ...enclosure }, projectName: 'Neth-10 Classic (8″ bass-mid)', currentProjectId: null });
    useApp.getState().recompute();
    engine.resetSim();
    setMsg('Reset to the built-in demo driver.');
  };

  /* ---- custom material form ---- */
  const [cm, setCm] = useState<Partial<MaterialDef>>({ category: 'cone', density: 500 });
  const addMaterial = async () => {
    if (!cm.name) return;
    const m: MaterialDef = {
      id: `${CUSTOM_MATERIAL_PREFIX}${Date.now().toString(36)}`,
      name: cm.name,
      category: (cm.category ?? 'cone') as MaterialDef['category'],
      density: cm.density ?? 500,
      youngs: cm.youngs,
      lossFactor: cm.lossFactor,
      resistivity: cm.resistivity,
      tempCo: cm.tempCo,
      br: cm.br,
      muR: cm.muR,
      notes: cm.notes ?? 'User-defined material.',
      color: cm.color ?? '#888888',
      illustrative: true,
    };
    await store.addCustomMaterial(m);
    setCm({ category: 'cone', density: 500 });
    setMsg('Material saved to database.');
  };

  return (
    <div className="ws">
      <div className="grid2">
        <Section
          title="Current Design"
          right={<Badge kind={useApp.getState().currentProjectId ? 'ok' : 'est'}>{useApp.getState().currentProjectId ? 'SAVED' : 'UNSAVED'}</Badge>}
        >
          <div className="param">
            <label>Name</label>
            <input type="text" className="flex1" value={store.projectName} style={{ textAlign: 'left' }}
              onChange={(e) => store.setProjectName(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Btn variant="primary" onClick={() => void save(false)} disabled={busy}>💾 Save</Btn>
            <Btn onClick={() => void save(true)} disabled={busy}>Save as new</Btn>
            <Btn onClick={newDesign}>New design</Btn>
            <Btn onClick={resetDemo}>Reset to demo</Btn>
            <Btn onClick={exportCurrent}>Export JSON</Btn>
          </div>
          <div style={{ marginTop: 12 }}>
            <FileDrop onFile={(f) => void importFile(f)} accept=".json,application/json" label="Drop a .neth.json project file to import — or click to browse" />
            {importErr ? <div className="warnbox" style={{ marginTop: 8 }}>{importErr}</div> : null}
          </div>
          {msg ? <div className="infobox" style={{ marginTop: 8 }}>{msg}</div> : null}
        </Section>

        <Section title="Storage">
          <div className="note">Projects persist in this browser (IndexedDB with localStorage fallback). Audio files never leave your device.</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Badge kind="ok">{store.projects.length} project(s)</Badge>
            <Badge kind="est">{storage}</Badge>
          </div>
        </Section>
      </div>

      <Section title="Saved Projects">
        {store.projects.length === 0 ? (
          <p className="note">No saved projects yet — design something and hit Save.</p>
        ) : (
          <div className="proj-list">
            {store.projects.map((p) => (
              <div key={p.id} className="proj-item">
                <div className="meta">
                  <b>{p.name}{p.id === useApp.getState().currentProjectId ? ' ← open' : ''}</b>
                  <span>{p.enclosure.type} · {p.driver.cone.outerDiameter.toFixed(0)} mm cone · modified {new Date(p.modifiedAt).toLocaleString()}</span>
                </div>
                <Btn small onClick={() => openProject(p)}>Open</Btn>
                <Btn small ghost onClick={() => void duplicate(p)}>Duplicate</Btn>
                <Btn small ghost onClick={() => void rename(p)}>Rename</Btn>
                <Btn small ghost onClick={() => exportJson(p)}>Export</Btn>
                <Btn small ghost danger onClick={() => void remove(p)}>Delete</Btn>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Materials Database" collapsible>
        <p className="note">
          Reference defaults are typical literature values marked <Badge kind="est">EST</Badge> where not verified for a
          specific grade. Custom materials are saved to the browser database and selectable everywhere.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr><th>Material</th><th>Category</th><th>Density kg/m³</th><th>ρ Ω·m</th><th>Br T</th><th>Notes</th><th /></tr>
            </thead>
            <tbody>
              {[...MATERIALS, ...store.customMaterials].map((m) => (
                <tr key={m.id}>
                  <td>{m.name} {m.illustrative ? <Badge kind="est">EST</Badge> : null}</td>
                  <td>{m.category}</td>
                  <td className="num">{m.density}</td>
                  <td className="num">{m.resistivity ? m.resistivity.toExponential(2) : '—'}</td>
                  <td className="num">{m.br?.toFixed(2) ?? '—'}</td>
                  <td className="dim" style={{ whiteSpace: 'normal', minWidth: 200 }}>{m.notes}</td>
                  <td>{m.id.startsWith(CUSTOM_MATERIAL_PREFIX) ? <Btn small ghost danger onClick={() => void store.removeCustomMaterial(m.id)}>×</Btn> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <label className="note">Name<input type="text" value={cm.name ?? ''} onChange={(e) => setCm({ ...cm, name: e.target.value })} /></label>
          <label className="note">Category
            <select value={cm.category} onChange={(e) => setCm({ ...cm, category: e.target.value as MaterialDef['category'] })}>
              {['cone', 'surround', 'spider', 'wire', 'magnet', 'former', 'frame', 'enclosure'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="note">Density<input type="number" value={cm.density ?? 500} onChange={(e) => setCm({ ...cm, density: parseFloat(e.target.value) })} style={{ width: 90 }} /></label>
          {cm.category === 'wire' ? <label className="note">ρ (Ω·m)<input type="number" step="1e-9" value={cm.resistivity ?? 1.7e-8} onChange={(e) => setCm({ ...cm, resistivity: parseFloat(e.target.value) })} style={{ width: 110 }} /></label> : null}
          {cm.category === 'magnet' ? <label className="note">Br (T)<input type="number" step="0.01" value={cm.br ?? 0.4} onChange={(e) => setCm({ ...cm, br: parseFloat(e.target.value) })} style={{ width: 80 }} /></label> : null}
          <Btn onClick={() => void addMaterial()} disabled={!cm.name}>Add material</Btn>
        </div>
      </Section>
    </div>
  );
}
