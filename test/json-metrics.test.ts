import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonMetrics, toJsonMetrics } from "../src/json-metrics.js";
import type { FontMetrics } from "../src/afm.js";
import { ConversionError } from "../src/errors.js";

const VALID_JSON = JSON.stringify({
  fontName: "Example",
  glyphs: [
    { name: "space", code: 32, width: 278 },
    { name: "A", width: 667, bbox: [4, 0, 662, 718] },
  ],
});

test("parses a minimal document and fills in defaults", () => {
  assert.deepEqual(parseJsonMetrics(VALID_JSON), {
    fontName: "Example",
    fullName: undefined,
    familyName: undefined,
    weight: undefined,
    italicAngle: 0,
    isFixedPitch: false,
    unitsPerEm: 1000,
    ascender: undefined,
    descender: undefined,
    capHeight: undefined,
    xHeight: undefined,
    glyphs: [
      { name: "space", code: 32, width: 278, bbox: undefined },
      { name: "A", code: -1, width: 667, bbox: [4, 0, 662, 718] },
    ],
  });
});

test("reports a missing required field", () => {
  assert.throws(
    () => parseJsonMetrics('{"glyphs": []}'),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.match(err.message, /missing required field "fontName"/);
      return true;
    },
  );
});

test("reports the exact line and column of a field with the wrong type", () => {
  const source = [
    "{",
    '  "fontName": "Example",',
    '  "glyphs": [',
    '    { "name": "A", "width": "667" }',
    "  ]",
    "}",
  ].join("\n");

  assert.throws(
    () => parseJsonMetrics(source),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.line, 4);
      assert.equal(err.column, 29);
      assert.match(err.message, /field "width" must be a number, got string/);
      return true;
    },
  );
});

test("rejects a bbox that does not have exactly 4 numbers", () => {
  const source = [
    "{",
    '  "fontName": "Example",',
    '  "glyphs": [',
    '    { "name": "A", "width": 100, "bbox": [1, 2, 3] }',
    "  ]",
    "}",
  ].join("\n");

  assert.throws(
    () => parseJsonMetrics(source),
    (err: unknown) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.line, 4);
      assert.match(err.message, /field "bbox" in glyphs\[0\] must be an array of 4 numbers/);
      return true;
    },
  );
});

test("round-trips through toJsonMetrics", () => {
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

  assert.deepEqual(parseJsonMetrics(toJsonMetrics(metrics)), metrics);
});
