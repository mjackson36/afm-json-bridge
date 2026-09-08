#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseAfm, toAfm } from "./afm.js";
import { parseJsonMetrics, toJsonMetrics } from "./json-metrics.js";
import { ConversionError } from "./errors.js";

type Format = "afm" | "json";

function formatFromExtension(path: string): Format | null {
  switch (extname(path).toLowerCase()) {
    case ".afm":
      return "afm";
    case ".json":
      return "json";
    default:
      return null;
  }
}

function usage(): string {
  return [
    "usage: afm-json-bridge <input> [output]",
    "",
    "Converts between AFM and JSON font metrics. The format on each side is",
    "detected from the file extension (.afm or .json).",
    "",
    "If output is omitted, the result is written to stdout in the format",
    "opposite the input's.",
  ].join("\n");
}

function main(argv: string[]): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }

  const [inputPath, outputPath] = argv;
  const inputFormat = formatFromExtension(inputPath);
  if (!inputFormat) {
    console.error(`cannot tell input format from "${inputPath}" (expected a .afm or .json extension)`);
    return 1;
  }

  let outputFormat: Format;
  if (outputPath) {
    const detected = formatFromExtension(outputPath);
    if (!detected) {
      console.error(`cannot tell output format from "${outputPath}" (expected a .afm or .json extension)`);
      return 1;
    }
    outputFormat = detected;
  } else {
    outputFormat = inputFormat === "afm" ? "json" : "afm";
  }

  let source: string;
  try {
    source = readFileSync(inputPath, "utf8");
  } catch (err) {
    console.error(`could not read "${inputPath}": ${(err as Error).message}`);
    return 1;
  }

  let output: string;
  try {
    const metrics = inputFormat === "afm" ? parseAfm(source) : parseJsonMetrics(source);
    output = outputFormat === "afm" ? toAfm(metrics) : toJsonMetrics(metrics);
  } catch (err) {
    if (err instanceof ConversionError) {
      console.error(`${inputPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  if (outputPath) {
    writeFileSync(outputPath, output);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
