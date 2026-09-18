import { ConversionError } from "./errors.js";

export interface GlyphMetrics {
  name: string;
  /** PostScript character code, or -1 if the glyph is not encoded in this font's base encoding. */
  code: number;
  width: number;
  bbox?: [number, number, number, number];
}

export interface KerningPair {
  first: string;
  second: string;
  /** Horizontal adjustment in glyph space units, applied when `second` follows `first`. */
  amount: number;
}

export interface FontMetrics {
  fontName: string;
  fullName?: string;
  familyName?: string;
  weight?: string;
  italicAngle: number;
  isFixedPitch: boolean;
  unitsPerEm: number;
  ascender?: number;
  descender?: number;
  capHeight?: number;
  xHeight?: number;
  glyphs: GlyphMetrics[];
  kerningPairs?: KerningPair[];
}

/**
 * Parses an Adobe Font Metrics (AFM) file into a FontMetrics record.
 *
 * AFM is line-oriented, so every error below can point at an exact line and,
 * for the packed "C ... ; WX ... ; N ... ;" char metrics lines, an exact
 * column within that line.
 */
export function parseAfm(source: string): FontMetrics {
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let fontName: string | undefined;
  let fullName: string | undefined;
  let familyName: string | undefined;
  let weight: string | undefined;
  let italicAngle = 0;
  let isFixedPitch = false;
  let ascender: number | undefined;
  let descender: number | undefined;
  let capHeight: number | undefined;
  let xHeight: number | undefined;
  const glyphs: GlyphMetrics[] = [];
  const kerningPairs: KerningPair[] = [];

  let sawStart = false;
  let sawEnd = false;
  let inCharMetrics = false;
  let expectedGlyphCount: number | null = null;
  let startCharMetricsLine = 0;
  let inKernPairs = false;
  let expectedKernPairCount: number | null = null;
  let startKernPairsLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed === "EndCharMetrics") {
      inCharMetrics = false;
      continue;
    }

    if (inCharMetrics) {
      glyphs.push(parseCharMetricsLine(line, lineNumber));
      continue;
    }

    if (trimmed.startsWith("StartCharMetrics")) {
      const parts = trimmed.split(/\s+/);
      const count = Number(parts[1]);
      if (parts.length < 2 || Number.isNaN(count)) {
        throw new ConversionError(
          'StartCharMetrics must be followed by a glyph count',
          lineNumber,
          1,
          line,
        );
      }
      expectedGlyphCount = count;
      startCharMetricsLine = lineNumber;
      inCharMetrics = true;
      continue;
    }

    if (trimmed === "EndKernPairs") {
      inKernPairs = false;
      continue;
    }

    if (inKernPairs) {
      kerningPairs.push(parseKernPairLine(line, lineNumber));
      continue;
    }

    if (trimmed.startsWith("StartKernPairs")) {
      const parts = trimmed.split(/\s+/);
      const count = Number(parts[1]);
      if (parts.length < 2 || Number.isNaN(count)) {
        throw new ConversionError(
          'StartKernPairs must be followed by a pair count',
          lineNumber,
          1,
          line,
        );
      }
      expectedKernPairCount = count;
      startKernPairsLine = lineNumber;
      inKernPairs = true;
      continue;
    }

    if (trimmed === "EndFontMetrics") {
      sawEnd = true;
      continue;
    }

    if (trimmed.startsWith("StartFontMetrics")) {
      sawStart = true;
      continue;
    }

    const header = parseHeaderLine(line);
    if (!header) {
      continue;
    }

    const valueColumn = valueColumnOf(line, header.key, header.value);

    switch (header.key) {
      case "FontName":
        fontName = header.value;
        break;
      case "FullName":
        fullName = header.value;
        break;
      case "FamilyName":
        familyName = header.value;
        break;
      case "Weight":
        weight = header.value;
        break;
      case "ItalicAngle":
        italicAngle = parseNumberField(header.value, "ItalicAngle", lineNumber, valueColumn, line);
        break;
      case "IsFixedPitch": {
        const v = header.value.toLowerCase();
        if (v !== "true" && v !== "false") {
          throw new ConversionError(
            `IsFixedPitch must be "true" or "false", got "${header.value}"`,
            lineNumber,
            valueColumn,
            line,
          );
        }
        isFixedPitch = v === "true";
        break;
      }
      case "Ascender":
        ascender = parseNumberField(header.value, "Ascender", lineNumber, valueColumn, line);
        break;
      case "Descender":
        descender = parseNumberField(header.value, "Descender", lineNumber, valueColumn, line);
        break;
      case "CapHeight":
        capHeight = parseNumberField(header.value, "CapHeight", lineNumber, valueColumn, line);
        break;
      case "XHeight":
        xHeight = parseNumberField(header.value, "XHeight", lineNumber, valueColumn, line);
        break;
      default:
        // Unrecognized keys (Comment, Notice, vendor extensions, ...) are
        // legal in AFM and are simply not represented in our model.
        break;
    }
  }

  if (!sawStart) {
    throw new ConversionError('missing "StartFontMetrics" header', 1, 1);
  }
  if (!sawEnd) {
    throw new ConversionError('missing "EndFontMetrics" trailer', lines.length, 1);
  }
  if (!fontName) {
    throw new ConversionError('missing required "FontName" field', 1, 1);
  }
  if (expectedGlyphCount !== null && glyphs.length !== expectedGlyphCount) {
    throw new ConversionError(
      `StartCharMetrics declared ${expectedGlyphCount} glyphs but ${glyphs.length} were found`,
      startCharMetricsLine,
      1,
    );
  }
  if (expectedKernPairCount !== null && kerningPairs.length !== expectedKernPairCount) {
    throw new ConversionError(
      `StartKernPairs declared ${expectedKernPairCount} pairs but ${kerningPairs.length} were found`,
      startKernPairsLine,
      1,
    );
  }

  return {
    fontName,
    fullName,
    familyName,
    weight,
    italicAngle,
    isFixedPitch,
    unitsPerEm: 1000,
    ascender,
    descender,
    capHeight,
    xHeight,
    glyphs,
    kerningPairs: kerningPairs.length > 0 ? kerningPairs : undefined,
  };
}

