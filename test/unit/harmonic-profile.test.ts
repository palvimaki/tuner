import { describe, expect, it } from "vitest";

import { scorePresetProfiles } from "../../src/audio/dsp/harmonic-profile";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";
import { makePluckSignal } from "../dsp/fixtures/signals";

describe("harmonic profiles", () => {
  it("scores the matching string above neighbors", () => {
    const preset = guitarPresets[0];
    const scores = scorePresetProfiles(makePluckSignal(110), 44_100, preset);
    expect(scores.A2).toBeGreaterThan(scores.E2);
    expect(scores.A2).toBeGreaterThan(scores.D3);
  });

  it("scores high E above lower strings with the same note name", () => {
    const preset = guitarPresets[0];
    const scores = scorePresetProfiles(
      makePluckSignal(329.628, {
        length: 2_048,
        harmonics: [0.42, 1, 0.78, 0.55, 0.34],
      }),
      44_100,
      preset,
    );

    expect(scores.E4).toBeGreaterThan(scores.E2);
    expect(scores.E4).toBeGreaterThan(scores.B3);
  });
});
