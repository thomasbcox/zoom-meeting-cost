// Thin WebSocket client for the shared meeting-cost state.
//
// The presenter calls publish() with sanitized shared state; every connected
// client (presenter + viewers) receives 'state' messages via onState.
// Reconnects automatically with a small backoff.

export function createSyncClient({ roomId, role, onState, onStatus }) {
  const url = buildWsUrl();
  let ws = null;
  let closed = false;
  let reconnectTimer = null;

  function setStatus(s) {
    if (onStatus) onStatus(s);
  }

  function connect() {
    setStatus('connecting');
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('connected');
      send({ type: 'join', roomId, role });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'state' && onState) onState(msg.state);
    };

    ws.onclose = () => {
      setStatus('disconnected');
      if (!closed) reconnectTimer = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  connect();

  return {
    publish(state) {
      send({ type: 'publish', roomId, state });
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws && ws.close();
      } catch {
        /* noop */
      }
    },
  };
}

function buildWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
