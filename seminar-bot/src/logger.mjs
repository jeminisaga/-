// Minimal structured-ish logger. Keeps output readable for a non-technical user
// while still being greppable. Timestamps use the local clock.
function ts() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function line(level, scope, args) {
  console.log(`${ts()} [${level}] [${scope}]`, ...args);
}

export function makeLogger(scope) {
  return {
    info: (...a) => line("info", scope, a),
    warn: (...a) => line("warn", scope, a),
    error: (...a) => line("error", scope, a),
  };
}
