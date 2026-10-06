# Sourced by assert-pack.sh inside its disposable consumer with real Pi installed.
# shellcheck shell=sh
# shellcheck disable=SC2154 # work and PI_VERSION are supplied by assert-pack.sh.
cat > probe.mjs <<'NODE'
import { resolvePath } from "@pi-kit/shared/path";

export default function (pi) {
  if (resolvePath("a/../b", "/r") === "/r/b") {
    pi.registerCommand("shared-probe", {
      description: "Verify the packed shared library",
      handler: async () => {},
    });
  }
}
NODE

# Pi exits on stdin EOF, so hold stdin until its command response or 60 seconds.
# shellcheck disable=SC2094 # Intentional: poll Pi's output while stdin stays open.
{
  printf '%s\n' '{"id":"commands","type":"get_commands"}'
  i=0
  while [ "$i" -lt 60 ] && ! grep -qs '"id":"commands".*"type":"response"' "$work/pi-out.txt"; do
    sleep 1
    i=$((i + 1))
  done
} | \
  PI_CODING_AGENT_DIR="$work/pi-home" PI_OFFLINE=1 \
  "$work/consumer/node_modules/.bin/pi" --no-extensions \
    -e ./probe.mjs \
    --offline --no-session --mode rpc > "$work/pi-out.txt" 2>&1 || {
      echo "pi exited non-zero while running the packed library probe" >&2
      cat "$work/pi-out.txt" >&2
      exit 1
    }

if ! node - "$work/pi-out.txt" <<'NODE'
const { readFileSync } = require("node:fs");
const output = readFileSync(process.argv[2], "utf8");
const events = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const command = events.some(
  (event) => event.id === "commands" && event.type === "response" && event.command === "get_commands" && event.success === true &&
    (event.data?.commands ?? []).some((command) => command.name === "shared-probe"),
);
const loaded = !/error loading extension|failed to load extension|cannot find module/i.test(output);
if (!command || !loaded) {
  console.error(`packed library RPC probe failed: shared-probe=${command}, loaded=${loaded}`);
  process.exit(1);
}
NODE
then
  cat "$work/pi-out.txt" >&2
  exit 1
fi

echo "packed library loads through Pi under pi ${PI_VERSION}"
