// =============================================================================


const { Server } = require("ws");
const WebSocketWrapper = require("ws-wrapper");


// =============================================================================


/* When we start up, we set up a websocket server to allow our overlay and
 * control page to talk to us and (by extension) each other. This sets the port
 * that's used, and the set holds the list of clients that are currently
 * connected so we can send them messages. */
const socketPort = 4040;
let webClients = new Set();


// =============================================================================


/* Set up the websocket listener that the overlay and the control panel will use
 * to communicate with the server and get updates. We do this rather than a long
 * poll so that everything is more interactive and speedy.
 *
 * This needs to be given the authorization provider that's being used for the
 * Twitch system in order to be able to know if the server is currently
 * authorized or not; the user information for the provided user should also be
 * given so that it can be transmitted out to connecting clients. */
function setupWebSockets(twitch) {
  const server = new Server({ port: socketPort });

  server.on("connection", (webSocket) => {
    console.log('=> incoming connection');

    // Register a new connection by wrapping the incoming socket in one of our
    // socket wrappers, and add it to the list of currently known clients.
    const socket = new WebSocketWrapper(webSocket);
    webClients.add(socket);

    // Send a message to this socket to tell it the Twitch authorization state.
    // Further updates will automatically occur as they happen.
    socket.emit('twitch-auth', {
      authorized: twitch.authProvider !== undefined,
      userName: twitch.userInfo !== undefined ? twitch.userInfo.displayName : undefined
    });

    // Listen for this socket being disconnected and handle that situation by
    // removing it from the list of currently known clients.
    socket.on("disconnect", () => {
      console.log('==> client disconnected');
      webClients.delete(socket);
    });
  });
}


// =============================================================================


/* Transmits a socket event of the given type, with any additional arguments
 * provided, to all of the currently connected web clients. */
function sendSocketMessage(event, ...args) {
  webClients.forEach(socket => socket.emit(event, ...args));
}


// =============================================================================


module.exports = {
  setupWebSockets,
  sendSocketMessage,
}