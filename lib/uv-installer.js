const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const UV_VERSION = "0.12.2";
const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024;
const MAX_EXTRACTED_SIZE = 256 * 1024 * 1024;

const UV_ASSET_SHA256 = Object.freeze({
  "uv-aarch64-apple-darwin.tar.gz": "fa909fea3bc06f460db79017030a221fdbc43ec4478f089cb554d8335c090817",
  "uv-aarch64-pc-windows-msvc.zip": "dccc2bb7724c015f2a82467dee5bf4b2353a3fcdbfdfb30e0f93cdf5db2dd1df",
  "uv-aarch64-unknown-linux-gnu.tar.gz": "19b7f1f66895261fbaa07f8ea91da0f86337ad4e47efa594e87641c1718ffc52",
  "uv-aarch64-unknown-linux-musl.tar.gz": "73b87f0d65d7dfcd39753a51ce65592360b02c29f8e1bc2c85cc4190fe914499",
  "uv-arm-unknown-linux-musleabihf.tar.gz": "4e27dfadda93c82dd85c2de29b7fd6417ea74c430bfbc52833ea9580c8c16d04",
  "uv-armv7-unknown-linux-gnueabihf.tar.gz": "0536e78e9796394fa135102c7500f24a291aaf9fbf129b70add472b6dcf42a4b",
  "uv-armv7-unknown-linux-musleabihf.tar.gz": "5e10ffda5760511a16c0d5a9b2c28ebaed864dfa34e73fddcf0f600cf125cfee",
  "uv-i686-pc-windows-msvc.zip": "e2037092f25370ecbd8827b1d91650a9fbf002548ae647aea39073c6bbe45384",
  "uv-i686-unknown-linux-gnu.tar.gz": "659b83b91a329a6bf5fbb412ea61262640b9bf15f07b6208334bd7a379c0dbf0",
  "uv-i686-unknown-linux-musl.tar.gz": "b57cc4b2bd5e1cc20253222add0d377a5398c2bafc93611bd2a4438ac8e21f9c",
  "uv-powerpc64le-unknown-linux-gnu.tar.gz": "0e135c0fddbd303297a847016ea3cb60fdacebed20bd87200a3537cfb67d4d46",
  "uv-riscv64gc-unknown-linux-gnu.tar.gz": "cc348cecc84695394721e2fc1e0c4fd5b9a052d4eeeba57b194929c719d5681e",
  "uv-riscv64gc-unknown-linux-musl.tar.gz": "a0e9a9d99e0f2cc39b645aecdabe27e308074b1d3dc2afdd507433528c97e701",
  "uv-s390x-unknown-linux-gnu.tar.gz": "78797ad74c948950181b607be0989b1d5926a2096d81def4238192c95ff47aeb",
  "uv-x86_64-apple-darwin.tar.gz": "a6e6506a9109801222d65d17461abf4ed13bdecc5d2b13af0495418a82972c6b",
  "uv-x86_64-pc-windows-msvc.zip": "01442d8ce5c7124151a73e697c836d252c6da853c18c73206d3cc4c2378a91d2",
  "uv-x86_64-unknown-linux-gnu.tar.gz": "d66e96b5f1ca3b99806eee283a8125d33a0bd669e6e6d9bc4ab7ffda63c41bf4",
  "uv-x86_64-unknown-linux-musl.tar.gz": "2dbe8209c9592f6d1009b8565f4bf29813427907bee2236023c013101ede343f"
});

function detectLinuxLibc() {
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
}

