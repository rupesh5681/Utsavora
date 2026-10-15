#!/usr/bin/env bash
# Runs a command; if it fails, publishes the tail of its output as a GitHub annotation
# (readable through the API even when raw logs are not), then exits with the same code.
set -o pipefail
out=$(mktemp)
"$@" 2>&1 | tee "$out"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  # Keep failure-relevant lines, drop stack frames, encode newlines for the annotation.
  grep -v '^\s*at ' "$out" | tail -c 60000 | node -e '
    let s = require("fs").readFileSync(0, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    const chunks = s.match(/[\s\S]{1,9000}/g) || [];
    chunks.forEach((c, i) => console.log(`::error title=Failure output ${i + 1}/${chunks.length}::` + c.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A")));
  '
fi
exit "$code"
