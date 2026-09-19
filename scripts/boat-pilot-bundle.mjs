// Produce a secret-free setup script for `boat new --setup-file` or SSH.
// The bridge token is uploaded separately; never embed it in a command or log.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: node scripts/boat-pilot-bundle.mjs <output.sh>");
const files = [
  "cloud-computer/codex.mjs",
  "cloud-computer/vault.mjs",
  "boat-computer/server.mjs",
];
const encoded = await Promise.all(
  files.map(async (path) => ({
    path,
    bytes: (await readFile(new URL(`../${path}`, import.meta.url))).toString(
      "base64",
    ),
  })),
);
const script = `#!/bin/bash
set -euo pipefail
umask 077
# A dedicated no-env Boat sandbox, never an existing user's development VM.
sudo install -d -m 755 /opt/downy-boat/cloud-computer /opt/downy-boat/boat-computer
install -d -m 700 /home/user/.downy-boat
sudo npm install --prefix /opt/downy-boat/codex @openai/codex@0.154.0 >/dev/null
${encoded.map(({ path, bytes }) => `printf '%s' '${bytes}' | base64 -d | sudo tee /opt/downy-boat/${path} >/dev/null`).join("\n")}
sudo chmod -R a+rX /opt/downy-boat
node_binary="$(command -v node)"
sudo tee /etc/systemd/system/downy-boat.service >/dev/null <<UNIT
[Unit]
Description=Downy restricted Codex bridge (Boat pilot)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=user
WorkingDirectory=/tmp
RuntimeDirectory=downy-boat
RuntimeDirectoryMode=0700
Environment=PATH=/opt/downy-boat/codex/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_binary /opt/downy-boat/boat-computer/server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable downy-boat.service >/dev/null
# Start only after uploading the random bridge-token file (mode 0600).
`;
await writeFile(destination, script, { mode: 0o700 });
console.log(
  `Wrote secret-free Boat setup from ${fileURLToPath(new URL("..", import.meta.url))}`,
);
