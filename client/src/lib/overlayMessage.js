// Normalize an inbound Zoom onMessage event into the overlay snapshot object.
//
// The SDK type says OnMessageEvent = { timestamp, payload: JSONObject, ... }, but at
// runtime the panel->camera (Layers) hop delivers the payload as a JSON *string*. The
// live diagnostics trace showed every received message with keys:null/status:null —
// the envelope arrived 1:1 with sends, but the body was an unparsed string. So:
//   - take evt.payload when evt is an object carrying that key, else evt itself
//     (the mock loops the raw object straight back, with no envelope);
//   - if the result is a string, JSON.parse it; if parsing fails, return the string
//     unchanged (never throw — a malformed message must not break the receiver).
export function normalizeIncomingMessage(evt) {
  let payload = evt && typeof evt === 'object' && 'payload' in evt ? evt.payload : evt;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      /* not JSON — leave the raw string for the caller to handle/ignore */
    }
  }
  return payload;
}
