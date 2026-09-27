#!/bin/bash
# Single-session runner: starts the server, runs all backend tests, stops the server.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$HOME/repos/hackathon-project"
node server.js > /tmp/backend.log 2>&1 &
SERVER_PID=$!
echo "server pid $SERVER_PID"
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://localhost:3000/health; then
    echo "server up after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" = "20" ]; then
    echo "SERVER FAILED TO COME UP"
    cat /tmp/backend.log
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
done
echo "--- server log ---"
cat /tmp/backend.log
echo "--- running backend-test.mjs ---"
node backend-test.mjs
TEST_EXIT=$?
echo "--- test exit: $TEST_EXIT ---"
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo "server stopped"
exit $TEST_EXIT
