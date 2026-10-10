/*
 * Project serialization / validation.
 * A project is a plain JSON object; imports are validated and merged onto
 * defaults so older or partial files still load.
 */
import type { DriverParams, EnclosureParams, AmplifierParams, AudioSettings, SimSettings } from '../physics/types';
import { defaultDriver, defaultEnclosure, defaultAmplifier, defaultAudio, defaultSim } from '../physics/defaults';
import { deepMerge } from '../physics/util';

export const PROJECT_VERSION = 1;

export interface ProjectFile {
  app: 'neth-speakers';
  version: number;
  name: string;
  savedAt: string;
  driver: DriverParams;
  enclosure: EnclosureParams;
  amplifier: AmplifierParams;
  audio: AudioSettings;
  sim: SimSettings;
  notes?: string;
  customMaterials?: unknown[];
}

export interface ProjectRecord extends ProjectFile {
  id: string;
  createdAt: string;
  modifiedAt: string;
}

export function serializeProject(
  name: string,
  parts: { driver: DriverParams; enclosure: EnclosureParams; amplifier: AmplifierParams; audio: AudioSettings; sim: SimSettings },
  notes = ''
): ProjectFile {
  return {
    app: 'neth-speakers',
    version: PROJECT_VERSION,
    name,
    savedAt: new Date().toISOString(),
    driver: parts.driver,
    enclosure: parts.enclosure,
    amplifier: parts.amplifier,
    audio: parts.audio,
    sim: parts.sim,
    notes,
  };
}

export function validateProject(raw: unknown): { ok: true; project: ProjectFile } | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object') return { ok: false, error: 'Not a JSON object' };
  const o = raw as Record<string, unknown>;
  if (o.app !== 'neth-speakers') return { ok: false, error: 'Not a Neth Speakers project file' };
  const version = typeof o.version === 'number' ? o.version : 1;
  if (version > PROJECT_VERSION) return { ok: false, error: `Project version ${version} is newer than this app supports` };
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Imported design';
  const project: ProjectFile = {
    app: 'neth-speakers',
    version: PROJECT_VERSION,
    name,
    savedAt: typeof o.savedAt === 'string' ? o.savedAt : new Date().toISOString(),
    driver: deepMerge(defaultDriver(), o.driver),
    enclosure: deepMerge(defaultEnclosure(), o.enclosure),
    amplifier: deepMerge(defaultAmplifier(), o.amplifier),
    audio: deepMerge(defaultAudio(), o.audio),
    sim: deepMerge(defaultSim(), o.sim),
    notes: typeof o.notes === 'string' ? o.notes : '',
    customMaterials: Array.isArray(o.customMaterials) ? o.customMaterials : [],
  };
  return { ok: true, project };
}

export function newProjectRecord(name: string, parts: Parameters<typeof serializeProject>[1]): ProjectRecord {
  const now = new Date().toISOString();
  return {
    ...serializeProject(name, parts),
    id: generateId(),
    createdAt: now,
    modifiedAt: now,
  };
}

export function generateId(): string {
  const rnd = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `p_${Date.now().toString(36)}_${rnd()}${rnd()}`;
}
