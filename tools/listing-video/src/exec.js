"use strict";

const { spawn } = require("child_process");

// ffmpeg prints its version and its whole build configuration to stderr before
// it gets to the actual problem, which buries the one line worth reading.
const BANNER = /^(ffmpeg|ffprobe) version|^\s+(built with|configuration:|lib(avutil|avcodec|avformat|avdevice|avfilter|swscale|swresample|postproc))/;

function meaningfulStderr(stderr) {
  const lines = String(stderr)
    .split("\n")
    .filter((line) => line.trim() && !BANNER.test(line));
  return lines.slice(-6).join("\n").slice(-600);
}

function run(command, args, { input, cwd, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
        reject(new Error(`${command} timed out after ${Math.round(timeout / 1000)}s`));
      }
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      finished = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`${command} exited ${code}: ${meaningfulStderr(stderr) || stdout.slice(-400)}`);
      error.stderr = stderr;
      return reject(error);
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

module.exports = { run };
