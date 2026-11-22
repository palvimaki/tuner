import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const themePath = resolve(process.cwd(), "src/ui/theme.css");

async function cssRule(selector: string): Promise<string> {
  const css = await readFile(themePath, "utf8");
  const match = css.match(new RegExp(`${selector.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`));

  if (!match) throw new Error(`Missing CSS rule for ${selector}`);
  return match[1];
}

describe("iPhone active tuner viewport", () => {
  it("anchors the HUD to the dynamic viewport and blocks document scrolling", async () => {
    const shell = await cssRule(".app-shell");
    const documentRoot = await cssRule("html,\nbody,\n#app");

    expect(shell).toMatch(/position:\s*fixed;/);
    expect(shell).toMatch(/inset:\s*0;/);
    expect(shell).toMatch(/width:\s*100%;/);
    expect(shell).toMatch(/height:\s*100vh;[\s\S]*height:\s*100dvh;/);
    expect(documentRoot).toMatch(/overflow:\s*hidden;/);
  });
});
