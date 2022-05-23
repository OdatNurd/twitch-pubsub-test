// =============================================================================


const WebSocketWrapper = require("ws-wrapper");


// =============================================================================


/* This is a simple wrapper that will create and return a wrapped WebSocket
 * class instance that tries to remain connected to the host and port provided.
 *
 * The role of the socket is transmitted to the remote server via a specific
 * message every time the socket connects, which announces to the server what
 * this socket is going to be used for. The server can use this to direct
 * specific traffic to specific clients as desired based on their role.
 *
 * The returned socket will attempt to keep itself connected by noticing when it
 * is disconnected or errors out and triggering a manual connection, until the
 * socket is eventually connected again.
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

  // Every time the socket connects, display a message saying that it happened,
  // then announce to the remote end what our role is and, if a callback was
  // provided, invoke it to indicate that there is now a connection.
  socket.on("open", event => {
    console.log(`connect: ${event.target.url} as ${role}`);
    socket.emit('role-announce', role);

    if (callback !== undefined) {
      callback(true);
    }
  });

  // In the event that our socket disconnects, wait a few seconds and then try
  // to re-establish the connection again. This also invokes the callback (if
  // any) to tell an interested party that the connection has been lost.
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
 * of a socket. */
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