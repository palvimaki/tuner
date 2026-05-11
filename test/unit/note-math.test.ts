import { describe, expect, it } from "vitest";

import { centsBetween, hzFromMidi, midiToNoteName, noteNameToMidi } from "../../src/audio/note-math";

describe("note math", () => {
  it("round-trips common guitar note names", () => {
    expect(noteNameToMidi("E2")).toBe(40);
    expect(midiToNoteName(64)).toBe("E4");
    expect(hzFromMidi(45)).toBeCloseTo(110, 4);
  });

  it("computes cents deltas", () => {
    expect(centsBetween(440, 440)).toBeCloseTo(0, 6);
    expect(centsBetween(466.1637615, 440)).toBeCloseTo(100, 4);
  });
});
