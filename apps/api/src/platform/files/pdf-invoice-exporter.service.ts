import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import type {
  ExportedFile,
  InvoiceExporter,
  InvoiceExportInput,
  InvoiceSnapshotValue,
} from './invoice-exporter';

interface FontTable {
  readonly offset: number;
  readonly length: number;
}

interface ParsedFont {
  readonly bytes: Buffer;
  readonly cmap: ReadonlyMap<number, number>;
}

interface GlyphCode {
  readonly cid: number;
  readonly glyphId: number;
  readonly unicode: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 48;
const TEXT_SIZE = 11;
const LINE_HEIGHT = 19;

/**
 * Arabic presentation forms. The renderer emits visual-order glyphs because
 * a PDF content stream has no bidirectional-text algorithm of its own.
 */
const ARABIC_FORMS = new Map<number, readonly number[]>([
  [0x0622, [0xfe81, 0xfe82]],
  [0x0627, [0xfe8d, 0xfe8e]],
  [0x0628, [0xfe8f, 0xfe90, 0xfe91, 0xfe92]],
  [0x062a, [0xfe95, 0xfe96, 0xfe97, 0xfe98]],
  [0x062b, [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c]],
  [0x062c, [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0]],
  [0x062d, [0xfea1, 0xfea2, 0xfea3, 0xfea4]],
  [0x062e, [0xfea5, 0xfea6, 0xfea7, 0xfea8]],
  [0x062f, [0xfea9, 0xfeaa]],
  [0x0630, [0xfeab, 0xfeac]],
  [0x0631, [0xfead, 0xfeae]],
  [0x0632, [0xfeaf, 0xfeb0]],
  [0x0633, [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4]],
  [0x0634, [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8]],
  [0x0635, [0xfeb9, 0xfeba, 0xfebb, 0xfebc]],
  [0x0636, [0xfebd, 0xfebe, 0xfebf, 0xfec0]],
  [0x0637, [0xfec1, 0xfec2, 0xfec3, 0xfec4]],
  [0x0638, [0xfec5, 0xfec6, 0xfec7, 0xfec8]],
  [0x0639, [0xfec9, 0xfeca, 0xfecb, 0xfecc]],
  [0x063a, [0xfecd, 0xfece, 0xfecf, 0xfed0]],
  [0x0641, [0xfed1, 0xfed2, 0xfed3, 0xfed4]],
  [0x0642, [0xfed5, 0xfed6, 0xfed7, 0xfed8]],
  [0x0643, [0xfed9, 0xfeda, 0xfedb, 0xfedc]],
  [0x0644, [0xfedd, 0xfede, 0xfedf, 0xfee0]],
  [0x0645, [0xfee1, 0xfee2, 0xfee3, 0xfee4]],
  [0x0646, [0xfee5, 0xfee6, 0xfee7, 0xfee8]],
  [0x0647, [0xfee9, 0xfeea, 0xfeeb, 0xfeec]],
  [0x0648, [0xfeed, 0xfeee]],
  [0x0649, [0xfeef, 0xfef0]],
  [0x064a, [0xfef1, 0xfef2, 0xfef3, 0xfef4]],
  [0x067e, [0xfb56, 0xfb57, 0xfb58, 0xfb59]],
  [0x0686, [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d]],
  [0x0698, [0xfb8a, 0xfb8b]],
  [0x06a9, [0xfb8e, 0xfb8f, 0xfb90, 0xfb91]],
  [0x06af, [0xfb92, 0xfb93, 0xfb94, 0xfb95]],
  [0x06cc, [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff]],
]);

function readU16(bytes: Buffer, offset: number): number {
  return bytes.readUInt16BE(offset);
}

function readU32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset);
}

