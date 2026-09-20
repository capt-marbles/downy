import { z } from "zod";
import { metaData, type ManagedCall } from "./managed-protocol";
import { airtableFailure } from "./airtable-diagnostics";

const Schema = z.object({
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      fields: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          options: z
            .object({ choices: z.array(z.object({ name: z.string() })) })
            .optional(),
        }),
      ),
    }),
  ),
});
// Composio offloads large successful results even when sync_response_to_workbench
// is false. Use only its returned JSON file, with a fixed read-only projection.
// This is not an agent-exposed Python executor or permission to run app actions.
export async function readOffloadedAirtableSchema(
  call: ManagedCall,
  sessionId: string,
  remoteInfo: unknown,
) {
  const info = z
    .object({
      file_path: z
        .string()
        .max(1000)
        .refine(
          (p) =>
            /^\/mnt\/[a-zA-Z0-9_./-]+\.json$/.test(p) &&
            !p.split("/").some((s) => s === "." || s === ".."),
        ),
    })
    .safeParse(remoteInfo);
  if (!info.success)
    throw airtableFailure(
      remoteInfo,
      "response_invalid",
      "remote_file_metadata",
    );
  const code = `import json, os, stat, gzip, base64
p = os.path.realpath(${JSON.stringify(info.data.file_path)})
assert p.startswith('/mnt/')
with open(p, 'rb') as f:
    st = os.fstat(f.fileno())
    assert stat.S_ISREG(st.st_mode) and st.st_size <= 16777216
    doc = json.load(f)
if isinstance(doc, dict) and 'data' in doc and 'results' not in doc:
    doc = doc['data']
items = doc if isinstance(doc, list) else doc['results']
assert len(items) == 1 and items[0]['tool_slug'] == 'AIRTABLE_GET_BASE_SCHEMA'
assert not items[0].get('error')
r = items[0]['response']
assert r['successful'] is True and not r.get('error')
tables = []
for t in r['data']['tables']:
    fields = []
    for f in t['fields']:
        item = {k: f[k] for k in ('id', 'name', 'type')}
        if 'choices' in f.get('options', {}):
            item['options'] = {'choices': [{'name': c['name']} for c in f['options']['choices']]}
        fields.append(item)
    tables.append({'id': t['id'], 'name': t['name'], 'fields': fields})
payload = json.dumps({'tables': tables}, separators=(',', ':')).encode()
assert len(payload) <= 1048576
print(json.dumps({'schema_gzip_base64': base64.b64encode(gzip.compress(payload)).decode()}))`;
  const raw = await call("COMPOSIO_REMOTE_WORKBENCH", {
    session_id: sessionId,
    code_to_execute: code,
    current_step: "READING_AIRTABLE_SCHEMA",
  });
  const data = z
    .object({
      stdout: z.string().max(200_000),
      stderr: z.string(),
      error: z.string().nullish(),
      stdout_file_path: z.string().nullish(),
    })
    .parse(metaData(raw));
  if (data.stderr || data.error || data.stdout_file_path)
    throw airtableFailure(null, "response_invalid", "schema_projection");
  const { schema_gzip_base64: encoded } = z
    .object({
      schema_gzip_base64: z
        .string()
        .max(180_000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .parse(JSON.parse(data.stdout));
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576)
        throw airtableFailure(null, "response_invalid", "schema_size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return Schema.parse(JSON.parse(new TextDecoder().decode(output)));
}
