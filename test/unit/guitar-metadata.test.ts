import { describe, expect, it } from "vitest";

import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

describe("guitar preset metadata", () => {
  it("populates displayLabel and targetHz on every string while keeping core fields", () => {
    expect(guitarPresets.length).toBeGreaterThan(0);
    for (const preset of guitarPresets) {
      expect(preset.strings.length).toBe(6);
      for (const s of preset.strings) {
        expect(typeof s.id).toBe("string");
        expect(typeof s.midi).toBe("number");
        expect(typeof s.hz).toBe("number");
        expect(typeof s.displayLabel).toBe("string");
        expect(s.displayLabel).toBe(s.id);
        expect(typeof s.targetHz).toBe("number");
        expect(s.targetHz).toBeCloseTo(s.hz, 6);
        expect(s.centOffset).toBe(0);
      }
    }
  });

  it("provides standard-E gauge hints for the canonical strings", () => {
    const standard = guitarPresets.find((p) => p.id === "standard-e");
    expect(standard).toBeDefined();
    const byId = Object.fromEntries(standard!.strings.map((s) => [s.id, s]));
    expect(byId["E2"]?.gaugeHint).toBe(".046");
    expect(byId["E4"]?.gaugeHint).toBe(".010");
  });
});
