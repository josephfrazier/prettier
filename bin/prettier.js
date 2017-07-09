#!/usr/bin/env node

"use strict";

const fs = require("fs");
const util = require("util");
const getStream = require("get-stream");
const globby = require("globby");
const chalk = require("chalk");
const minimist = require("minimist");
const readline = require("readline");
const prettier = eval("require")("../index");
const cleanAST = require("../src/clean-ast.js").cleanAST;

// If invoked directly, pass-through CLI arguments and streams
// See https://stackoverflow.com/questions/4981891/node-js-equivalent-of-pythons-if-name-main/6090287#6090287
if (typeof require != "undefined" && require.main === module) {
  cliWrapper(
    process.argv.slice(2),
    process.stdin,
    process.stdout,
    process.stderr
  ).then(result => {
    process.exitCode = result.exitCode;
    if (result.message) {
      console.error(result.message);
    }
  });
}

module.exports = { cli: cliWrapper };

// The cli() function throws Errors in order to exit early,
// so we need to convert those into resolved Promises.
function cliWrapper(args, stdin, stdout, stderr) {
  try {
    return cli(args, stdin, stdout, stderr);
  } catch (err) {
    if (!("exitCode" in err)) {
      err.exitCode = 1;
    }
    return Promise.resolve(err);
  }
}

