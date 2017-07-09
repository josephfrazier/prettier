"use strict";

const stream = require("stream");
const stringToStream = require("string-to-stream");
const prettierCli = require("../../bin/prettier");

test("can pass arguments, stdin/stdout/stderr to CLI programmatically", done => {
  const stdin = stringToStream("0");

  let output = "";
  const stdout = new stream.Writable({
    write: function(chunk, encoding, next) {
      output += chunk.toString();
      next();
    }
  });

  const stderr = new stream.Writable({
    write: function(chunk, encoding, next) {
      next();
    }
  });

  prettierCli.cli(["--stdin"], stdin, stdout, stderr).then(result => {
    expect(result.exitCode).toEqual(0);
    expect(output).toEqual("0;\n");
    done();
  });
});

test("can pass custom prettier instance to CLI programmatically", done => {
  const stdin = stringToStream("0");

  let output = "";
  const stdout = new stream.Writable({
    write: function(chunk, encoding, next) {
      output += chunk.toString();
      next();
    }
  });

  const stderr = new stream.Writable({
    write: function(chunk, encoding, next) {
      next();
    }
  });

  const version = "CUSTOM_VERSION";
  prettierCli
    .cli(["--version"], stdin, stdout, stderr, { version: version })
    .then(result => {
      expect(result.exitCode).toEqual(0);
      expect(output).toEqual(version + "\n");
      done();
    });
});

test("can pass --fallback to CLI programmatically", done => {
  const input = "a.1";
  const stdin = stringToStream(input);

  let output = "";
  const stdout = new stream.Writable({
    write: function(chunk, encoding, next) {
      output += chunk.toString();
      next();
    }
  });

  const stderr = new stream.Writable({
    write: function(chunk, encoding, next) {
      next();
    }
  });

  prettierCli
    .cli(["--stdin", "--fallback"], stdin, stdout, stderr)
    .then(result => {
      expect(result.exitCode).toEqual(0);
      expect(output).toEqual(input);
      done();
    });
});
