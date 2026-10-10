// Generates example .neth.json project files from the actual presets.
import { writeFileSync } from 'node:fs';
import { defaultDriver, defaultEnclosure, defaultAmplifier, defaultAudio, defaultSim, applyPreset, PRESETS } from '../src/physics/defaults.ts';

const mk = (id) => {
  const preset = PRESETS.find((p) => p.id === id);
  const { driver, enclosure } = applyPreset(id);
  return {
    app: 'neth-speakers',
    version: 1,
    name: preset.name,
    savedAt: new Date().toISOString(),
    notes: preset.blurb,
    driver,
    enclosure: { ...defaultEnclosure(), ...enclosure },
    amplifier: defaultAmplifier(),
    audio: defaultAudio(),
    sim: defaultSim(),
    customMaterials: [],
    id: `example_${id}`,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
};

for (const id of ['neth10', 'neth12sub', 'neth18pr']) {
  const p = mk(id);
  writeFileSync(new URL(`../examples/${id}.neth.json`, import.meta.url), JSON.stringify(p, null, 2));
  console.log(`wrote examples/${id}.neth.json`);
}
