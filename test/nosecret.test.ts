/**
 * D3 · no static token in the bundle. The source must not even NAME the two
 * variables that used to carry one (vite.config refuses a build that sets
 * them); every credential the SPA sends is the signed-in user's ID token.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|css|html)$/.test(f) ? [p] : [];
});

describe("D3 · the source names no static token", () => {
  it("VITE_SPREAD_API_TOKEN / VITE_INGEST_TOKEN appear nowhere under src/", () => {
    const hits = walk("src").filter((p) => /VITE_SPREAD_API_TOKEN|VITE_INGEST_TOKEN/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
  it("the only Authorization header the client builds comes from idToken()", () => {
    const client = readFileSync("src/api/client.ts", "utf8");
    const bearers = client.match(/Bearer \$\{[^}]+\}/g) || [];
    expect(bearers).toEqual(["Bearer ${t}"]);
    expect(client).toMatch(/const t = await idToken\(force\)/);
  });
});