function requireRange(bytes: Buffer, offset: number, length: number, context: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Vazirmatn ${context} table is invalid`);
  }
}

function parseCmapFormat4(bytes: Buffer, offset: number): Map<number, number> {
  const length = readU16(bytes, offset + 2);
  requireRange(bytes, offset, length, 'cmap');
  const segmentCount = readU16(bytes, offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const idDeltas = startCodes + segmentCount * 2;
  const idRangeOffsets = idDeltas + segmentCount * 2;
  const glyphs = new Map<number, number>();

  for (let index = 0; index < segmentCount; index += 1) {
    const start = readU16(bytes, startCodes + index * 2);
    const end = readU16(bytes, endCodes + index * 2);
    const delta = readU16(bytes, idDeltas + index * 2);
    const rangeOffset = readU16(bytes, idRangeOffsets + index * 2);
    if (start > end) continue;
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      if (rangeOffset === 0) {
        glyphs.set(code, (code + delta) & 0xffff);
        continue;
      }
      const glyphOffset = idRangeOffsets + index * 2 + rangeOffset + (code - start) * 2;
      requireRange(bytes, glyphOffset, 2, 'cmap glyph');
      const glyph = readU16(bytes, glyphOffset);
      glyphs.set(code, glyph === 0 ? 0 : (glyph + delta) & 0xffff);
    }
  }
  return glyphs;
}

function parseCmapFormat12(bytes: Buffer, offset: number): Map<number, number> {
  const length = readU32(bytes, offset + 4);
  requireRange(bytes, offset, length, 'cmap');
  const groupCount = readU32(bytes, offset + 12);
  const glyphs = new Map<number, number>();
  for (let index = 0; index < groupCount; index += 1) {
    const groupOffset = offset + 16 + index * 12;
    requireRange(bytes, groupOffset, 12, 'cmap group');
    const start = readU32(bytes, groupOffset);
    const end = readU32(bytes, groupOffset + 4);
    const startGlyph = readU32(bytes, groupOffset + 8);
    for (let code = start; code <= end; code += 1) {
      glyphs.set(code, startGlyph + code - start);
    }
  }
  return glyphs;
}

function parseVazirmatn(): ParsedFont {
  const fontPath = require.resolve('vazirmatn/fonts/ttf/Vazirmatn-Regular.ttf');
  const bytes = readFileSync(fontPath);
  const tableCount = readU16(bytes, 4);
  const tables = new Map<string, FontTable>();
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    requireRange(bytes, offset, 16, 'directory');
    const tag = bytes.subarray(offset, offset + 4).toString('ascii');
    tables.set(tag, { offset: readU32(bytes, offset + 8), length: readU32(bytes, offset + 12) });
  }
  const cmap = tables.get('cmap');
  if (cmap === undefined) throw new Error('Vazirmatn does not contain a cmap table');
  requireRange(bytes, cmap.offset, cmap.length, 'cmap');
  const records = readU16(bytes, cmap.offset + 2);
  let format4Offset: number | undefined;
  let format12Offset: number | undefined;
  for (let index = 0; index < records; index += 1) {
    const recordOffset = cmap.offset + 4 + index * 8;
    const subtableOffset = cmap.offset + readU32(bytes, recordOffset + 4);
    requireRange(bytes, subtableOffset, 2, 'cmap subtable');
    const format = readU16(bytes, subtableOffset);
    if (format === 12) format12Offset = subtableOffset;
    if (format === 4) format4Offset = subtableOffset;
  }
  if (format12Offset !== undefined) return { bytes, cmap: parseCmapFormat12(bytes, format12Offset) };
  if (format4Offset !== undefined) return { bytes, cmap: parseCmapFormat4(bytes, format4Offset) };
  throw new Error('Vazirmatn has no supported Unicode cmap table');
}

function joinsFromPrevious(current: number, previous: number | undefined): boolean {
  const currentForms = ARABIC_FORMS.get(current);
  const previousForms = previous === undefined ? undefined : ARABIC_FORMS.get(previous);
  return currentForms !== undefined && previousForms !== undefined && currentForms.length >= 2 && previousForms.length === 4;
}

function joinsToNext(current: number, next: number | undefined): boolean {
  return joinsFromPrevious(next ?? -1, current);
}

function shapeArabic(text: string): readonly number[] {
  const characters = [...text].map((character) => character.codePointAt(0)!);
  return characters.map((character, index) => {
    const forms = ARABIC_FORMS.get(character);
    if (forms === undefined) return character;
    const previous = characters[index - 1];
    const next = characters[index + 1];
    const previousJoin = joinsFromPrevious(character, previous);
    const nextJoin = joinsToNext(character, next);
    if (previousJoin && nextJoin && forms.length === 4) return forms[3]!;
    if (previousJoin && forms.length >= 2) return forms[1]!;
    if (nextJoin && forms.length === 4) return forms[2]!;
    return forms[0]!;
  });
}

function isLeftToRightCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0030 && codePoint <= 0x0039) ||
    (codePoint >= 0x0041 && codePoint <= 0x005a) ||
    (codePoint >= 0x0061 && codePoint <= 0x007a) ||
    (codePoint >= 0x06f0 && codePoint <= 0x06f9)
  );
}

function toRtlVisual(text: string): readonly number[] {
  const reversed = [...shapeArabic(text)].reverse();
  const result: number[] = [];
  for (let index = 0; index < reversed.length; ) {
    if (!isLeftToRightCodePoint(reversed[index]!)) {
      result.push(reversed[index]!);
      index += 1;
      continue;
    }
    const start = index;
    while (index < reversed.length && isLeftToRightCodePoint(reversed[index]!)) index += 1;
    for (let cursor = index - 1; cursor >= start; cursor -= 1) result.push(reversed[cursor]!);
  }
  return result;
}

function flattenSnapshot(
  snapshot: InvoiceSnapshotValue,
  prefix = 'snapshot',
): readonly { readonly key: string; readonly value: string }[] {
  if (snapshot === null || typeof snapshot === 'string' || typeof snapshot === 'boolean') {
    return [{ key: prefix, value: String(snapshot) }];
  }
  if (Array.isArray(snapshot)) {
    return snapshot.flatMap((value, index) => flattenSnapshot(value, `${prefix}[${index}]`));
  }
  return Object.entries(snapshot).flatMap(([key, value]) => flattenSnapshot(value, `${prefix}.${key}`));
}

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function stream(bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`, 'ascii'),
    bytes,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