export function toAfm(metrics: FontMetrics): string {
  const lines: string[] = [];
  lines.push("StartFontMetrics 4.1");
  lines.push(`FontName ${metrics.fontName}`);
  if (metrics.fullName) lines.push(`FullName ${metrics.fullName}`);
  if (metrics.familyName) lines.push(`FamilyName ${metrics.familyName}`);
  if (metrics.weight) lines.push(`Weight ${metrics.weight}`);
  lines.push(`ItalicAngle ${metrics.italicAngle}`);
  lines.push(`IsFixedPitch ${metrics.isFixedPitch}`);
  if (metrics.ascender !== undefined) lines.push(`Ascender ${metrics.ascender}`);
  if (metrics.descender !== undefined) lines.push(`Descender ${metrics.descender}`);
  if (metrics.capHeight !== undefined) lines.push(`CapHeight ${metrics.capHeight}`);
  if (metrics.xHeight !== undefined) lines.push(`XHeight ${metrics.xHeight}`);
  lines.push(`StartCharMetrics ${metrics.glyphs.length}`);
  for (const glyph of metrics.glyphs) {
    const bbox = glyph.bbox ? ` B ${glyph.bbox.join(" ")} ;` : "";
    lines.push(`C ${glyph.code} ; WX ${glyph.width} ; N ${glyph.name} ;${bbox}`);
  }
  lines.push("EndCharMetrics");
  if (metrics.kerningPairs && metrics.kerningPairs.length > 0) {
    lines.push("StartKernData");
    lines.push(`StartKernPairs ${metrics.kerningPairs.length}`);
    for (const pair of metrics.kerningPairs) {
      lines.push(`KPX ${pair.first} ${pair.second} ${pair.amount}`);
    }
    lines.push("EndKernPairs");
    lines.push("EndKernData");
  }
  lines.push("EndFontMetrics");
  return lines.join("\n") + "\n";
}

function parseHeaderLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const spaceIndex = trimmed.search(/\s/);
  if (spaceIndex === -1) {
    return { key: trimmed, value: "" };
  }
  return { key: trimmed.slice(0, spaceIndex), value: trimmed.slice(spaceIndex + 1).trim() };
}

function valueColumnOf(line: string, key: string, value: string): number {
  const keyIndex = line.indexOf(key);
  const searchFrom = keyIndex >= 0 ? keyIndex + key.length : 0;
  const valueIndex = value.length > 0 ? line.indexOf(value, searchFrom) : searchFrom;
  return Math.max(valueIndex, 0) + 1;
}

