#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
verify_dir="$(mktemp -d)"
export DSH_HOME="$verify_dir/dsh-home"
mkdir -p "$DSH_HOME" "$verify_dir/package"

package_json="$(npm pack "$repo_dir" --pack-destination "$verify_dir/package" --json)"
archive="$(printf '%s' "$package_json" | jq -r '.[0].filename')"
archive_path="$verify_dir/package/$archive"

dsh integration --from-default-profile web --dump-config > "$verify_dir/default-config.yml"
dsh plugin --profile integration add "$archive_path" --save-exact
dsh integration --dump-config > "$verify_dir/composed-config.yml"
dsh plugin --profile integration list --json --depth=0 > "$verify_dir/dependencies.json"

grep -q 'hanger-conversation-experience' "$verify_dir/composed-config.yml"
grep -q 'hanger-quota-monitor' "$verify_dir/composed-config.yml"
grep -q 'hanger-node-repl' "$verify_dir/composed-config.yml"
jq -e '.[0].dependencies."@hanger-source/hang-dsh-plugins"' "$verify_dir/dependencies.json" > /dev/null

runtime_log="$verify_dir/runtime.log"
DSH_HOME="$DSH_HOME" dsh integration --no-open --port 0 > "$runtime_log" 2>&1 &
runtime_pid=$!
trap 'kill -INT "$runtime_pid" 2>/dev/null || true' EXIT

runtime_url=""
for _ in {1..100}; do
  runtime_url="$(grep -Eo -m 1 'http://127\.0\.0\.1:[0-9]+/\?token=[^[:space:]]+' "$runtime_log" || true)"
  [ -n "$runtime_url" ] && break
  kill -0 "$runtime_pid" 2>/dev/null || { sed -n '1,120p' "$runtime_log" >&2; exit 1; }
  sleep 0.1
done
[ -n "$runtime_url" ] || { echo 'official DSH host did not become ready' >&2; exit 1; }

cookie_jar="$verify_dir/cookies.txt"
index_html="$verify_dir/index.html"
curl --silent --show-error -c "$cookie_jar" "$runtime_url" > /dev/null
origin="${runtime_url%%/\?token=*}"
curl --silent --show-error --fail -b "$cookie_jar" "$origin/" > "$index_html"
grep -q '@hanger-source/dsh-conversation-experience' "$index_html"
grep -q '@hanger-source/dsh-quota-monitor' "$index_html"

kill -INT "$runtime_pid"
wait "$runtime_pid" || true
trap - EXIT

echo "official DSH install verified: $archive_path"
echo "verification workspace retained at: $verify_dir"