class GlyphRegistry {
  private readonly glyphs: GlyphCode[] = [];

  constructor(private readonly font: ParsedFont) {}

  encode(codePoints: readonly number[]): string {
    return codePoints
      .map((unicode) => {
        const glyphId = this.font.cmap.get(unicode) ?? 0;
        const cid = this.glyphs.length + 1;
        this.glyphs.push({ cid, glyphId, unicode });
        return hex(cid, 4);
      })
      .join('');
  }

  cidToGlyphMap(): Buffer {
    const map = Buffer.alloc((this.glyphs.length + 1) * 2);
    for (const glyph of this.glyphs) map.writeUInt16BE(glyph.glyphId, glyph.cid * 2);
    return map;
  }

  toUnicodeCMap(): Buffer {
    const entries = this.glyphs.map(
      (glyph) => `<${hex(glyph.cid, 4)}> <${hex(glyph.unicode, glyph.unicode > 0xffff ? 8 : 4)}>`,
    );
    return Buffer.from(
      [
        '/CIDInit /ProcSet findresource begin',
        '12 dict begin',
        'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /VazirmatnUnicode def',
        '/CMapType 2 def',
        '1 begincodespacerange',
        '<0000> <FFFF>',
        'endcodespacerange',
        `${entries.length} begincidchar`,
        ...entries,
        'endcidchar',
        'endcmap',
        'CMapName currentdict /CMap defineresource pop',
        'end',
        'end',
      ].join('\n'),
      'ascii',
    );
  }
}

