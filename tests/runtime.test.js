import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const requireFromHere = createRequire(import.meta.url);

describe("runtime guard — Bun must not be present", () => {
  it("runs under Node.js 22+ and not under Bun", () => {
    expect(process.versions.node).toBeDefined();

    const major = Number.parseInt(process.versions.node.split(".")[0], 10);
    expect(major).toBeGreaterThanOrEqual(22);

    expect(process.versions.bun).toBeUndefined();
  });

  it("resolves @sentry/node and not @sentry/bun", () => {
    expect(() => requireFromHere("@sentry/node")).not.toThrow();

    expect(() => requireFromHere("@sentry/bun")).toThrow(/Cannot find module|MODULE_NOT_FOUND/);
  });

  it("package.json declares engines.node and no Bun anywhere", () => {
    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.engines.bun).toBeUndefined();

    const bunToken = /\bbun\b/;
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      expect(bunToken.test(cmd), `script "${name}" still references bun: ${cmd}`).toBe(false);
    }

    expect(pkg.dependencies?.["@sentry/bun"]).toBeUndefined();
    expect(pkg.dependencies?.["@sentry/node"]).toBeDefined();
  });
});
