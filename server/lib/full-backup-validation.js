const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  crc32,
  crc32Finalize,
  crc32Seed,
  crc32Update,
  normalizeZipPath,
} = require('./zip-store');

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_END_SEARCH = 65_557;
const MAX_CENTRAL_DIRECTORY = 32 * 1024 * 1024;

function fileIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mtimeMs: String(stat.mtimeMs),
    ctimeMs: String(stat.ctimeMs),
  };
}

function sameFileIdentity(left, right) {
  return JSON.stringify(fileIdentity(left)) === JSON.stringify(fileIdentity(right));
}

function openBoundArchive(archive) {
  const pathState = fs.lstatSync(archive.filePath);
  if (!pathState.isFile() || pathState.isSymbolicLink() || pathState.nlink !== 1) {
    throw new Error('Verified backup ZIP path is unsafe.');
  }
  const fd = fs.openSync(archive.filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const descriptorState = fs.fstatSync(fd);
  if (
    !descriptorState.isFile()
    || descriptorState.nlink !== 1
    || !sameFileIdentity(pathState, descriptorState)
    || (archive.fileIdentity && JSON.stringify(fileIdentity(descriptorState)) !== JSON.stringify(archive.fileIdentity))
  ) {
    fs.closeSync(fd);
    throw new Error('Verified backup ZIP identity changed.');
  }
  return { fd, before: descriptorState };
}

function assertBoundArchiveUnchanged(archive, fd, before) {
  const after = fs.fstatSync(fd);
  const pathAfter = fs.lstatSync(archive.filePath);
  if (!sameFileIdentity(before, after) || !sameFileIdentity(before, pathAfter)) {
    throw new Error('Verified backup ZIP changed while reading.');
  }
}

function readExactly(fd, length, position) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error('Backup archive ended unexpectedly.');
    offset += bytesRead;
  }
  return buffer;
}

function crc32Range(fd, position, length) {
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, length)));
  let seed = crc32Seed();
  let consumed = 0;
  while (consumed < length) {
    const requested = Math.min(buffer.length, length - consumed);
    const bytesRead = fs.readSync(fd, buffer, 0, requested, position + consumed);
    if (bytesRead === 0) throw new Error('Verified backup ZIP entry ended unexpectedly.');
    seed = crc32Update(seed, buffer.subarray(0, bytesRead));
    consumed += bytesRead;
  }
  return crc32Finalize(seed);
}

