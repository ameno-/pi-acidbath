#!/usr/bin/env bash
# Run the clef status test against a pinned stub decision service.
#
#   bash scripts/run-clef-status-test.sh
#
# The status view is asserted on the *values* the service reports, so the test
# needs a service to read. The stub in scripts/stub-service.mjs implements the
# same contract shape and pins the tool_safety verdict by rule rather than by
# hash, so the thresholds it reports are deterministic.
#
# It starts the stub on a free port, runs the test, and always tears the stub
# down. Exit code is the test's.

set -u
cd "$(dirname "$0")/.." || exit 1

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
LOG=$(mktemp)

PORT="$PORT" node scripts/stub-service.mjs >"$LOG" 2>&1 &
STUB=$!

cleanup() {
	kill "$STUB" 2>/dev/null
	wait "$STUB" 2>/dev/null
	rm -f "$LOG"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
	if curl -s -o /dev/null "http://127.0.0.1:${PORT}/healthz"; then ready=1; break; fi
	sleep 0.1
done
if [ "$ready" -ne 1 ]; then
	echo "the stub decision service did not start:" >&2
	cat "$LOG" >&2
	exit 1
fi

STUB_BASE_URL="http://127.0.0.1:${PORT}" \
	node --experimental-strip-types --no-warnings scripts/test-clef-status.mjs
exit $?
