const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const zlib = require("node:zlib");

const {
  UV_VERSION,
  extractUvBinary,
  getUvAsset,
  verifySha256
} = require("../lib/uv-installer");

function writeTarText(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "ascii");
}

function createTarGz(name, content) {
  const header = Buffer.alloc(512);
  writeTarText(header, 0, 100, name);
  writeTarText(header, 100, 8, "0000755\0");
  writeTarText(header, 108, 8, "0000000\0");
  writeTarText(header, 116, 8, "0000000\0");
  writeTarText(header, 124, 12, `${content.length.toString(8).padStart(11, "0")}\0`);
  writeTarText(header, 136, 12, "00000000000\0");
  header.fill(32, 148, 156);
  header[156] = 48;
  writeTarText(header, 257, 6, "ustar\0");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const padding = Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length);
  return zlib.gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

function createStoredZip(name, content) {
  const nameBuffer = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);

  const centralOffset = local.length + nameBuffer.length + content.length;
  const centralSize = central.length + nameBuffer.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, nameBuffer, content, central, nameBuffer, eocd]);
}

test("maps major desktop targets to pinned uv release assets", () => {
  assert.equal(getUvAsset({ platform: "win32", arch: "x64" }).name, "uv-x86_64-pc-windows-msvc.zip");
  assert.equal(getUvAsset({ platform: "darwin", arch: "arm64" }).name, "uv-aarch64-apple-darwin.tar.gz");
  assert.equal(getUvAsset({ platform: "linux", arch: "x64", libc: "gnu" }).name, "uv-x86_64-unknown-linux-gnu.tar.gz");
  assert.equal(getUvAsset({ platform: "linux", arch: "arm64", libc: "musl" }).name, "uv-aarch64-unknown-linux-musl.tar.gz");
  assert.match(getUvAsset({ platform: "linux", arch: "x64", libc: "gnu" }).url, new RegExp(`/download/${UV_VERSION}/`));
});

test("rejects unsupported platform targets", () => {
  assert.throws(() => getUvAsset({ platform: "freebsd", arch: "x64" }), /Unsupported platform\/architecture/);
});

test("extracts the uv binary from a tar.gz without an external tar command", () => {
  const binary = Buffer.from("unix uv binary");
  const archive = createTarGz("uv-test-target/uv", binary);
  assert.deepEqual(extractUvBinary(archive, "uv-test-target.tar.gz", "linux"), binary);
});

test("extracts the uv executable from a zip without PowerShell or tar", () => {
  const binary = Buffer.from("windows uv binary");
  const archive = createStoredZip("uv.exe", binary);
  assert.deepEqual(extractUvBinary(archive, "uv-test-target.zip", "win32"), binary);
});

test("verifies the pinned archive checksum", () => {
  const archive = Buffer.from("archive");
  const digest = crypto.createHash("sha256").update(archive).digest("hex");
  assert.doesNotThrow(() => verifySha256(archive, digest));
  assert.throws(() => verifySha256(archive, "0".repeat(64)), /checksum mismatch/);
});