function inspectStoredZipArchive(filePath) {
  const pathState = fs.lstatSync(filePath);
  if (!pathState.isFile() || pathState.isSymbolicLink() || pathState.nlink !== 1 || pathState.size < 22) {
    throw new Error('Verified backup is not a safe ZIP archive.');
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const stat = fs.fstatSync(fd);
  try {
    if (!sameFileIdentity(pathState, stat)) throw new Error('Verified backup ZIP identity changed.');
    const tailSize = Math.min(stat.size, MAX_END_SEARCH);
    const tail = readExactly(fd, tailSize, stat.size - tailSize);
    let endOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === END_SIGNATURE) {
        endOffset = index;
        break;
      }
    }
    if (endOffset < 0) throw new Error('Verified backup ZIP end record is missing.');
    const end = tail.subarray(endOffset);
    const diskNumber = end.readUInt16LE(4);
    const centralDisk = end.readUInt16LE(6);
    const entriesOnDisk = end.readUInt16LE(8);
    const entryCount = end.readUInt16LE(10);
    const centralSize = end.readUInt32LE(12);
    const centralOffset = end.readUInt32LE(16);
    const commentLength = end.readUInt16LE(20);
    const absoluteEndOffset = stat.size - tailSize + endOffset;
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error('Multi-volume backup ZIP archives are not supported.');
    }
    if (absoluteEndOffset + 22 + commentLength !== stat.size) {
      throw new Error('Verified backup ZIP has trailing or malformed data.');
    }
    if (centralSize > MAX_CENTRAL_DIRECTORY || centralOffset + centralSize !== absoluteEndOffset) {
      throw new Error('Verified backup ZIP central directory is invalid.');
    }

    const central = readExactly(fd, centralSize, centralOffset);
    const entries = new Map();
    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
        throw new Error('Verified backup ZIP contains an invalid central entry.');
      }
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const checksum = central.readUInt32LE(cursor + 16);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const size = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const entryCommentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if (next > central.length) throw new Error('Verified backup ZIP central entry is truncated.');
      const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const name = normalizeZipPath(rawName);
      if (!name || name !== rawName || entries.has(name)) throw new Error('Verified backup ZIP contains an unsafe or duplicate path.');
      if (method !== 0 || compressedSize !== size || (flags & 0x0008) !== 0) {
        throw new Error('Verified backup ZIP must use deterministic stored entries.');
      }
      if (localOffset + 30 > centralOffset) throw new Error('Verified backup ZIP local entry offset is invalid.');
      entries.set(name, { name, checksum, size, compressedSize, method, localOffset });
      cursor = next;
    }
    if (cursor !== central.length || entries.size !== entryCount) {
      throw new Error('Verified backup ZIP entry count is invalid.');
    }
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    if (!sameFileIdentity(stat, after) || !sameFileIdentity(stat, pathAfter)) {
      throw new Error('Verified backup ZIP changed while being inspected.');
    }
    return { filePath, fileIdentity: fileIdentity(after), size: stat.size, centralOffset, entries };
  } finally {
    fs.closeSync(fd);
  }
}

function inspectStoredZipEntryLocal(archive, name) {
  const entry = archive?.entries?.get(name);
  if (!entry) throw new Error(`Verified backup ZIP is missing ${name}.`);
  const { fd, before } = openBoundArchive(archive);
  try {
    const local = readExactly(fd, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`Verified backup ZIP local entry ${name} is invalid.`);
    const flags = local.readUInt16LE(6);
    const method = local.readUInt16LE(8);
    const checksum = local.readUInt32LE(14);
    const compressedSize = local.readUInt32LE(18);
    const size = local.readUInt32LE(22);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const rawName = readExactly(fd, nameLength, entry.localOffset + 30).toString('utf8');
    if (rawName !== name || flags !== 0x0800 || method !== 0 || checksum !== entry.checksum
      || compressedSize !== entry.compressedSize || size !== entry.size) {
      throw new Error(`Verified backup ZIP local entry ${name} does not match its directory record.`);
    }
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    if (!Number.isSafeInteger(dataOffset) || dataOffset < 0 || dataOffset + entry.size > archive.centralOffset) {
      throw new Error(`Verified backup ZIP local entry ${name} overlaps the central directory.`);
    }
    assertBoundArchiveUnchanged(archive, fd, before);
    return { entry, dataOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function hashStoredZipEntry(archive, name) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  const { fd, before } = openBoundArchive(archive);
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, entry.size)));
  let position = 0;
  try {
    while (position < entry.size) {
      const requested = Math.min(buffer.length, entry.size - position);
      const bytesRead = fs.readSync(fd, buffer, 0, requested, dataOffset + position);
      if (bytesRead === 0) throw new Error(`Verified backup ZIP entry ${name} ended unexpectedly.`);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    assertBoundArchiveUnchanged(archive, fd, before);
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function extractStoredZipEntry(archive, name, targetPath) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  validateStoredZipEntry(archive, name);
  const { fd: sourceFd, before } = openBoundArchive(archive);
  let targetFd;
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, entry.size)));
  let position = 0;
  try {
    if (typeof fs.statfsSync === 'function') {
      const filesystem = fs.statfsSync(path.dirname(targetPath));
      const available = Number(filesystem.bavail) * Number(filesystem.bsize);
      if (!Number.isFinite(available) || available < entry.size + 16 * 1024 * 1024) {
        throw new Error(`Verified backup ZIP entry ${name} has insufficient extraction space.`);
      }
    }
    targetFd = fs.openSync(
      targetPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fchmodSync(targetFd, 0o600);
    while (position < entry.size) {
      const requested = Math.min(buffer.length, entry.size - position);
      const bytesRead = fs.readSync(sourceFd, buffer, 0, requested, dataOffset + position);
      if (bytesRead === 0) throw new Error(`Verified backup ZIP entry ${name} ended unexpectedly.`);
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(targetFd, buffer, written, bytesRead - written, position + written);
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    fs.fsyncSync(targetFd);
    const targetState = fs.fstatSync(targetFd);
    assertBoundArchiveUnchanged(archive, sourceFd, before);
    if (!targetState.isFile() || targetState.nlink !== 1 || targetState.size !== entry.size) {
      throw new Error(`Verified backup ZIP entry ${name} was not extracted exactly.`);
    }
    return { size: entry.size, sha256: hash.digest('hex') };
  } catch (error) {
    if (targetFd !== undefined) {
      try { fs.closeSync(targetFd); } catch { /* original error wins */ }
      targetFd = undefined;
    }
    try { fs.rmSync(targetPath, { force: true }); } catch { /* original error wins */ }
    throw error;
  } finally {
    if (targetFd !== undefined) fs.closeSync(targetFd);
    fs.closeSync(sourceFd);
  }
}

function validateStoredZipEntry(archive, name) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  const { fd, before } = openBoundArchive(archive);
  try {
    if (crc32Range(fd, dataOffset, entry.size) !== entry.checksum) {
      throw new Error(`Verified backup ZIP entry ${name} failed CRC-32 validation.`);
    }
    assertBoundArchiveUnchanged(archive, fd, before);
    return entry;
  } finally {
    fs.closeSync(fd);
  }
}

