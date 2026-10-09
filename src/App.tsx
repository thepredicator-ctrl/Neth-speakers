/* Application shell: top bar, nav rail, workspace router, status bar. */
import React, { useEffect, useState } from 'react';
import { useApp, useSnapshotPush, type WorkspaceId } from './store';
import { engine } from './audio/engine';
import { Dashboard } from './workspaces/Dashboard';
import { SpeakerLab } from './workspaces/SpeakerLab';
import { Simulator3D } from './workspaces/Simulator3D';
import { AudioLab } from './workspaces/AudioLab';
import { FrequencyLab } from './workspaces/FrequencyLab';
import { EnclosureDesigner } from './workspaces/EnclosureDesigner';
import { PartsEditor } from './workspaces/PartsEditor';
import { Results } from './workspaces/Results';
import { ProjectManager } from './workspaces/ProjectManager';
import { physicalDispMm } from './components/Viewport3D';

const ICONS: Record<WorkspaceId, React.ReactNode> = {
  dashboard: <IconGauge />,
  speaker: <IconSpeaker />,
  sim3d: <IconCube />,
  audio: <IconWave />,
  frequency: <IconSweep />,
  enclosure: <IconBox />,
  parts: <IconCog />,
  results: <IconChart />,
  projects: <IconFolder />,
};

const LABELS: Record<WorkspaceId, string> = {
  dashboard: 'Dashboard',
  speaker: 'Speaker Lab',
  sim3d: '3D Simulator',
  audio: 'Audio Lab',
  frequency: 'Frequency Lab',
  enclosure: 'Enclosure',
  parts: 'Parts Editor',
  results: 'Results',
  projects: 'Projects',
};

export function App() {
  const workspace = useApp((s) => s.workspace);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const projectName = useApp((s) => s.projectName);
  const setProjectName = useApp((s) => s.setProjectName);
  const snapshot = useApp((s) => s.snapshot);
  const ts = useApp((s) => s.derived.ts);
  const sim = useApp((s) => s.sim);
  useSnapshotPush();

  const [hud, setHud] = useState({ mm: 0 });
  const [audioOn, setAudioOn] = useState(false);
  useEffect(() => {
    // push the initial derived physics into the audio engine (worklet matrices)
    useApp.getState().recompute();
  }, []);
  useEffect(() => {
    const id = setInterval(() => setHud({ mm: physicalDispMm() }), 120);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const ids = Object.keys(LABELS) as WorkspaceId[];
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= ids.length) { setWorkspace(ids[n - 1]); return; }
      if (e.code === 'Space' && workspace === 'audio') {
        e.preventDefault();
        void engine.ensure().then(() => setAudioOn(true));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace, setWorkspace]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark" />
          <div>
            <b>NETH SPEAKERS</b><br />
            <span>Loudspeaker Engineering Lab</span>
          </div>
        </div>
        <span className="spacer" />
        <input
          className="project-name" value={projectName} maxLength={64}
          onChange={(e) => setProjectName(e.target.value)} title="Design name"
          aria-label="Design name"
        />
        <div className="top-actions">
          <span className="note mono">
            {audioOn ? '' : ''}
          </span>
        </div>
      </header>

      <div className="main">
        <nav className="rail" aria-label="Workspaces">
          {(Object.keys(LABELS) as WorkspaceId[]).map((id) => (
            <button
              key={id}
              className={workspace === id ? 'active' : ''}
              onClick={() => setWorkspace(id)}
              title={LABELS[id]}
            >
              {ICONS[id]}
              <span>{LABELS[id].split(' ')[0]}</span>
            </button>
          ))}
        </nav>

        <main className="content" key={workspace}>
          {workspace === 'dashboard' ? <Dashboard /> : null}
          {workspace === 'speaker' ? <SpeakerLab /> : null}
          {workspace === 'sim3d' ? <Simulator3D /> : null}
          {workspace === 'audio' ? <AudioLab /> : null}
          {workspace === 'frequency' ? <FrequencyLab /> : null}
          {workspace === 'enclosure' ? <EnclosureDesigner /> : null}
          {workspace === 'parts' ? <PartsEditor /> : null}
          {workspace === 'results' ? <Results /> : null}
          {workspace === 'projects' ? <ProjectManager /> : null}
        </main>
      </div>

      <footer className="statusbar">
        <span><span className={`dot${Math.abs(hud.mm) > ts.Xmax ? ' warn' : ' ok'}`} />x = {hud.mm >= 0 ? '+' : ''}{hud.mm.toFixed(3)} mm</span>
        <span className="sep">|</span>
        <span>I = {snapshot.i.toFixed(2)} A</span>
        <span className="sep">|</span>
        <span>±Xmax {ts.Xmax.toFixed(1)} / ±Xmech {ts.Xmech.toFixed(1)} mm</span>
        <span className="sep">|</span>
        <span>Fs {ts.Fs.toFixed(1)} Hz · Qts {ts.Qts.toFixed(3)}</span>
        <span className="spacer flex1" />
        <span title="Simulation mode">{sim.mode.toUpperCase()}</span>
        <span className="sep">|</span>
        <span className="dim">keys 1–9 = workspaces</span>
        <span className="sep">|</span>
        <span title={snapshot.sync === 'ok' ? 'Displacement stream synced to the audio clock' : 'No live audio stream'}>
          {snapshot.sync === 'ok' ? 'SYNC LOCKED' : snapshot.sync === 'stale' ? 'SYNC STALE' : 'SIM IDLE'}
        </span>
        {snapshot.limit ? <span className="acc-txt flash">LIMIT</span> : null}
      </footer>
    </div>
  );
}

/* ---- inline icon set (stroke style) ---- */
function Ic(props: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {props.children}
    </svg>
  );
}
function IconSpeaker() {
  return <Ic><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></Ic>;
}
function IconCube() {
  return <Ic><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Ic>;
}
function IconWave() {
  return <Ic><path d="M3 12h2l2-7 3 14 3-10 2 5h6" /></Ic>;
}
function IconSweep() {
  return <Ic><path d="M3 20c4 0 4-14 9-14s5 10 9 10" /><circle cx="12" cy="6" r="1.4" /></Ic>;
}
function IconBox() {
  return <Ic><rect x="4" y="7" width="16" height="12" rx="1" /><circle cx="9" cy="13" r="2.4" /><path d="M4 7l8-4 8 4" /></Ic>;
}
function IconCog() {
  return <Ic><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" /></Ic>;
}
function IconChart() {
  return <Ic><path d="M4 20V4M4 20h16" /><path d="M7 15l3-5 3 3 5-8" /></Ic>;
}
function IconFolder() {
  return <Ic><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Ic>;
}
function IconGauge() {
  return <Ic><path d="M4 15a8 8 0 0116 0" /><path d="M12 15l4-5" /><path d="M4 19h16" /><circle cx="12" cy="15" r="1.4" /></Ic>;
}
