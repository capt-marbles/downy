/* eslint-disable typescript/no-unsafe-type-assertion -- fixture writes this exact protocol record */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexBridge } from "../../../cloud-computer/codex.mjs";
const dirs: string[] = [];
const bridges: CodexBridge[] = [];
afterEach(async () => {
  bridges.splice(0).forEach((b) => b.close());
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture(unsafe = false, unauthorized = false) {
  const home = await mkdtemp(join(tmpdir(), "downy-codex-"));
  dirs.push(home);
  const binary = join(home, "fake-codex");
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({input:process.stdin});
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line', line => { const m=JSON.parse(line); if(m.id===undefined)return;
fs.appendFileSync(process.env.CODEX_HOME+'/requests.jsonl',line+'\\n');
if(m.method==='account/read') return send({id:m.id,result:{account:{type:'chatgpt'}}});
if(m.method==='thread/start') return send({id:m.id,result:{thread:{id:'thread1'}}});
if(m.method==='turn/start') {
send({id:m.id,result:{turn:{id:'turn1'}}});
${unauthorized ? `send({method:"turn/completed",params:{threadId:"thread1",turn:{status:"failed",error:{message:"private-token-value",codexErrorInfo:"unauthorized"}}}});` : unsafe ? `send({method:'item/started',params:{threadId:'thread1',item:{type:'commandExecution'}}});` : `send({id:999,method:'item/tool/call',params:{threadId:'thread1',tool:'downy_0',arguments:{path:'workspace/report.md'}}});`}
return; }
send({id:m.id,result:{}});
});`,
    { mode: 0o755 },
  );
  const bridge = new CodexBridge(home, binary);
  bridges.push(bridge);
  await bridge.initialize();
  return { bridge, home };
}
it("returns tool intent without acknowledging execution and disables native capabilities", async () => {
  const { bridge, home } = await fixture();
  const result = await bridge.step({
    model: "gpt-5.5",
    system: "Downy",
    transcript: "read report",
    tools: [
      {
        name: "read",
        description: "Read file",
        inputSchema: { type: "object" },
      },
    ],
  });
  expect(result.toolCalls[0].name).toBe("read");
  const lines = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(
      (s) =>
        JSON.parse(s) as {
          method: string;
          params: {
            config: { features: { shell_tool: boolean } };
            sandbox: string;
          };
        },
    );
  const start = lines.find((l) => l.method === "thread/start")!;
  expect(start.params.config.features.shell_tool).toBe(false);
  expect(start.params.sandbox).toBe("read-only");
  expect(lines.some((l) => l.method === "turn/interrupt")).toBe(true);
});
it("fails closed on an unexpected native execution item", async () => {
  const { bridge } = await fixture(true);
  await expect(
    bridge.step({
      model: "gpt-5.5",
      system: "Downy",
      transcript: "test",
      tools: [],
    }),
  ).rejects.toThrow();
});

it("returns a reconnect code without provider error text or credentials", async () => {
  const { bridge } = await fixture(false, true);
  await expect(
    bridge.step({
      model: "gpt-5.5",
      system: "Downy",
      transcript: "test",
      tools: [],
    }),
  ).rejects.toMatchObject({ status: 401, message: "Codex step failed" });
});
