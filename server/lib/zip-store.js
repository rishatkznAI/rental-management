const fs = require('fs');
const path = require('path');

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Seed() {
  return 0xffffffff;
}

function crc32Update(seed, buffer) {
  let crc = seed >>> 0;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function crc32Finalize(seed) {
  return (seed ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function normalizeZipPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

function buildZipArchive(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = normalizeZipPath(entry.name);
    if (!name) continue;
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const nameBuffer = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const { dosDate, dosTime } = dosDateTime(entry.mtime instanceof Date ? entry.mtime : new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    fileParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const entryCount = centralParts.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, ...centralParts, end]);
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      stream.off('drain', onDrain);
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

function localHeader({ checksum, size, nameBuffer, mtime }) {
  const { dosDate, dosTime } = dosDateTime(mtime instanceof Date ? mtime : new Date());
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  local.writeUInt16LE(0, 28);
  return local;
}

function centralHeader({ checksum, size, nameBuffer, mtime, offset }) {
  const { dosDate, dosTime } = dosDateTime(mtime instanceof Date ? mtime : new Date());
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  return central;
}

async function fileCrc32(filePath) {
  let seed = crc32Seed();
  for await (const chunk of fs.createReadStream(filePath)) {
    seed = crc32Update(seed, chunk);
  }
  return crc32Finalize(seed);
}

async function createFileEntry(filePath, zipPath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    const error = new Error('Not a regular file');
    error.code = 'ENOTFILE';
    throw error;
  }
  return {
    filePath,
    mtime: stat.mtime,
    name: zipPath,
    size: stat.size,
    checksum: await fileCrc32(filePath),
  };
}

async function buildZipArchiveFile(entries, outputPath) {
  const out = fs.createWriteStream(outputPath, { mode: 0o600 });
  const centralParts = [];
  let offset = 0;
  let entryCount = 0;

  try {
    for (const entry of entries) {
      const name = normalizeZipPath(entry.name);
      if (!name) continue;
      const nameBuffer = Buffer.from(name, 'utf8');
      const data = entry.filePath
        ? null
        : (Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8'));
      const size = entry.filePath ? entry.size : data.length;
      const checksum = entry.filePath ? entry.checksum : crc32(data);
      const mtime = entry.mtime instanceof Date ? entry.mtime : new Date();

      const local = localHeader({ checksum, size, nameBuffer, mtime });
      await writeChunk(out, local);
      await writeChunk(out, nameBuffer);
      if (entry.filePath) {
        for await (const chunk of fs.createReadStream(entry.filePath)) {
          await writeChunk(out, chunk);
        }
      } else {
        await writeChunk(out, data);
      }

      centralParts.push(centralHeader({ checksum, size, nameBuffer, mtime, offset }), nameBuffer);
      offset += local.length + nameBuffer.length + size;
      entryCount += 1;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    for (const part of centralParts) {
      await writeChunk(out, part);
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entryCount, 8);
    end.writeUInt16LE(entryCount, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(out, end);
  } catch (error) {
    out.destroy();
    throw error;
  }

  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.once('error', reject);
  });

  return fs.statSync(outputPath).size;
}

function readFileEntry(filePath, zipPath) {
  const stat = fs.statSync(filePath);
  return {
    data: fs.readFileSync(filePath),
    mtime: stat.mtime,
    name: zipPath,
    size: stat.size,
  };
}

module.exports = {
  buildZipArchiveFile,
  buildZipArchive,
  createFileEntry,
  normalizeZipPath,
  readFileEntry,
};
