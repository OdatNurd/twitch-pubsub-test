// =============================================================================

require('dotenv').config();

const { config } = require('./config');

const express = require('express');

const { decrypt } = require('./crypto');
const { initializeDatabase } = require('./db');
const { setupWebSockets } = require('./socket');

const { setupTwitchAuthorization, setupTwitchAccess } = require('./twitch');
const { setupTwitchPubSub } = require('./pubsub');
const { setupEventTesting } = require('./testing');
const { setupTwitchChat, chatSay } = require('./chat');
const { setupGiveawayHandler } = require('./giveaway');
const { setupDropGame } = require('./drop_commands');

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
  const db = initializeDatabase();

  // The express application that houses the routes that we use to carry out
  // authentication with Twitch as well as serve user requests.
  const app = express();
  app.use(express.json());

  // Handle requests from clients that want to know some runtime configuration
  // information such as the websocket port to connect on or the current
  // locations of various overlay elements.
  app.get('/config', async (req, res) => {
    res.json({
      socketPort: config.get('server.socketPort'),
      bitsLeadersCount: config.get('leaderboard.bitsLeadersCount'),
      subsLeadersCount: config.get('leaderboard.subsLeadersCount'),
      overlays: await db.overlay.findMany({})
    });
  });

  // Set up the our chat system, the routes for our Twitch authorization and for
  // the testing services that we use to generate fake events.
  //
  // Ordering is important here; some systems rely on the events that the Twitch
  // portion generates and so they need to be initialized first so they can
  // catch any possible initial events.
  setupTwitchChat(bridge);
  setupTwitchPubSub(db, bridge);
  setupTwitchAuthorization(db, app, bridge);
  setupEventTesting(db, app, bridge);
  setupGiveawayHandler(db, app, bridge);
  setupDropGame(bridge, chatSay);

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
  const token = await db.token.findFirst({});
  if (token !== null) {
    try {
      // Prisma doesn't allow for JSON fields or arrays, so manually convert the
      // scopes array from a string to an array.
      token.scopes = JSON.parse(token.scopes);

      // Directly invoke the routine in the Twitch code that would normally
      // be invoked by the Twitch auth flow; vaguely messy but it gets the job
      // done.
      await setupTwitchAccess(db, token, bridge);
    }
    catch (e) {
      console.log(`Error loading previous token: ${e}`);

      // Get rid of the token we loaded; it is not actually valid.
      await db.token.deleteMany({});
    }
  }
}


// =============================================================================


/* Launch the application. */
launch();
