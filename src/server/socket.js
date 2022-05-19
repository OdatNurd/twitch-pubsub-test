// =============================================================================


const { config } = require('./config');

const { Server } = require("ws");
const WebSocketWrapper = require("ws-wrapper");


// =============================================================================


/* When we start up, we set up a websocket server to allow our overlay and
 * control page(s) to talk to us and (by extension) each other. This sets the
 * port that's used, and the set holds the list of clients that are currently
 * connected so we can send them messages as a group. */
const socketPort = config.get('server.socketPort');
const allClients = new Set();

/* As connections arrive they send us an announcement message that tells us
 * what their role is (panel, test panel, overlay, etc). For each role that we
 * get, we insert a new set into this object and put that socket into the set.
 *
 * That allows us to know when sockets of specific roles are having events, or
 * or be able to send all messages to just a certain class of socket. */
const clientRoles = {}


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
    // Register a new connection by wrapping the incoming socket in one of our
    // socket wrappers, and add it to the list of currently known clients.
    const socket = new WebSocketWrapper(webSocket);

    // Every incoming socket is expected to send us an event that tells us what
    // role it has; the names are not strictly defined, but some back end code
    // may want to take action only for certain roles.
    //
    // Once a role is announced, we let interested parties know that the socket
    // is connected, and what kind it is.
    socket.on('role-announce', role => {
      console.log(`=> incoming '${role}' connection`);

      // Add this socket to the list of every known client, regardless of role.
      allClients.add(socket);

      // Add this client under it's role; we may need to add a new key.
      clientRoles[role] = clientRoles[role] || new Set();
      clientRoles[role].add(socket);

      // Now that the structures are in place, tell anyone who's interested
      // about the new connection.
      bridge.emit('socket-connect', { socket, role });
    });

    // When this socket becomes disconnected, we need to clean up our lists of
    // sockets so that it no longer appears.
    socket.on("disconnect", () => {
      // Remove the client from the list of all clients.
      allClients.delete(socket);

      // Iterate over all of the roles to see where this client falls; when we
      // find the set that has this client in it, remove it and dispatch an
      // event.
      //
      // Although any particular socket should only ever be in a single
      // role, it's theoretically possible for it to send multiple messages,
      // in which case multiple events will trigger.
      for (const [role, clients] of Object.entries(clientRoles)) {
        if (clients.has(socket)) {
          clients.delete(socket);
          console.log(`==> '${role}' connection lost`);

          bridge.emit('socket-disconnect', { socket, role });
        }
      }

    });
  });
}


// =============================================================================


/* Transmits a socket event of the given type, with any additional arguments
 * provided, to all of the currently connected web clients. */
function sendSocketMessage(event, ...args) {
  allClients.forEach(socket => socket.emit(event, ...args));
}


// =============================================================================


module.exports = {
  setupWebSockets,
  sendSocketMessage,
}