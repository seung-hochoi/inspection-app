const { spawn } = require("child_process");
const path = require("path");

process.env.CI = "false";
process.env.GENERATE_SOURCEMAP = "false";

const reactScriptsCli = require.resolve("react-scripts/bin/react-scripts");

const child = spawn(process.execPath, [reactScriptsCli, "build"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
