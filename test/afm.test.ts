import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAfm, toAfm } from "../src/afm.js";
import type { FontMetrics } from "../src/afm.js";
import { ConversionError } from "../src/errors.js";

const VALID_AFM = [
  "StartFontMetrics 4.1",
  "FontName Example-Regular",
  "FullName Example Regular",
  "ItalicAngle 0",
  "IsFixedPitch false",
  "Ascender 718",
  "Descender -207",
  "CapHeight 700",
  "XHeight 500",
  "StartCharMetrics 2",
  "C 32 ; WX 278 ; N space ;",
  "C 65 ; WX 667 ; N A ; B 4 0 662 718 ;",
  "EndCharMetrics",
  "EndFontMetrics",
].join("\n");

test("parses header fields and char metrics", () => {
  assert.deepEqual(parseAfm(VALID_AFM), {
    fontName: "Example-Regular",
    fullName: "Example Regular",
    familyName: undefined,
    weight: undefined,
    italicAngle: 0,
    isFixedPitch: false,
    unitsPerEm: 1000,
    ascender: 718,
    descender: -207,
    capHeight: 700,
    xHeight: 500,
    glyphs: [
      { name: "space", code: 32, width: 278, bbox: undefined },
      { name: "A", code: 65, width: 667, bbox: [4, 0, 662, 718] },
    ],
  });
});

test("reports the exact line and column of a malformed width", () => {
  const source = [
    "StartFontMetrics 4.1",
    "FontName Example",
    "StartCharMetrics 1",
    "C 65 ; WX 12x ; N A ;",
    "EndCharMetrics",
    "EndFontMetrics",
  ].join("\n");

  assert.throws(
    () => parseAfm(source),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.line, 4);
      assert.equal(err.column, 15);
      assert.match(err.message, /width "12x" is not a number/);
      return true;
    },
  );
});

test("rejects a char count that does not match StartCharMetrics", () => {
  const source = [
    "StartFontMetrics 4.1",
    "FontName Example",
    "StartCharMetrics 2",
    "C 65 ; WX 100 ; N A ;",
    "EndCharMetrics",
    "EndFontMetrics",
  ].join("\n");

  assert.throws(
    () => parseAfm(source),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.line, 3);
      assert.match(err.message, /declared 2 glyphs but 1 were found/);
      return true;
    },
  );
});

test("requires a StartFontMetrics header", () => {
  const source = ["FontName Example", "EndFontMetrics"].join("\n");

  assert.throws(
    () => parseAfm(source),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.line, 1);
      assert.match(err.message, /missing "StartFontMetrics" header/);
      return true;
    },
  );
});

test("round-trips through toAfm", () => {
  const metrics: FontMetrics = {
    fontName: "Example-Bold",
    fullName: "Example Bold",
    familyName: "Example",
    weight: "Bold",
    italicAngle: -12.5,
    isFixedPitch: true,
    unitsPerEm: 1000,
    ascender: 718,
    descender: -207,
    capHeight: 700,
    xHeight: 500,
    glyphs: [
      { name: "space", code: 32, width: 278, bbox: undefined },
      { name: "A", code: 65, width: 667, bbox: [4, 0, 662, 718] },
    ],
  };

  assert.deepEqual(parseAfm(toAfm(metrics)), metrics);
});