// prettier-ignore
// This is ignored to make it easier to merge upstream prettier changes.
function cli(args, stdin, stdout, stderr) {

let exitCode = 0;

// adapted from https://github.com/nodejs/node/blob/d6fece14369ab5d9d64e48ed58cea168f5084a80/lib/console.js#L104-L109
function logHelper () {
  this.write(util.format.apply(null, arguments) + '\n');
}

const console_log = logHelper.bind(stdout);
const console_warn = logHelper.bind(stderr);
const console_error = console_warn;

const argv = minimist(args, {
  boolean: [
    "write",
    "stdin",
    "use-tabs",
    "semi",
    "single-quote",
    "bracket-spacing",
    "jsx-bracket-same-line",
    // The supports-color package (a sub sub dependency) looks directly at
    // `process.argv` for `--no-color` and such-like options. The reason it is
    // listed here is to avoid "Ignored unknown option: --no-color" warnings.
    // See https://github.com/chalk/supports-color/#info for more information.
    "color",
    "list-different",
    "help",
    "version",
    "debug-print-doc",
    "debug-check",
    "with-node-modules",
    // Deprecated in 0.0.10
    "flow-parser"
  ],
  string: [
    "print-width",
    "tab-width",
    "parser",
    "trailing-comma",
    "cursor-offset",
    "range-start",
    "range-end",
    "stdin-filepath"
  ],
  default: {
    semi: true,
    color: true,
    "bracket-spacing": true,
    parser: "babylon"
  },
  alias: { help: "h", version: "v", "list-different": "l" },
  unknown: param => {
    if (param.startsWith("-")) {
      console_warn("Ignored unknown option: " + param + "\n");
      return false;
    }
  }
});

if (argv["version"]) {
  console_log(prettier.version);
  return Promise.resolve({ exitCode: 0 });
}

const filepatterns = argv["_"];
const write = argv["write"];
const readStdin = argv["stdin"] || (!filepatterns.length && !stdin.isTTY);
const ignoreNodeModules = argv["with-node-modules"] === false;
const ignoreNodeModulesGlobs = ["!**/node_modules/**", "!./node_modules/**"];
const globOptions = {
  dot: true
};

if (write && argv["debug-check"]) {
  throw new Error("Cannot use --write and --debug-check together.");
}

function getParserOption() {
  const optionName = "parser";
  const value = argv[optionName];

  if (value === undefined) {
    return value;
  }

  // For backward compatibility. Deprecated in 0.0.10
  if (argv["flow-parser"]) {
    console_warn("`--flow-parser` is deprecated. Use `--parser flow` instead.");
    return "flow";
  }

  return value;
}

function getIntOption(optionName) {
  const value = argv[optionName];

  if (value === undefined) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  throw new Error(
    "Invalid --" +
      optionName +
      " value. Expected an integer, but received: " +
      JSON.stringify(value)
  );
}

function getTrailingComma() {
  switch (argv["trailing-comma"]) {
    case undefined:
    case "none":
      return "none";
    case "":
      console_warn(
        "Warning: `--trailing-comma` was used without an argument. This is deprecated. " +
          'Specify "none", "es5", or "all".'
      );
      return "es5";
    case "es5":
      return "es5";
    case "all":
      return "all";
    default:
      throw new Error("Invalid option for --trailing-comma");
  }
}

const options = {
  cursorOffset: getIntOption("cursor-offset"),
  rangeStart: getIntOption("range-start"),
  rangeEnd: getIntOption("range-end"),
  useTabs: argv["use-tabs"],
  semi: argv["semi"],
  printWidth: getIntOption("print-width"),
  tabWidth: getIntOption("tab-width"),
  bracketSpacing: argv["bracket-spacing"],
  singleQuote: argv["single-quote"],
  jsxBracketSameLine: argv["jsx-bracket-same-line"],
  filepath: argv["stdin-filepath"],
  trailingComma: getTrailingComma(),
  parser: getParserOption()
};

function diff(a, b) {
  return require("diff").createTwoFilesPatch("", "", a, b, "", "", {
    context: 2
  });
}

function format(input, opt) {
  if (argv["debug-print-doc"]) {
    const doc = prettier.__debug.printToDoc(input, opt);
    return { formatted: prettier.__debug.formatDoc(doc) };
  }

  if (argv["debug-check"]) {
    const pp = prettier.format(input, opt);
    const pppp = prettier.format(pp, opt);
    if (pp !== pppp) {
      throw new Error("prettier(input) !== prettier(prettier(input))\n" + diff(pp, pppp));
    } else {
      const ast = cleanAST(prettier.__debug.parse(input, opt));
      const past = cleanAST(prettier.__debug.parse(pp, opt));

      if (ast !== past) {
        const MAX_AST_SIZE = 2097152; // 2MB
        const astDiff =
          ast.length > MAX_AST_SIZE || past.length > MAX_AST_SIZE
            ? "AST diff too large to render"
            : diff(ast, past);
        throw new Error("ast(input) !== ast(prettier(input))\n" +
          astDiff +
          "\n" +
          diff(input, pp));
      }
    }
    return { formatted: opt.filepath || "(stdin)\n" };
  }

  return prettier.formatWithCursor(input, opt);
}

function handleError(filename, e) {
  const isParseError = Boolean(e && e.loc);
  const isValidationError = /Validation Error/.test(e && e.message);

  // For parse errors and validation errors, we only want to show the error
  // message formatted in a nice way. `String(e)` takes care of that. Other
  // (unexpected) errors are passed as-is as a separate argument to
  // `util.format`. That includes the stack trace (if any), and shows a nice
  // `util.inspect` of throws things that aren't `Error` objects. (The Flow
  // parser has mistakenly thrown arrays sometimes.)
  if (isParseError) {
    console_error(filename + ": " + String(e));
  } else if (isValidationError) {
    // If validation fails for one file, it will fail for all of them.
    throw new Error(String(e));
  } else {
    console_error(filename + ":", e.stack || e);
  }

  // Don't exit the process if one file failed
  exitCode = 2;
}

if (argv["help"] || (!filepatterns.length && !stdin)) {
  console_log(
    "Usage: prettier [opts] [filename ...]\n\n" +
      "Available options:\n" +
      "  --write                  Edit the file in-place. (Beware!)\n" +
      "  --list-different or -l   Print filenames of files that are different from Prettier formatting.\n" +
      "  --stdin                  Read input from stdin.\n" +
      "  --stdin-filepath         Path to the file used to read from stdin.\n" +
      "  --print-width <int>      Specify the length of line that the printer will wrap on. Defaults to 80.\n" +
      "  --tab-width <int>        Specify the number of spaces per indentation-level. Defaults to 2.\n" +
      "  --use-tabs               Indent lines with tabs instead of spaces.\n" +
      "  --no-semi                Do not print semicolons, except at the beginning of lines which may need them.\n" +
      "  --single-quote           Use single quotes instead of double quotes.\n" +
      "  --no-bracket-spacing     Do not print spaces between brackets.\n" +
      "  --jsx-bracket-same-line  Put > on the last line instead of at a new line.\n" +
      "  --trailing-comma <none|es5|all>\n" +
      "                           Print trailing commas wherever possible. Defaults to none.\n" +
      "  --parser <flow|babylon|typescript|postcss|json>\n" +
      "                           Specify which parse to use. Defaults to babylon.\n" +
      "  --cursor-offset <int>    Print (to stderr) where a cursor at the given position would move to after formatting.\n" +
      "                           This option cannot be used with --range-start and --range-end\n" +
      "  --range-start <int>      Format code starting at a given character offset.\n" +
      "                           The range will extend backwards to the start of the first line containing the selected statement.\n" +
      "                           This option cannot be used with --cursor-offset.\n" +
      "                           Defaults to 0.\n" +
      "  --range-end <int>        Format code ending at a given character offset (exclusive).\n" +
      "                           The range will extend forwards to the end of the selected statement.\n" +
      "                           This option cannot be used with --cursor-offset.\n" +
      "                           Defaults to Infinity.\n" +
      "  --no-color               Do not colorize error messages.\n" +
      "  --with-node-modules      Process files inside `node_modules` directory.\n" +
      "  --version or -v          Print Prettier version.\n" +
      "\n"
  );
  return Promise.resolve({ exitCode: argv["help"] ? 0 : 1 });
}

if (readStdin) {
  return getStream(stdin).then(input => {
    if (listDifferent(input, options, "(stdin)")) {
      return;
    }

    try {
      writeOutput(format(input, options));
    } catch (e) {
      handleError("stdin", e);
    }
  }).catch(err => {
    exitCode = err.exitCode;
  }).then(() => {
    return { exitCode: exitCode };
  });
}
  eachFilename(filepatterns, filename => {
    if (write) {
      stdout.write(filename);
    }

    let input;
    try {
      input = fs.readFileSync(filename, "utf8");
    } catch (e) {
      // Add newline to split errors from filename line.
      stdout.write("\n");

      console_error("Unable to read file: " + filename + "\n" + e);
      // Don't exit the process if one file failed
      exitCode = 2;
      return;
    }

    listDifferent(input, options, filename);

    const start = Date.now();

    let result;
    let output;

    try {
      result = format(
        input,
        Object.assign({}, options, { filepath: filename })
      );
      output = result.formatted;
    } catch (e) {
      // Add newline to split errors from filename line.
      stdout.write("\n");

      handleError(filename, e);
      return;
    }

    if (write) {
      // Remove previously printed filename to log it with duration.
      readline.clearLine(stdout, 0);
      readline.cursorTo(stdout, 0, null);

      // Don't write the file if it won't change in order not to invalidate
      // mtime based caches.
      if (output === input) {
        if (!argv["list-different"]) {
          console_log(chalk.grey("%s %dms"), filename, Date.now() - start);
        }
      } else {
        if (argv["list-different"]) {
          console_log(filename);
        } else {
          console_log("%s %dms", filename, Date.now() - start);
        }

        try {
          fs.writeFileSync(filename, output, "utf8");
        } catch (err) {
          console_error("Unable to write file: " + filename + "\n" + err);
          // Don't exit the process if one file failed
          exitCode = 2;
        }
      }
    } else if (argv["debug-check"]) {
      if (output) {
        console_log(output);
      } else {
        exitCode = 2;
      }
    } else if (!argv["list-different"]) {
      writeOutput(result);
    }
  });
return Promise.resolve({ exitCode: exitCode });

function listDifferent(input, options, filename) {
  if (!argv["list-different"]) {
    return;
  }

  options = Object.assign({}, options, { filepath: filename });

  if (!prettier.check(input, options)) {
    if (!write) {
      console_log(filename);
    }
    exitCode = 1;
  }

  return true;
}

function writeOutput(result) {
  stdout.write(result.formatted);

  if (options.cursorOffset) {
    stderr.write(result.cursorOffset + "\n");
  }
}

function eachFilename(patterns, callback) {
  if (ignoreNodeModules) {
    patterns = patterns.concat(ignoreNodeModulesGlobs);
  }

  const filePaths = globby.sync(patterns, globOptions);
      if (filePaths.length === 0) {
        throw {
          message: "No matching files. Patterns tried: " + patterns.join(" "),
          exitCode: 2
        }
      }

  try {
      filePaths.forEach(filePath => {
        return callback(filePath);
      });
  } catch (err) {
      console_error(
        "Unable to expand glob patterns: " + patterns.join(" ") + "\n" + err
      );
      // Don't exit the process if one pattern failed
      exitCode = 2;
  }
}

} // end of cli()
