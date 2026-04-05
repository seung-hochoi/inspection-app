import subprocess, os, sys

cwd = r"C:\inspection-app-main (1)\inspection-app-main"
env = {**os.environ, "CI": "false"}

result = subprocess.run(
    ["npm", "run", "build"],
    cwd=cwd,
    env=env,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    timeout=300,
    shell=True,
)

print("EXIT CODE:", result.returncode)
print("--- STDOUT (last 4000 chars) ---")
print(result.stdout[-4000:] if result.stdout else "(empty)")
print("--- STDERR (last 3000 chars) ---")
print(result.stderr[-3000:] if result.stderr else "(empty)")
