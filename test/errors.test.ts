import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversionError } from "../src/errors.js";

test("formats without a source line", () => {
  const err = new ConversionError("missing FontName", 3, 1);
  assert.equal(err.name, "ConversionError");
  assert.equal(err.line, 3);
  assert.equal(err.column, 1);
  assert.equal(err.message, "missing FontName (line 3, column 1)");
});

test("formats with a source line and points the caret at the column", () => {
  const sourceLine = "C 65 ; WX 12x ; N A ;";
  const err = new ConversionError('width "12x" is not a number', 4, 15, sourceLine);
  const lines = err.message.split("\n");

  assert.equal(lines[0], 'width "12x" is not a number (line 4, column 15)');
  assert.equal(lines[1], "");
  assert.equal(lines[2], `4 | ${sourceLine}`);

  const gutterLength = "4 | ".length;
  assert.equal(lines[3], " ".repeat(gutterLength + 14) + "^");
  assert.equal(lines[3].indexOf("^"), gutterLength + 15 - 1);
});

test("clamps the caret for a column before the start of the line", () => {
  const err = new ConversionError("bad thing", 1, 0, "text");
  const lines = err.message.split("\n");
  assert.equal(lines[2], "1 | text");
  assert.equal(lines[3], "    ^");
});
