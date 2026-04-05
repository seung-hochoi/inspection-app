const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.HAPPYCALL_BRIDGE_PORT || 32147);
const importScriptPath = path.join(__dirname, "import-happycall-outlook.ps1");

let running = false;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function runImport() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        importScriptPath,
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }

      reject(new Error(stderr || stdout || `Import failed with exit code ${code}.`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, running });
    return;
  }

  if (req.method === "POST" && req.url === "/import-happycall") {
    if (running) {
      sendJson(res, 409, { ok: false, message: "해피콜 가져오기가 이미 실행 중입니다." });
      return;
    }

    running = true;
    try {
      const result = await runImport();
      sendJson(res, 200, {
        ok: true,
        message: "해피콜 메일 가져오기를 완료했습니다.",
        stdout: result.stdout,
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        message: error.message || "해피콜 메일 가져오기에 실패했습니다.",
      });
    } finally {
      running = false;
    }
    return;
  }

  sendJson(res, 404, { ok: false, message: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Happycall bridge listening on http://127.0.0.1:${PORT}`);
});
