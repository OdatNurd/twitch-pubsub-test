// =============================================================================

require('dotenv').config();

const { config } = require('./config');

const express = require('express');

const { decrypt } = require('./crypto');
const { initializeDatabase } = require('./db');
const { setupWebSockets } = require('./socket');

const { twitch, setupTwitchAuthorization, setupTwitchAccess } = require('./twitch');
const { setupGiveawayHandler } = require('./giveaway');
const { setupEventTesting } = require('./testing');
const { setupTwitchChat } = require('./chat');

const { EventEmitter } = require("events");


// =============================================================================


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function launch() {
  // console.log(config.toString());

  // Create a shared event emitter that allows us to "bridge" communications
  // between the various modules.
  let bridge = new EventEmitter();

  // The handle to the database that we use to persist information between runs,
  // such as our tokens and the current leaderboards (for example).
  const db = await initializeDatabase();

  // The express application that houses the routes that we use to carry out
  // authentication with Twitch as well as serve user requests.
  const app = express();
  app.use(express.json());

  // Handle requests from clients that want to know what port we serve our
  // websockets from, so that they know where to connect. This port is
  // controlled by the server.
  app.get('/config', async (req, res) => {
    res.json({socketPort: config.get('server.socketPort')});
  });

  // Set up the routes for our Twitch authorization and for the testing services
  // that we use to generate fake events.
  setupTwitchAuthorization(db, app, bridge);
  setupEventTesting(app);
  await setupGiveawayHandler(db, bridge);

  // Set up some middleware that will serve static files out of the public folder
  // so that we don't have to inline the pages in code.
  app.use(express.static('public'));

  // Get the server to listen for incoming requests.
  const webPort = config.get('server.webPort');
  app.listen(webPort, () => {
      console.log(`Listening for web requests on http://localhost:${webPort}`);
  });

  // Start up the WebSocket listener
  setupWebSockets(bridge);

  // Try to fetch out a previous authorization token. If we find one, then we
  // can decrypt and refresh the token and set up our environment.
  const model = db.getModel('tokens');
  const token = await model.findOne({ id: 1 });
  if (token !== undefined) {
    try {
      token.accessToken = decrypt(token.accessToken);
      token.refreshToken = decrypt(token.refreshToken);
      await setupTwitchAccess(model, token);
      setupTwitchChat(twitch);
    }
    catch (e) {
      console.log(`Error loading previous token: ${e}`);

      // Get rid of the token we loaded; it is not actually valid.
      await model.remove({ id: 1 });
    }
  }
}


// =============================================================================


/* Launch the application. */
launch();