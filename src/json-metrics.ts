import { ConversionError } from "./errors.js";
import type { FontMetrics, GlyphMetrics } from "./afm.js";

// JSON.parse gives no position information on failure, and it gives none at
// all for "valid JSON, wrong shape" mistakes (a string where a number was
// expected, a missing field). So the JSON side gets its own small tokenizer
// and recursive-descent parser that tags every value with the line and
// column it started at, which is what makes precise validation errors
// possible below.

type Token =
  | { type: "punct"; value: string; line: number; column: number }
  | { type: "string"; value: string; line: number; column: number }
  | { type: "number"; value: number; line: number; column: number }
  | { type: "boolean"; value: boolean; line: number; column: number }
  | { type: "null"; line: number; column: number }
  | { type: "eof"; line: number; column: number };

export type JsonNode =
  | { kind: "object"; line: number; column: number; entries: Map<string, JsonNode> }
  | { kind: "array"; line: number; column: number; items: JsonNode[] }
  | { kind: "string"; line: number; column: number; value: string }
  | { kind: "number"; line: number; column: number; value: number }
  | { kind: "boolean"; line: number; column: number; value: boolean }
  | { kind: "null"; line: number; column: number };

class Scanner {
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  private peek(): string {
    return this.source[this.pos] ?? "";
  }

