// Every parse failure in this project carries a 1-based line and column so a
// reader can jump straight to the offending byte in an editor, instead of
// re-reading the whole file to find what broke.
export class ConversionError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number, sourceLine?: string) {
    super(formatMessage(message, line, column, sourceLine));
    this.name = "ConversionError";
    this.line = line;
    this.column = column;
  }
}

function formatMessage(message: string, line: number, column: number, sourceLine?: string): string {
  const location = `${message} (line ${line}, column ${column})`;
  if (sourceLine === undefined) {
    return location;
  }
  const gutter = `${line} | `;
  const caret = " ".repeat(gutter.length + Math.max(column - 1, 0)) + "^";
  return `${location}\n\n${gutter}${sourceLine}\n${caret}`;
}
