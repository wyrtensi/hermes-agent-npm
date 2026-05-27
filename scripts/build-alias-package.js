#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  ALIAS_PACKAGE_NAME,
  getPackageBinNames
} = require("../lib/package-metadata");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist", ALIAS_PACKAGE_NAME);

function copyFile(relativePath) {
  const source = path.join(rootDir, relativePath);
  const target = path.join(distDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const relativePath of [
  "DISCLAIMER.md",
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "bin/hermes-agent.js",
  "lib/package-metadata.js",
  "lib/python-launcher.js",
  "scripts/postinstall.js"
]) {
  copyFile(relativePath);
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const aliasPackage = {
  ...rootPackage,
  name: ALIAS_PACKAGE_NAME,
  description: `Alias npm package for ${rootPackage.name}. ${rootPackage.description}`,
  bin: Object.fromEntries(
    getPackageBinNames(ALIAS_PACKAGE_NAME).map((name) => [name, "bin/hermes-agent.js"])
  ),
  scripts: {
    postinstall: "node scripts/postinstall.js"
  },
  files: [
    "bin/",
    "lib/",
    "scripts/postinstall.js",
    "DISCLAIMER.md",
    "LICENSE",
    "NOTICE",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md"
  ],
  hermesAgent: {
    ...rootPackage.hermesAgent,
    canonicalNpmPackage: rootPackage.name
  }
};

fs.writeFileSync(
  path.join(distDir, "package.json"),
  JSON.stringify(aliasPackage, null, 2) + "\n",
  "utf8"
);

console.log(`Built ${ALIAS_PACKAGE_NAME}@${aliasPackage.version} in ${distDir}`);
