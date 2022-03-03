// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');


// =============================================================================


/* Update the text in the overlay that indicates who is currently authorized.
 *
 * This is just a placeholder until more interesting things are possible. */
function setupTextBox(authorized, username) {
  const text = document.getElementById('text');
  if (authorized === true) {
    text.classList.remove('hide');
    text.innerText = `${username} has their account authorized for the overlay`;
  } else {
    text.classList.add('hide');
  }
}


// =============================================================================


/* Set up everything in the overlay. This initializes the state of everything,
 * ensures that we're connected to the back end socket server, and sets up the
 * appropriate handlers for knowing when key events occur. */
async function setup() {
  // At startup assume we're not authorized until we learn differently.
  setupTextBox(false);

  // Get our configuration, and then use it to connect to the back end so that
  // we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort);

  // When the Twitch authorization state changes, change the text in the overlay
  // box.
  socket.on("twitch-auth", data => {
    setupTextBox(data.authorized, data.userName);
  });

  socket.on("twitch-bits", data => {
    console.log(data);
  });

  socket.on("twitch-sub", data => {
    console.log(data);
  });
}


// =============================================================================


setup();
