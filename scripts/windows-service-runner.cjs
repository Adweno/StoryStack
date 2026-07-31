const { spawn } = require("node:child_process");
const path = require("node:path");

const projectPath = path.resolve(__dirname, "..");
const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/server.ts"], {
  cwd: projectPath,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