function readStoredZipEntry(archive, name, { maxBytes = 256 * 1024 * 1024 } = {}) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  if (entry.size > maxBytes) throw new Error(`Verified backup ZIP entry ${name} exceeds the safety limit.`);
  const { fd, before } = openBoundArchive(archive);
  try {
    const data = readExactly(fd, entry.size, dataOffset);
    if (crc32(data) !== entry.checksum) throw new Error(`Verified backup ZIP entry ${name} failed CRC-32 validation.`);
    assertBoundArchiveUnchanged(archive, fd, before);
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

function inspectFullBackupArchive(filePath) {
  const archive = inspectStoredZipArchive(filePath);
  const manifestBuffer = readStoredZipEntry(archive, 'manifest.json', { maxBytes: 16 * 1024 * 1024 });
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
  } catch {
    throw new Error('Verified backup manifest is not valid JSON.');
  }
  if (manifest?.appName !== 'Skytech Rental Management'
    || manifest?.database?.type !== 'sqlite'
    || manifest?.database?.includedAs !== 'database/app.sqlite'
    || !archive.entries.has('database/app.sqlite')) {
    throw new Error('Verified backup manifest does not describe a Skytech SQLite full backup.');
  }
  const skippedFilesCount = Number(manifest.skippedFilesCount ?? manifest.files?.skippedFilesCount);
  if (!Number.isSafeInteger(skippedFilesCount) || skippedFilesCount !== 0) {
    throw new Error('Verified backup is incomplete because skippedFilesCount is not zero.');
  }
  if (!manifest.counts || typeof manifest.counts !== 'object' || Array.isArray(manifest.counts)) {
    throw new Error('Verified backup manifest collection counts are missing.');
  }
  return { ...archive, manifest };
}

module.exports = {
  inspectFullBackupArchive,
  inspectStoredZipArchive,
  extractStoredZipEntry,
  hashStoredZipEntry,
  readStoredZipEntry,
  validateStoredZipEntry,
};
