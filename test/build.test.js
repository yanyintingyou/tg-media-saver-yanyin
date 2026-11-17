"use strict";
// Build verification: run scripts/build.sh and check the unpacked extension is complete.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

test("build.sh copies src/content.js into the extension", () => {
  execSync("bash scripts/build.sh", { cwd: ROOT, stdio: "pipe" });
  const a = fs.readFileSync(path.join(ROOT, "src/content.js"));
  const b = fs.readFileSync(path.join(ROOT, "extension/content.js"));
  assert.ok(a.equals(b), "extension content must match the source of truth");
});

test("manifest is MV3, MAIN world, document_start, /k/ and /a/ only, references existing files", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  assert.equal(m.manifest_version, 3);

  const cs = m.content_scripts[0];
  assert.equal(m.content_scripts.length, 1);
  assert.equal(cs.world, "MAIN");
  assert.equal(cs.run_at, "document_start");
  assert.ok(cs.matches.every((x) => x.startsWith("https://")));
  assert.ok(cs.matches.includes("https://web.telegram.org/k/*"), "must target the /k/ client");
  assert.ok(cs.matches.includes("https://web.telegram.org/a/*"), "must target the /a/ client");
  assert.equal(m.permissions, undefined, "the extension asks for no permissions");

  for (const f of cs.js) assert.ok(exists(path.join("extension", f)), `missing ${f}`);
  for (const size of ["16", "48", "128"]) {
    const icon = m.icons[size];
    assert.ok(exists(path.join("extension", icon)), `missing icon ${icon}`);
    assert.ok(fs.statSync(path.join(ROOT, "extension", icon)).size > 0, `empty icon ${icon}`);
  }
});
