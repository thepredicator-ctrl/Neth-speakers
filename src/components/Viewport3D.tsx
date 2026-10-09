/* React wrapper for the Three.js SpeakerScene. */
import React, { useEffect, useRef } from 'react';
import { SpeakerScene, type ViewName, type Quality } from '../three/speakerScene';
import { engine } from '../audio/engine';
import { useApp } from '../store';
import type { EnclosureParams, DriverParams } from '../physics/types';

export type { ViewName, Quality } from '../three/speakerScene';

export function vizScaleOf(a: { vizMode: string; vizMultiplier: number }): number {
  return a.vizMode === 'enhanced' ? a.vizMultiplier : 1;
}

/** Current physical displacement in mm (from the engine's sync clock). */
export function physicalDispMm(): number {
  return engine.renderDisplacement() * 1000;
}

export function Viewport3D(props: {
  showEnclosure?: boolean;
  wallOpacity?: number;
  vizScale?: number;
  compact?: boolean;
  viewRequest?: { v: ViewName; n: number };
  exploded?: number;
  section?: number | null;
  quality?: Quality;
  className?: string;
  hudExtras?: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpeakerScene | null>(null);
  const driver = useApp((s) => s.driver);
  const enclosure = useApp((s) => s.enclosure);
  const materialById = useApp((s) => s.materialById);
  const audio = useApp((s) => s.audio);
  const matsRef = useRef(materialById);
  matsRef.current = materialById;
  const audioRef = useRef(audio);
  audioRef.current = audio;

  useEffect(() => {
    if (!ref.current) return;
    const scene = new SpeakerScene(ref.current, (id) => matsRef.current(id), {
      getDisplacement: () => engine.renderDisplacement(),
      showRestRing: true,
    });
    sceneRef.current = scene;
    scene.setVizScale(props.vizScale ?? vizScaleOf(audioRef.current));
    return () => { scene.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sceneRef.current?.setDriver(driver); }, [driver]);
  useEffect(() => {
    const show = props.showEnclosure ?? useApp.getState().workspace === 'enclosure';
    sceneRef.current?.setEnclosure(show ? enclosure : null, driver);
    sceneRef.current?.setWallOpacity(props.wallOpacity ?? 0.18);
  }, [props.showEnclosure, props.wallOpacity, enclosure, driver]);
  useEffect(() => { sceneRef.current?.setVizScale(props.vizScale ?? vizScaleOf(audioRef.current)); }, [props.vizScale, audio.vizMode, audio.vizMultiplier]);
  useEffect(() => { if (props.viewRequest) sceneRef.current?.setView(props.viewRequest.v); }, [props.viewRequest]);
  useEffect(() => { sceneRef.current?.setExploded(props.exploded ?? 0); }, [props.exploded]);
  useEffect(() => { sceneRef.current?.setSection(props.section ?? null); }, [props.section]);
  useEffect(() => { if (props.quality) sceneRef.current?.setQuality(props.quality); }, [props.quality]);

  return (
    <div className={`viewport${props.className ? ` ${props.className}` : ''}`} style={props.compact ? { minHeight: 240 } : undefined}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {props.overlay ? <div className="vp-overlay">{props.overlay}</div> : null}
      {props.hudExtras ? <div className="vp-hud">{props.hudExtras}</div> : null}
    </div>
  );
}

void (0 as unknown as EnclosureParams | null);
void (0 as unknown as DriverParams);
