const fs = require('fs');
const {
  crc32,
  fileRangeCrc32Sync,
  normalizeZipPath,
} = require('./zip-store');

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_END_SEARCH = 65_557;
const MAX_CENTRAL_DIRECTORY = 32 * 1024 * 1024;

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

function inspectStoredZipArchive(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 22) throw new Error('Verified backup is not a ZIP archive.');
  const fd = fs.openSync(filePath, 'r');
  try {
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
    return { filePath, size: stat.size, centralOffset, entries };
  } finally {
    fs.closeSync(fd);
  }
}

function inspectStoredZipEntryLocal(archive, name) {
  const entry = archive?.entries?.get(name);
  if (!entry) throw new Error(`Verified backup ZIP is missing ${name}.`);
  const fd = fs.openSync(archive.filePath, 'r');
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
    return { entry, dataOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function validateStoredZipEntry(archive, name) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  if (fileRangeCrc32Sync(archive.filePath, dataOffset, entry.size) !== entry.checksum) {
    throw new Error(`Verified backup ZIP entry ${name} failed CRC-32 validation.`);
  }
  return entry;
}

function readStoredZipEntry(archive, name, { maxBytes = 256 * 1024 * 1024 } = {}) {
  const { entry, dataOffset } = inspectStoredZipEntryLocal(archive, name);
  if (entry.size > maxBytes) throw new Error(`Verified backup ZIP entry ${name} exceeds the safety limit.`);
  const fd = fs.openSync(archive.filePath, 'r');
  try {
    const data = readExactly(fd, entry.size, dataOffset);
    if (crc32(data) !== entry.checksum) throw new Error(`Verified backup ZIP entry ${name} failed CRC-32 validation.`);
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
  readStoredZipEntry,
  validateStoredZipEntry,
};
