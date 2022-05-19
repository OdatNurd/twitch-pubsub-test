// =============================================================================


const WebSocketWrapper = require("ws-wrapper");


// =============================================================================


/* This is a simple wrapper that will create and return a wrapped WebSocket
 * class instance that tries to remain connected to the host and port provided.
 *
 * The returned socket will attempt to keep itself connected by noticing when it
 * is disconnected or errors out and triggering a manual connection, until the
 * socket is eventualy connected again.
 *
 * If provided, the callback will be invoked every time the connection state
 * changes, and be passed a boolean that's true if the socket is connected and
 * false if it's not. */
function getWebSocket(hostname, port, role, callback) {
  // Construct the URL that we're going to be connecting to.
  const url = `ws://${hostname}:${port}`;

  // Wrap a native websocket in our wrapper library; this will immediately
  // connect the socket.
  const socket = new WebSocketWrapper(new WebSocket(url));

  // Purely for informational reasons, display connection information so that
  // we can verify that things are working as expected.
  socket.on("open", event => {
    console.log(`connect: ${event.target.url} as ${role}`);
    socket.emit('role-announce', role);

    if (callback !== undefined) {
      callback(true);
    }
  });

  // In the event that our socket disconnects, wait a few seconds and then try
  // to re-establish the connection again.
  socket.on('disconnect', (event, wasOpen) => {
    console.log(`disconnect: ${event.target.url}`);
    if (callback !== undefined) {
      callback(false);
    }

    setTimeout(() => socket.bind(new WebSocket(url)), 5000);
  });

  // If any error is detected on the socket, disconnect it if it's currently
  // connected; that will trigger a reconnect using the above logic.
  socket.on("error", event => {
    console.log(`error: ${event.target.url}`);
    socket.disconnect();
  });

  return socket;
}


// =============================================================================


/* This is a factory function which will return a callback suitable for use
 * with the getWebSocket function, and will adjust the div with the ID you pass
 * in here so that the text content and class represents the connection state
 * of some socket. */
function trackConnectionState(divId) {
  const connectionTxt = document.getElementById(divId);

  return connected => {
      // Flip the class states around based on the incoming status.
      connectionTxt.classList.remove(connected ? 'disconnected' : 'connected')
      connectionTxt.classList.add(connected ? 'connected' : 'disconnected')

      connectionTxt.innerText = connected ? 'Connected' : 'Disconnected';
    }
}

// =============================================================================


module.exports = {
  getWebSocket,
  trackConnectionState
}