function toPdf(input: InvoiceExportInput, font: ParsedFont): Buffer {
  const details = [
    input.title,
    `شماره سند: ${input.documentNumber}`,
    `تاریخ صدور: ${input.issuedAt.toISOString()}`,
    `فروشنده: ${input.issuer.displayName}`,
    `خریدار: ${input.recipient.displayName}`,
    `مظنه قفل‌شده: ${input.lockedQuote.amountRial}`,
    `زمان مظنه: ${input.lockedQuote.observedAt.toISOString()}`,
    'اقلام:',
    ...input.lines.map(
      (line) => `${line.title} | تعداد: ${line.quantity} | مبلغ: ${line.amountRial ?? '-'}`,
    ),
    'اطلاعات تاریخی قفل‌شده:',
    ...flattenSnapshot(input.historicalSnapshot).map((entry) => `${entry.key}: ${entry.value}`),
  ];
  const registry = new GlyphRegistry(font);
  const content = details
    .slice(0, 35)
    .map((detail, index) => {
      const text = registry.encode(toRtlVisual(detail));
      const y = PAGE_HEIGHT - PAGE_MARGIN - TEXT_SIZE - index * LINE_HEIGHT;
      const estimatedWidth = Math.min(PAGE_WIDTH - PAGE_MARGIN * 2, detail.length * TEXT_SIZE * 0.62);
      const x = PAGE_WIDTH - PAGE_MARGIN - estimatedWidth;
      return `BT /F1 ${TEXT_SIZE} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${text}> Tj ET`;
    })
    .join('\n');

  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'));
  objects.set(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'));
  objects.set(
    3,
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>`,
      'ascii',
    ),
  );
  objects.set(4, stream(Buffer.from(content, 'ascii')));
  objects.set(
    6,
    Buffer.from(
      '<< /Type /Font /Subtype /Type0 /BaseFont /Vazirmatn /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 9 0 R >>',
      'ascii',
    ),
  );
  objects.set(
    7,
    Buffer.from(
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Vazirmatn /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /CIDToGIDMap 10 0 R /DW 1000 >>',
      'ascii',
    ),
  );
  objects.set(
    8,
    Buffer.from(
      '<< /Type /FontDescriptor /FontName /Vazirmatn /Flags 4 /FontBBox [0 -500 1000 1000] /Ascent 1000 /Descent -500 /CapHeight 700 /ItalicAngle 0 /StemV 80 /FontFile2 11 0 R >>',
      'ascii',
    ),
  );
  objects.set(9, stream(registry.toUnicodeCMap()));
  objects.set(10, stream(registry.cidToGlyphMap()));
  objects.set(11, stream(font.bytes));

  const header = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const parts: Buffer[] = [header];
  const offsets: number[] = [0];
  let cursor = header.length;
  for (let id = 1; id <= 11; id += 1) {
    const body = objects.get(id) ?? Buffer.from('<< >>', 'ascii');
    const object = Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'ascii'), body, Buffer.from('\nendobj\n', 'ascii')]);
    offsets[id] = cursor;
    parts.push(object);
    cursor += object.length;
  }
  const xrefOffset = cursor;
  const xref = [
    'xref',
    '0 12',
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `),
    'trailer',
    '<< /Size 12 /Root 1 0 R >>',
    'startxref',
    xrefOffset.toString(),
    '%%EOF',
  ].join('\n');
  parts.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(parts);
}

/** PDF adapter; it is intentionally isolated from every business module. */
@Injectable()
export class PdfInvoiceExporter implements InvoiceExporter {
  async exportInvoice(input: InvoiceExportInput): Promise<ExportedFile> {
    const content = toPdf(input, parseVazirmatn());
    return {
      fileName: `invoice-${input.documentNumber}.pdf`,
      contentType: 'application/pdf',
      content,
    };
  }
}
