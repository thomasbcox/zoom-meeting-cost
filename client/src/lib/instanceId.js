// A short id generated ONCE per webview load. Every app instance (the inMeeting
// side panel, the spawned inCamera render, etc.) gets its own value, so diagnostic
// logs from different instances in the same meeting can be told apart in /api/log.
// Module-scope const => stable for the life of this webview, regenerated on reload.

export const instanceId = `i_${Math.random().toString(36).slice(2, 8)}`;
