// =============================================================================


const { config } = require('./config');

const { Server } = require("ws");
const WebSocketWrapper = require("ws-wrapper");


// =============================================================================


/* When we start up, we set up a websocket server to allow our overlay and
 * control page to talk to us and (by extension) each other. This sets the port
 * that's used, and the set holds the list of clients that are currently
 * connected so we can send them messages. */
const socketPort = config.get('server.socketPort');
let webClients = new Set();


// =============================================================================


/* Set up the websocket listener that the overlay and the control panel will use
 * to communicate with the server and get updates. We do this rather than a long
 * poll so that everything is more interactive and speedy.
 *
 * When new sockets are connected, an event is raised on the provided event
 * bridge to let interested parties know; they can use this information to
 * disseminate important information to new connections, for example. */
 function setupWebSockets(bridge) {
  const server = new Server({ port: socketPort });
  console.log(`Listening for socket requests on http://localhost:${socketPort}`);

  server.on("connection", (webSocket) => {
    console.log('=> incoming connection');

    // Register a new connection by wrapping the incoming socket in one of our
    // socket wrappers, and add it to the list of currently known clients.
    const socket = new WebSocketWrapper(webSocket);
    webClients.add(socket);

    // Let interested parties know that there's a new socket connected, in case
    // they need to take some action.
    bridge.emit('socket-connect', socket);

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