function parseNumberField(
  value: string,
  fieldName: string,
  lineNumber: number,
  column: number,
  line: string,
): number {
  const n = Number(value);
  if (value.trim().length === 0 || Number.isNaN(n)) {
    throw new ConversionError(`${fieldName} "${value}" is not a number`, lineNumber, column, line);
  }
  return n;
}

/** Splits a line on a separator while tracking the character offset each piece started at. */
function splitWithOffsets(line: string, separator: string): { text: string; start: number }[] {
  const pieces: { text: string; start: number }[] = [];
  let start = 0;
  let index = line.indexOf(separator, start);
  while (index !== -1) {
    pieces.push({ text: line.slice(start, index), start });
    start = index + separator.length;
    index = line.indexOf(separator, start);
  }
  pieces.push({ text: line.slice(start), start });
  return pieces;
}

function parseCharMetricsLine(line: string, lineNumber: number): GlyphMetrics {
  let code: number | undefined;
  let width: number | undefined;
  let name: string | undefined;
  let bbox: [number, number, number, number] | undefined;

  for (const segment of splitWithOffsets(line, ";")) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const leadingWhitespace = segment.text.length - segment.text.trimStart().length;
    const fieldStart = segment.start + leadingWhitespace;
    const parts = trimmed.split(/\s+/);
    const key = parts[0];

    switch (key) {
      case "C": {
        if (parts.length < 2) {
          throw new ConversionError('missing character code after "C"', lineNumber, fieldStart + 1, line);
        }
        const value = Number(parts[1]);
        if (!Number.isInteger(value)) {
          const column = fieldStart + trimmed.indexOf(parts[1]) + 1;
          throw new ConversionError(`character code "${parts[1]}" is not an integer`, lineNumber, column, line);
        }
        code = value;
        break;
      }
      case "WX": {
        if (parts.length < 2) {
          throw new ConversionError('missing width after "WX"', lineNumber, fieldStart + 1, line);
        }
        const value = Number(parts[1]);
        if (Number.isNaN(value)) {
          const column = fieldStart + trimmed.indexOf(parts[1]) + 1;
          throw new ConversionError(`width "${parts[1]}" is not a number`, lineNumber, column, line);
        }
        width = value;
        break;
      }
      case "N": {
        if (parts.length < 2) {
          throw new ConversionError('missing glyph name after "N"', lineNumber, fieldStart + 1, line);
        }
        name = parts[1];
        break;
      }
      case "B": {
        const numbers = parts.slice(1).map(Number);
        if (numbers.length !== 4 || numbers.some((n) => Number.isNaN(n))) {
          throw new ConversionError(
            "B (bounding box) requires exactly 4 numbers",
            lineNumber,
            fieldStart + 1,
            line,
          );
        }
        bbox = [numbers[0], numbers[1], numbers[2], numbers[3]];
        break;
      }
      default:
        // Ligature (L) and other extension fields are legal but not modeled.
        break;
    }
  }

  if (code === undefined || width === undefined || name === undefined) {
    throw new ConversionError(
      "char metrics line is missing one of the required fields C, WX, N",
      lineNumber,
      1,
      line,
    );
  }

  return { code, width, name, bbox };
}

/** Splits a line on whitespace while tracking the column each token started at. */
function tokenizeWithColumns(line: string): { text: string; column: number }[] {
  const tokens: { text: string; column: number }[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    tokens.push({ text: match[0], column: match.index + 1 });
  }
  return tokens;
}

function parseKernPairLine(line: string, lineNumber: number): KerningPair {
  const tokens = tokenizeWithColumns(line);
  const firstColumn = tokens[0]?.column ?? 1;

  if (tokens.length === 0 || tokens[0].text !== "KPX") {
    throw new ConversionError(`expected "KPX" but found "${tokens[0]?.text ?? ""}"`, lineNumber, firstColumn, line);
  }
  if (tokens.length < 4) {
    throw new ConversionError(
      "KPX line requires a first glyph name, a second glyph name, and a kerning amount",
      lineNumber,
      firstColumn,
      line,
    );
  }

  const amount = Number(tokens[3].text);
  if (Number.isNaN(amount)) {
    throw new ConversionError(`kerning amount "${tokens[3].text}" is not a number`, lineNumber, tokens[3].column, line);
  }

  return { first: tokens[1].text, second: tokens[2].text, amount };
}
