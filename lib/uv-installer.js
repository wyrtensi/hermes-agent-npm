const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const UV_VERSION = "0.12.13";
const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024;
const MAX_EXTRACTED_SIZE = 256 * 1024 * 1024;

const UV_ASSET_SHA256 = Object.freeze({
  "uv-aarch64-apple-darwin.tar.gz": "7e6ddb9316acc00f2296c82ff4d99977870ee34b2f0ddcae9444d714db9364ed",
  "uv-aarch64-pc-windows-msvc.zip": "1efb2654b06e7063d4ac1fc9d49a9bda9a6704d82f035b589a2751a592f14151",
  "uv-aarch64-unknown-linux-gnu.tar.gz": "2eaa5d94f5db7b3a1a092156b9420459e42ab0217d917fe74a876309cef9b5e9",
  "uv-aarch64-unknown-linux-musl.tar.gz": "f44bc1037a17889fe562fffd2002d4ed108e499fbe68b4f022af244dc7b8244f",
  "uv-arm-unknown-linux-musleabihf.tar.gz": "2c7644f891edcf1e74a1b9dde96ea4ba00b41301c936c87e843683656703ada2",
  "uv-armv7-unknown-linux-gnueabihf.tar.gz": "19252c4d21fce112817b9e07bef6b2e9c90cef80fe82659533105b37a772d067",
  "uv-armv7-unknown-linux-musleabihf.tar.gz": "54e2c10e4e6c18a3efbac645ea02d7e6b768ae2f975275595915a7039e802b75",
  "uv-i686-pc-windows-msvc.zip": "4ddcdf859d3bd337a156a2fc567e685e4b3d61e07b4a2dbbed7aeb4325e116ac",
  "uv-i686-unknown-linux-gnu.tar.gz": "beb56f6eda61bc69a8acc1bca07929365aa5cd2e912e35c35003a45e266d8a0e",
  "uv-i686-unknown-linux-musl.tar.gz": "6c93a9703b6145266240cb2aeb31d3574c21b33570fddf92461707b906eb3a65",
  "uv-powerpc64le-unknown-linux-gnu.tar.gz": "cd45ac73fc711e717602a4dc0c9e19d9c6563d15b14515a9a5dd49b00172a8b6",
  "uv-riscv64gc-unknown-linux-gnu.tar.gz": "ff1fb4d7e4c1d3a4acc6eff69b2530e846964260469df345e0239059517c0a21",
  "uv-riscv64gc-unknown-linux-musl.tar.gz": "b88312b410c1183e33ae9fa7738f35b7cd7396b2aa0e82836d7e88dbf23e5fb5",
  "uv-s390x-unknown-linux-gnu.tar.gz": "d41e4784c2187c76970690a9e9a288231f5ec8d2160ad8464be74aa9c06717e8",
  "uv-x86_64-apple-darwin.tar.gz": "5e287ef61cb6a9b61b3a83fef124fd143e400468a7dac794230147a810e17119",
  "uv-x86_64-pc-windows-msvc.zip": "a86c9dc7bad9b03f388583b7187c05fe9951c2e0d392217e8fd43d97787f6ec2",
  "uv-x86_64-unknown-linux-gnu.tar.gz": "745765a3b6e360ad76743599ae5c42e9278c7edf8bbff9fc76d05bf2623a04dd",
  "uv-x86_64-unknown-linux-musl.tar.gz": "4e2bfd0c9007b1032a50e539e965fd0a6037d87ad93ae1580d220a92d4c94098"
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
    headers: { "User-Agent": "nastech-agent-npm" },
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