  private advance(): string {
    const ch = this.source[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  lineText(line: number): string {
    return this.source.split("\n")[line - 1] ?? "";
  }

  next(): Token {
    while (this.pos < this.source.length && /\s/.test(this.peek())) {
      this.advance();
    }
    const line = this.line;
    const column = this.column;

    if (this.pos >= this.source.length) {
      return { type: "eof", line, column };
    }

    const ch = this.peek();

    if ("{}[]:,".includes(ch)) {
      this.advance();
      return { type: "punct", value: ch, line, column };
    }
    if (ch === '"') {
      return this.readString(line, column);
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      return this.readNumber(line, column);
    }
    if (/[a-z]/.test(ch)) {
      return this.readKeyword(line, column);
    }

    throw new ConversionError(`unexpected character "${ch}"`, line, column, this.lineText(line));
  }

  private readString(line: number, column: number): Token {
    this.advance(); // opening quote
    let value = "";
    for (;;) {
      if (this.pos >= this.source.length) {
        throw new ConversionError("unterminated string", line, column, this.lineText(line));
      }
      const ch = this.advance();
      if (ch === '"') {
        break;
      }
      if (ch === "\\") {
        const esc = this.advance();
        switch (esc) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          case "/":
            value += "/";
            break;
          case "u": {
            const hex = this.source.slice(this.pos, this.pos + 4);
            if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) {
              throw new ConversionError("invalid unicode escape", this.line, this.column, this.lineText(this.line));
            }
            for (let i = 0; i < 4; i++) this.advance();
            value += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            throw new ConversionError(
              `invalid escape sequence "\\${esc}"`,
              this.line,
              this.column - 1,
              this.lineText(this.line),
            );
        }
      } else {
        value += ch;
      }
    }
    return { type: "string", value, line, column };
  }

  private readNumber(line: number, column: number): Token {
    let text = "";
    if (this.peek() === "-") text += this.advance();
    while (/[0-9]/.test(this.peek())) text += this.advance();
    if (this.peek() === ".") {
      text += this.advance();
      while (/[0-9]/.test(this.peek())) text += this.advance();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      text += this.advance();
      const sign = this.peek();
      if (sign === "+" || sign === "-") text += this.advance();
      while (/[0-9]/.test(this.peek())) text += this.advance();
    }
    return { type: "number", value: Number(text), line, column };
  }

  private readKeyword(line: number, column: number): Token {
    let text = "";
    while (/[a-z]/.test(this.peek())) text += this.advance();
    if (text === "true") return { type: "boolean", value: true, line, column };
    if (text === "false") return { type: "boolean", value: false, line, column };
    if (text === "null") return { type: "null", line, column };
    throw new ConversionError(`unexpected token "${text}"`, line, column, this.lineText(line));
  }
}

function describeToken(token: Token): string {
  switch (token.type) {
    case "eof":
      return "end of input";
    case "punct":
      return `"${token.value}"`;
    case "string":
      return `string "${token.value}"`;
    default:
      return String(token.value);
  }
}

export function parseJsonMetrics(source: string): FontMetrics {
  const scanner = new Scanner(source);
  const lineText = (n: number) => scanner.lineText(n);

  let lookahead = scanner.next();
  const advance = (): Token => {
    const current = lookahead;
    lookahead = scanner.next();
    return current;
  };
  const expectPunct = (punct: string): Token => {
    if (lookahead.type !== "punct" || lookahead.value !== punct) {
      throw new ConversionError(
        `expected "${punct}" but found ${describeToken(lookahead)}`,
        lookahead.line,
        lookahead.column,
        lineText(lookahead.line),
      );
    }
    return advance();
  };

  function parseValue(): JsonNode {
    const token = lookahead;
    if (token.type === "punct" && token.value === "{") {
      return parseObject();
    }
    if (token.type === "punct" && token.value === "[") {
      return parseArray();
    }
    if (token.type === "string") {
      advance();
      return { kind: "string", line: token.line, column: token.column, value: token.value };
    }
    if (token.type === "number") {
      advance();
      return { kind: "number", line: token.line, column: token.column, value: token.value };
    }
    if (token.type === "boolean") {
      advance();
      return { kind: "boolean", line: token.line, column: token.column, value: token.value };
    }
    if (token.type === "null") {
      advance();
      return { kind: "null", line: token.line, column: token.column };
    }
    throw new ConversionError(
      `expected a value but found ${describeToken(token)}`,
      token.line,
      token.column,
      lineText(token.line),
    );
  }

  function parseObject(): JsonNode {
    const start = lookahead;
    expectPunct("{");
    const entries = new Map<string, JsonNode>();
    if (lookahead.type === "punct" && lookahead.value === "}") {
      advance();
      return { kind: "object", line: start.line, column: start.column, entries };
    }
    for (;;) {
      if (lookahead.type !== "string") {
        throw new ConversionError(
          `expected a property name but found ${describeToken(lookahead)}`,
          lookahead.line,
          lookahead.column,
          lineText(lookahead.line),
        );
      }
      const key = advance() as Extract<Token, { type: "string" }>;
      expectPunct(":");
      entries.set(key.value, parseValue());
      if (lookahead.type === "punct" && lookahead.value === ",") {
        advance();
        continue;
      }
      break;
    }
    expectPunct("}");
    return { kind: "object", line: start.line, column: start.column, entries };
  }

  function parseArray(): JsonNode {
    const start = lookahead;
    expectPunct("[");
    const items: JsonNode[] = [];
    if (lookahead.type === "punct" && lookahead.value === "]") {
      advance();
      return { kind: "array", line: start.line, column: start.column, items };
    }
    for (;;) {
      items.push(parseValue());
      if (lookahead.type === "punct" && lookahead.value === ",") {
        advance();
        continue;
      }
      break;
    }
    expectPunct("]");
    return { kind: "array", line: start.line, column: start.column, items };
  }

  const root = parseValue();
  if (lookahead.type !== "eof") {
    throw new ConversionError(
      "unexpected trailing content after the top-level value",
      lookahead.line,
      lookahead.column,
      lineText(lookahead.line),
    );
  }

  return toFontMetrics(root, lineText);
}

type ObjectNode = Extract<JsonNode, { kind: "object" }>;

function expectObject(node: JsonNode, what: string, lineText: (n: number) => string): ObjectNode {
  if (node.kind !== "object") {
    throw new ConversionError(`expected ${what} to be an object, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node;
}

function requireField(obj: ObjectNode, key: string, lineText: (n: number) => string): JsonNode {
  const node = obj.entries.get(key);
  if (!node) {
    throw new ConversionError(`missing required field "${key}"`, obj.line, obj.column, lineText(obj.line));
  }
  return node;
}

function expectString(obj: ObjectNode, key: string, lineText: (n: number) => string): string {
  const node = requireField(obj, key, lineText);
  if (node.kind !== "string") {
    throw new ConversionError(`field "${key}" must be a string, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node.value;
}

function expectNumber(obj: ObjectNode, key: string, lineText: (n: number) => string): number {
  const node = requireField(obj, key, lineText);
  if (node.kind !== "number") {
    throw new ConversionError(`field "${key}" must be a number, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node.value;
}

function optionalString(obj: ObjectNode, key: string, lineText: (n: number) => string): string | undefined {
  const node = obj.entries.get(key);
  if (!node) return undefined;
  if (node.kind !== "string") {
    throw new ConversionError(`field "${key}" must be a string, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node.value;
}

function optionalNumber(obj: ObjectNode, key: string, lineText: (n: number) => string): number | undefined {
  const node = obj.entries.get(key);
  if (!node) return undefined;
  if (node.kind !== "number") {
    throw new ConversionError(`field "${key}" must be a number, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node.value;
}

function optionalBoolean(obj: ObjectNode, key: string, lineText: (n: number) => string): boolean | undefined {
  const node = obj.entries.get(key);
  if (!node) return undefined;
  if (node.kind !== "boolean") {
    throw new ConversionError(`field "${key}" must be a boolean, got ${node.kind}`, node.line, node.column, lineText(node.line));
  }
  return node.value;
}

function toFontMetrics(node: JsonNode, lineText: (n: number) => string): FontMetrics {
  const obj = expectObject(node, "the font metrics document", lineText);
  const glyphsNode = requireField(obj, "glyphs", lineText);
  if (glyphsNode.kind !== "array") {
    throw new ConversionError(`field "glyphs" must be an array, got ${glyphsNode.kind}`, glyphsNode.line, glyphsNode.column, lineText(glyphsNode.line));
  }

  return {
    fontName: expectString(obj, "fontName", lineText),
    fullName: optionalString(obj, "fullName", lineText),
    familyName: optionalString(obj, "familyName", lineText),
    weight: optionalString(obj, "weight", lineText),
    italicAngle: optionalNumber(obj, "italicAngle", lineText) ?? 0,
    isFixedPitch: optionalBoolean(obj, "isFixedPitch", lineText) ?? false,
    unitsPerEm: optionalNumber(obj, "unitsPerEm", lineText) ?? 1000,
    ascender: optionalNumber(obj, "ascender", lineText),
    descender: optionalNumber(obj, "descender", lineText),
    capHeight: optionalNumber(obj, "capHeight", lineText),
    xHeight: optionalNumber(obj, "xHeight", lineText),
    glyphs: glyphsNode.items.map((item, index) => toGlyphMetrics(item, index, lineText)),
  };
}

function toGlyphMetrics(node: JsonNode, index: number, lineText: (n: number) => string): GlyphMetrics {
  const obj = expectObject(node, `glyphs[${index}]`, lineText);
  const bboxNode = obj.entries.get("bbox");
  let bbox: [number, number, number, number] | undefined;
  if (bboxNode) {
    if (bboxNode.kind !== "array" || bboxNode.items.length !== 4) {
      throw new ConversionError(
        `field "bbox" in glyphs[${index}] must be an array of 4 numbers`,
        bboxNode.line,
        bboxNode.column,
        lineText(bboxNode.line),
      );
    }
    const numbers = bboxNode.items.map((item, i) => {
      if (item.kind !== "number") {
        throw new ConversionError(
          `bbox[${i}] in glyphs[${index}] must be a number, got ${item.kind}`,
          item.line,
          item.column,
          lineText(item.line),
        );
      }
      return item.value;
    });
    bbox = [numbers[0], numbers[1], numbers[2], numbers[3]];
  }

  return {
    name: expectString(obj, "name", lineText),
    code: optionalNumber(obj, "code", lineText) ?? -1,
    width: expectNumber(obj, "width", lineText),
    bbox,
  };
}

export function toJsonMetrics(metrics: FontMetrics): string {
  return JSON.stringify(metrics, null, 2) + "\n";
}
