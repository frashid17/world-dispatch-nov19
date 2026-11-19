// Node 22, standard library only. Validates the bundled image and writes it to
// MAKEFUN_OUTPUT_DIR (default /output) as entry.png, byte for byte.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1048576;
const MAX_DIMENSION = 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_CHUNK = Buffer.from('0000000049454e44ae426082', 'hex');
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

function fail(message) {
  throw new Error(`entry.png: ${message}`);
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail('not a PNG');
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    fail('missing IHDR chunk');
  }
  if (!bytes.subarray(-12).equals(PNG_IEND_CHUNK)) {
    fail('missing or incomplete IEND end chunk');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    fail(`dimensions ${width}x${height} outside 1..${MAX_DIMENSION}`);
  }
  return { width, height };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || !bytes.subarray(0, 2).equals(JPEG_SOI)) {
    fail('not a JPEG');
  }
  if (!bytes.subarray(-2).equals(JPEG_EOI)) {
    fail('missing EOI end marker');
  }
  const end = bytes.length - 2;
  let offset = 2;
  while (offset + 3 <= end) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff && offset < end) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd9) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > end) {
      fail('truncated segment length');
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > end) {
      fail('segment overruns the end of the image');
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) {
        fail('truncated SOF frame header');
      }
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        fail(`dimensions ${width}x${height} outside 1..${MAX_DIMENSION}`);
      }
      return { width, height };
    }
    offset += length;
  }
  fail('missing SOF frame header before end of image');
}

function validate(bytes) {
  if (bytes.length === 0) {
    fail('empty file');
  }
  if (bytes.length > MAX_BYTES) {
    fail(`${bytes.length} bytes exceeds ${MAX_BYTES}`);
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return pngDimensions(bytes);
  }
  if (bytes.subarray(0, 2).equals(JPEG_SOI)) {
    return jpegDimensions(bytes);
  }
  fail('neither PNG nor JPEG');
}

function main() {
  const image = readFileSync(new URL('./entry.png', import.meta.url));
  const { width, height } = validate(image);
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'entry.png'), image);
  console.log(`wrote entry.png (${image.length} bytes, ${width}x${height}) to ${outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