function getUvAsset(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const libc = options.libc || (platform === "linux" ? detectLinuxLibc() : undefined);
  const armVersion = Number(options.armVersion || process.config?.variables?.arm_version || 7);
  const endianness = options.endianness || process.config?.variables?.node_byteorder || "little";

  let target;
  if (platform === "win32") {
    target = { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc", ia32: "i686-pc-windows-msvc" }[arch];
  } else if (platform === "darwin") {
    target = { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" }[arch];
  } else if (platform === "linux") {
    const linuxTargets = {
      x64: `x86_64-unknown-linux-${libc}`,
      arm64: `aarch64-unknown-linux-${libc}`,
      ia32: `i686-unknown-linux-${libc}`,
      riscv64: `riscv64gc-unknown-linux-${libc}`,
      s390x: libc === "gnu" ? "s390x-unknown-linux-gnu" : undefined,
      ppc64: libc === "gnu" && endianness === "little" ? "powerpc64le-unknown-linux-gnu" : undefined,
      arm: armVersion >= 7 ? `armv7-unknown-linux-${libc}eabihf` : libc === "musl" ? "arm-unknown-linux-musleabihf" : undefined
    };
    target = linuxTargets[arch];
  }

  if (!target) {
    throw new Error(`Unsupported platform/architecture: ${platform}/${arch}${libc ? `/${libc}` : ""}`);
  }

  const extension = platform === "win32" ? ".zip" : ".tar.gz";
  const name = `uv-${target}${extension}`;
  const sha256 = UV_ASSET_SHA256[name];
  if (!sha256) {
    throw new Error(`No pinned checksum for uv asset: ${name}`);
  }

  return {
    name,
    sha256,
    url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`
  };
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid zip archive: end-of-central-directory record not found");
}

function extractFromZip(archive, expectedName) {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip archive: central-directory entry not found");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const fileName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (path.posix.basename(fileName) === expectedName) {
      if ((flags & 1) !== 0) throw new Error("Encrypted zip entries are not supported");
      if (uncompressedSize > MAX_EXTRACTED_SIZE) throw new Error("uv executable exceeds the extraction size limit");
      if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error("Invalid zip archive: local file header not found");
      }
      const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      const extracted = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? zlib.inflateRawSync(compressed, { maxOutputLength: MAX_EXTRACTED_SIZE })
          : null;
      if (!extracted) throw new Error(`Unsupported zip compression method: ${method}`);
      if (extracted.length !== uncompressedSize) throw new Error("Invalid zip archive: extracted size mismatch");
      return extracted;
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`${expectedName} was not found in the uv zip archive`);
}

function readTarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return buffer.subarray(start, boundedEnd).toString("utf8");
}

function extractFromTarGz(archive, expectedName) {
  const tar = zlib.gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED_SIZE });
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(header, 124, 12).trim().replace(/\0.*$/u, "");
    const size = Number.parseInt(sizeText || "0", 8);
    const type = header[156];
    if (!Number.isFinite(size)) throw new Error("Invalid tar archive: invalid entry size");

    const dataOffset = offset + 512;
    if ((type === 0 || type === 48) && path.posix.basename(fullName) === expectedName) {
      return Buffer.from(tar.subarray(dataOffset, dataOffset + size));
    }

    offset = dataOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error(`${expectedName} was not found in the uv tar archive`);
}

function extractUvBinary(archive, assetName, platform = process.platform) {
  const expectedName = platform === "win32" ? "uv.exe" : "uv";
  return assetName.endsWith(".zip")
    ? extractFromZip(archive, expectedName)
    : extractFromTarGz(archive, expectedName);
}

function verifySha256(buffer, expectedSha256) {
  const actualSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`uv archive checksum mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
}

async function downloadAsset(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "hermes-agent-npm" },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) {
    throw new Error(`Failed to download uv: HTTP ${response.status} ${response.statusText}`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_ARCHIVE_SIZE) {
    throw new Error(`uv archive exceeds the ${MAX_ARCHIVE_SIZE}-byte download limit`);
  }
  if (!response.body) throw new Error("Failed to download uv: response body is empty");

  const chunks = [];
  const reader = response.body.getReader();
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > MAX_ARCHIVE_SIZE) {
      await reader.cancel();
      throw new Error(`uv archive exceeds the ${MAX_ARCHIVE_SIZE}-byte download limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalLength);
}

function getUvExecutable(packageRoot, platform = process.platform) {
  return path.join(packageRoot, ".uv_bin", platform === "win32" ? "uv.exe" : "uv");
}

async function ensureUv(packageRoot) {
  const asset = getUvAsset();
  const uvDir = path.join(packageRoot, ".uv_bin");
  const executable = getUvExecutable(packageRoot);
  const markerPath = path.join(uvDir, "install.json");

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker.version === UV_VERSION && marker.asset === asset.name && marker.sha256 === asset.sha256 && fs.existsSync(executable)) {
      return executable;
    }
  } catch {
    // A missing or invalid marker causes a clean reinstall of the pinned binary.
  }

  console.log(`Downloading uv ${UV_VERSION} for ${process.platform}/${process.arch}...`);
  const archive = await downloadAsset(asset.url);
  verifySha256(archive, asset.sha256);
  const binary = extractUvBinary(archive, asset.name);

  fs.mkdirSync(uvDir, { recursive: true });
  const temporaryExecutable = `${executable}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryExecutable, binary, { mode: 0o755 });
    fs.chmodSync(temporaryExecutable, 0o755);
    fs.rmSync(executable, { force: true });
    fs.renameSync(temporaryExecutable, executable);
    fs.writeFileSync(markerPath, `${JSON.stringify({ version: UV_VERSION, asset: asset.name, sha256: asset.sha256 }, null, 2)}\n`, "utf8");
  } finally {
    fs.rmSync(temporaryExecutable, { force: true });
  }

  return executable;
}

module.exports = {
  UV_ASSET_SHA256,
  UV_VERSION,
  ensureUv,
  extractUvBinary,
  getUvAsset,
  getUvExecutable,
  verifySha256
};
