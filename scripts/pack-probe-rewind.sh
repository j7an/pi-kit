# Sourced by assert-pack.sh inside its disposable consumer with real Pi installed.
# Pi supplies the faux provider; no network provider or credentials are needed.
cat > probe.mjs <<'NODE'
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

export default function (pi) {
  const faux = createFauxCore({ provider: "probe", models: [{ id: "probe" }] });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  pi.registerProvider("probe", {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "probe",
    api: faux.api,
    streamSimple: faux.streamSimple,
    models: [
      {
        id: "probe",
        name: "probe",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });
}
NODE

# Hold stdin open until the agent finishes: Pi exits immediately on EOF.
# shellcheck disable=SC2094 # Intentional: poll Pi's output while stdin stays open.
{
  printf '%s\n' \
    '{"id":"commands","type":"get_commands"}' \
    '{"id":"model","type":"set_model","provider":"probe","modelId":"probe"}' \
    '{"id":"prompt","type":"prompt","message":"probe"}'
  i=0
  while [ "$i" -lt 60 ] && ! grep -qs '"type":"agent_end"' "$work/pi-out.txt"; do
    sleep 1
    i=$((i + 1))
  done
} | \
  PI_CODING_AGENT_DIR="$work/pi-home" PI_OFFLINE=1 \
  "$work/consumer/node_modules/.bin/pi" --no-extensions \
    -e ./node_modules/@pi-kit/rewind \
    -e ./probe.mjs \
    --offline --no-session --mode rpc > "$work/pi-out.txt" 2>&1 || {
      echo "pi exited non-zero while running the packed extension probe" >&2
      cat "$work/pi-out.txt" >&2
      exit 1
    }

if ! node - "$work/pi-out.txt" "$work/pi-home/pi-kit-rewind/blobs" <<'NODE'
const { readFileSync, readdirSync } = require("node:fs");
const output = readFileSync(process.argv[2], "utf8");
const events = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const command = events.some(
  (event) => event.id === "commands" && event.type === "response" && event.command === "get_commands" && event.success === true &&
    (event.data?.commands ?? []).some((command) => command.name === "rewind"),
);
const write = events.some(
  (event) => event.type === "tool_execution_end" && event.toolName === "write" && event.isError === false,
);
let blobs = false;
try { blobs = readdirSync(process.argv[3]).length > 0; } catch {}
const ended = events.some((event) => event.type === "agent_end");
const loaded = !/error loading extension|failed to load extension|cannot find module/i.test(output);
if (!command || !write || !blobs || !ended || !loaded) {
  console.error(`packed extension RPC probe failed: rewind=${command}, write=${write}, blobs=${blobs}, ended=${ended}, loaded=${loaded}`);
  process.exit(1);
}
console.log(`packed extension RPC probe passed: rewind=${command}, write=${write}, blobs=${blobs}, ended=${ended}, loaded=${loaded}`);
NODE
then
  cat "$work/pi-out.txt" >&2
  exit 1
fi

echo "packed artifact installs, loads and records writes under pi ${PI_VERSION}"
