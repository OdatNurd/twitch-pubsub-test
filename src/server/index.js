// =============================================================================

require('dotenv').config();

const { config } = require('./config');

const { SingleUserPubSubClient } = require('@twurple/pubsub');

const express = require('express');

const { decrypt } = require('./crypto');
const { initializeDatabase } = require('./db');
const { setupWebSockets, sendSocketMessage } = require('./socket');

const { twitch, setupTwitchAccess, shutdownTwitchAccess, handleAuthRoute, handleDeauthRoute, handleTwitchRedirectRoute } = require('./twitch');
const { handleRedemption, handleSubscription, handleBits } = require('./handler');
const { setupTwitchChat, leaveTwitchChat, chatSay, chatDo } = require('./chat');


// =============================================================================


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function launch() {
  console.log(config.toString());

  // The handle to the database that we use to persist information between runs,
  // such as our tokens and the current leaderboards (for example).
  const db = await initializeDatabase();

  // The express application that houses the routes that we use to carry out
  // authentication with Twitch as well as serve user requests.
  const app = express();
  app.use(express.json());

  // Pull out the port on which the web server listens.
  const webPort = config.get('server.webPort');

  // This route kicks off our authorization with twitch. It will store some
  // local information and then redirect to Twitch to allow Twitch to carry out
  // the authentication process.
  //
  // The authentication is complete when Twitch redirects back to our
  // application, which can happen either after the user says they authorize,
  // after they cancel or not at all, if the user just closes the page.
  app.get('/auth', (req, res) => handleAuthRoute(req, res));

  // This route kicks off our de-authorization process, which will check to see
  // if we currently have an access token and, if we do, remove it before
  // redirecting back to the root page.
  app.get('/deauth', async (req, res) => {
      const model = db.getModel('tokens');
      handleDeauthRoute(model, req, res);
  });

  // This route is where Twitch will call us back after the user either
  // authorizes the application or declines to authorize.
  //
  // Twitch will send us back information about the authorization, which
  // includes a special code value that we can exchange for a token as well as
  // the state parameter that we gave Twitch when we started the authorization
  // attempt, so that we can verify that it's valid.
  app.get('/auth/twitch', async (req, res) => {
    const model = db.getModel('tokens');
    handleTwitchRedirectRoute(model, req, res);
  });

  // Handle requests from clients that want to know what port we serve our
  // websockets from, so that they know where to connect. This port is
  // controlled by the server.
  app.get('/config', async (req, res) => {
    res.json({socketPort: config.get('server.socketPort')});
  });

  // This simple test route allows the test panel to generate a fake bits
  // message so that we can more easily do testing.
  app.post('/test/bits', async (req, res) => {
    handleBits(req.body);
    res.json({success: true});
  })

  // This simple test route allows the test panel to generate a fake
  // subscription message so that we can more easily do testing.
  app.post('/test/subs', async (req, res) => {
    handleSubscription(req.body);
    res.json({success: true});
  })

  // Set up some middleware that will serve static files out of the public folder
  // so that we don't have to inline the pages in code.
  app.use(express.static('public'));

  // Get the server to listen for incoming requests.
  app.listen(webPort, () => {
      console.log(`Listening for web requests on http://localhost:${webPort}`);
  });

  // Start up the WebSocket listener
  setupWebSockets(twitch);

  // Try to fetch out a previous authorization token. If we find one, then we
  // can decrypt and refresh the token and set up our environment.
  const model = db.getModel('tokens');
  const token = await model.findOne({ id: 1 });
  if (token !== undefined) {
    token.accessToken = decrypt(token.accessToken);
    token.refreshToken = decrypt(token.refreshToken);
    await setupTwitchAccess(model, token);
    setupTwitchChat(twitch);
  }
}


// =============================================================================


/* Launch the application. */
launch();