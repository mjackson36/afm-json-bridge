# afm-json-bridge

Converts font metrics between Adobe Font Metrics (AFM) and a plain JSON
representation.

AFM is the plain-text metrics format that shipped with PostScript's core
fonts and is still produced by some font tools and required by some PDF
pipelines. It works fine until you need to hand-edit one, generate one from
another source, or debug why a font-embedding step is rejecting a file
someone sent you. The format has no schema and most tools that read it just
throw a generic `SyntaxError` with no indication of where the file went
wrong.

This library does two things: it converts AFM to JSON and back, and it
tries hard to make failures useful. Every error, from a malformed AFM line
to a JSON file with the wrong shape, points at the exact line and column
that caused it.

## Example

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseAfm, toAfm } from "./src/afm.js";
import { parseJsonMetrics, toJsonMetrics } from "./src/json-metrics.js";

const afmSource = readFileSync("Helvetica.afm", "utf8");
const metrics = parseAfm(afmSource);
writeFileSync("helvetica.json", toJsonMetrics(metrics));

// and back
const roundTripped = parseJsonMetrics(readFileSync("helvetica.json", "utf8"));
writeFileSync("helvetica.afm", toAfm(roundTripped));
```

The JSON shape is a straightforward record:

```json
{
  "fontName": "Helvetica",
  "italicAngle": 0,
  "isFixedPitch": false,
  "unitsPerEm": 1000,
  "capHeight": 718,
  "ascender": 718,
  "descender": -207,
  "glyphs": [
    { "name": "space", "code": 32, "width": 278 },
    { "name": "A", "code": 65, "width": 667, "bbox": [4, 0, 662, 718] }
  ]
}
```

## Error messages

A malformed AFM char metrics line:

```
$ cat broken.afm
StartFontMetrics 4.1
FontName Example
StartCharMetrics 1
C 65 ; WX 12x ; N A ;
EndCharMetrics
EndFontMetrics
```

produces:

```
ConversionError: width "12x" is not a number (line 4, column 15)

4 | C 65 ; WX 12x ; N A ;
                  ^
```

A JSON metrics file with a field of the wrong type gets the same treatment,
pointing at the exact value instead of just saying "invalid input":

```
ConversionError: field "width" must be a number, got string (line 6, column 15)

6 |     "width": "667",
                  ^
```

## CLI

There's also a small command-line wrapper. It picks the format on each side
from the file extension, so most invocations don't need any flags:

```
$ node dist/cli.js Helvetica.afm helvetica.json
$ node dist/cli.js helvetica.json Helvetica.afm
```

Leave off the output path and the result is printed to stdout, in the
format opposite the input's:

```
$ node dist/cli.js Helvetica.afm > helvetica.json
```

Parse errors are printed to stderr with the file name prefixed, and the
process exits non-zero:

```
$ node dist/cli.js broken.afm
broken.afm: width "12x" is not a number (line 4, column 15)

4 | C 65 ; WX 12x ; N A ;
                  ^
```

## Status

This is a young, dependency-free project. The AFM parser covers the header
fields and `C`/`WX`/`N`/`B` char metrics fields; kerning pairs (`KPX`) and
composite character data are not read yet. See the roadmap below.

## Building

There are no runtime dependencies. To compile, install TypeScript yourself
(`npm install --save-dev typescript` or a global install) and run `tsc`.

## Testing

Tests use `node:test` and `node:assert`, so nothing beyond TypeScript is
needed to run them:

```
$ npm test
```

This compiles `src` and `test` into `dist-test` and runs the suite with
Node's built-in test runner.

## License

MIT, see [LICENSE](LICENSE).
