// Resolve the port the server should listen on.
//
// API_PORT wins so dev launchers that inject a generic PORT (e.g. a preview
// panel pointing PORT at the web port) can't steer the API onto the wrong port.
// In production (single Express server on Railway) PORT is platform-provided.
// Falls back to 8787 for plain local runs.

export function resolvePort(env = process.env) {
  return env.API_PORT || env.PORT || 8787;
}
