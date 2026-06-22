import { describe, expect, it } from "vitest";

import { centsBetween, hzFromMidi, midiToNoteName, noteNameToMidi } from "../../src/audio/note-math";
import { instrumentRegistry } from "../../src/app/registry";
import { nearestPresetStringByLogDistance } from "../../src/app/state";
import { resolveStringTargetHz } from "../../src/domain/instrument";

// Regression for Founder bug report: "all tunings are half step too low".
// Feed exact, correctly-tuned reference frequencies through the
// frequency -> note / nearest-string logic and assert the displayed
// target is the SAME note (≈0 cents), not a semitone flat.

const CASES: Array<{ hz: number; note: string; midi: number }> = [
  { hz: 440.0, note: "A4", midi: 69 },
  { hz: 329.6276, note: "E4", midi: 64 },
  { hz: 82.4069, note: "E2", midi: 40 },
  { hz: 110.0, note: "A2", midi: 45 },
];

describe("semitone-flat regression", () => {
  it("frequency<->MIDI<->note round-trips at standard pitch (A4=440)", () => {
    for (const c of CASES) {
      expect(noteNameToMidi(c.note)).toBe(c.midi);
      expect(hzFromMidi(c.midi)).toBeCloseTo(c.hz, 1);
      expect(midiToNoteName(c.midi)).toBe(c.note);
    }
  });

  it("a perfectly-tuned string reads ~0 cents against its own target (not -100)", () => {
    const guitar = instrumentRegistry.guitar;
    const standard = guitar.presets.find((p) => p.id === "standard-e");
    expect(standard).toBeTruthy();
    if (!standard) return;

    // Play exactly the open E4 / E2 / A2 reference pitches.
    for (const id of ["E2", "A2", "E4"]) {
      const def = standard.strings.find((s) => s.id === id);
      expect(def, `string ${id} present`).toBeTruthy();
      if (!def) continue;
      const targetHz = resolveStringTargetHz(def);
      const playedHz = hzFromMidi(noteNameToMidi(id));
      const cents = centsBetween(playedHz, targetHz);
      // A semitone-flat bug would surface here as ≈ -100 cents.
      expect(Math.abs(cents)).toBeLessThan(1);

      // And the nearest string to the played pitch must be the same string,
      // not the one a semitone below.
      const nearest = nearestPresetStringByLogDistance(playedHz, standard);
      expect(nearest.id).toBe(id);
    }
  });
});
