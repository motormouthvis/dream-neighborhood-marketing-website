"use strict";

const { spawn } = require("child_process");

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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1200) || stdout.slice(-600)}`));
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

module.exports = { run };
