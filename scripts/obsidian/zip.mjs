/**
 * A minimal ZIP writer. Files are stored uncompressed, which every unzip tool and operating system can read, and
 * keeps the module free of dependencies. File names are written as UTF-8 so accented note names survive.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for ( let n = 0; n < 256; n++ ) {
    let c = n;
    for ( let k = 0; k < 8; k++ ) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for ( const b of bytes ) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * The current time in the MS-DOS format ZIP files use.
 * @returns {{time: number, date: number}}
 */
function dosDateTime() {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/**
 * Build a ZIP archive.
 * @param {{path: string, data: Uint8Array}[]} files  Paths use "/" separators.
 * @returns {Blob}
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime();
  const UTF8_FLAG = 0x0800;
  const parts = [];
  const central = [];
  let offset = 0;

  for ( const { path, data } of files ) {
    const name = encoder.encode(path);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // Local file header signature
    local.setUint16(4, 20, true);            // Version needed to extract
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true);             // Compression: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);  // Compressed size
    local.setUint32(22, data.length, true);  // Uncompressed size
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);   // Central directory header signature
    entry.setUint16(4, 20, true);            // Version made by
    entry.setUint16(6, 20, true);            // Version needed to extract
    entry.setUint16(8, UTF8_FLAG, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);       // Offset of the local header
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // End of central directory signature
  end.setUint16(8, files.length, true);     // Entries on this disk
  end.setUint16(10, files.length, true);    // Total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);          // Offset of the central directory
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/**
 * Offer a blob to the user as a download.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  Object.assign(a, { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
