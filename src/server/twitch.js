// =============================================================================


const { config } = require('./config');

const { RefreshingAuthProvider, exchangeCode } = require('@twurple/auth');
const { ApiClient } = require('@twurple/api');

const { v4: uuidv4 } = require('uuid');
const { objId } = require('./db');

const { broadcastSocketMessage } = require('./socket');
const { encrypt, decrypt } = require('./crypto');


// =============================================================================


/* The scopes to request access for when we authenticate with twitch. */
const bot_token_scopes = ['chat:read', 'chat:edit',
                          'bits:read',
                          'channel:read:redemptions',
                          'channel_subscriptions'];


// =============================================================================


/* Whenever we redirect to Twitch to do authorization, Twitch needs to know how
 * to redirect the page back to our application. In addition, some requests
 * require that we provide this even though it's not used (such as when
 * exchanging our token code for an actual token). */
const redirect_uri = config.get('twitch.callbackURL');

/* The ClientID asd ClientSecret of the underlying application. */
const clientId = config.get('twitch.clientId');
const clientSecret = config.get('twitch.clientSecret');

/* When a Twitch authorization is in progress, this represents the state code
 * that was passed to Twitch when we redirected there. Twitch will send this
 * back when it redirects back to us after the authentication either succeeds
 * or is cancelled.
 *
 * This allows us to verify that incoming requests are genuine and represent
 * actual responses from Twitch instead of just spoofs. */
let state = undefined;

/* When an authentication has occurred and we have an access token that will
 * allow us to talk to Twitch on behalf of this user, the following values
 * are set up.
 *
 * This object wraps the objects that directly tell us about the user that is
 * currently authorized for the overlay, including an API handle that allows us
 * to make API requests on behalf of that user.
 *
 * When the fields are undefined, there is no currently authorized user. */
let twitch = {
  /* A Twurple Authorization Provider; can be used to fetch and refresh tokens. */
  authProvider: undefined,

  /* The currently authenticated user. */
  userInfo: undefined,

  /* A Twurple ApiClient that allows us to talk to the Twitch API. */
  api: undefined,
}


// =============================================================================


/* Send out a Twitch authorization message using the currently authorized user
 * information (if any); the message goes either to the specific socket given
 * if there is one, or to all connected sockets if not. */
function sendTwitchAuthUpdate(socket) {
  const msg = {
      authorized: twitch.authProvider !== undefined,
      userName: twitch.userInfo !== undefined ? twitch.userInfo.displayName : undefined,
      userId: twitch.userInfo !== undefined ? twitch.userInfo.id : undefined
    };

  if (socket !== undefined) {
    socket.emit('twitch-auth', msg);
  } else {
    broadcastSocketMessage('twitch-auth', msg);
  }
}


// =============================================================================


/* Given an object that is a database record that represents token data, set up
 * our Twitch integrations.
 *
 * If this token is owned by a user who is not already in the user list, then
 * this will add them and associate them with the token. */
async function setupTwitchAccess(db, token, bridge) {
  // If we've already set up Twitch access, be a giant coward and refuse to do
  // it again. The user needs to deauth first.
  if (twitch.authProvider !== undefined) {
    return;
  }

  // Our incoming token data is encrypted, so before we can use it for anything
  // we need to decrypt it.
  token.accessToken = decrypt(token.accessToken);
  token.refreshToken = decrypt(token.refreshToken);

  try {
    // Create a Twurple authorization provider; this will take the token info as
    // it was given and make sure that the tokens are always kept up to date; so
    // if the application is long lived the token will be refreshed as needed.
    twitch.authProvider = new RefreshingAuthProvider(
      {
        clientId: clientId,
        clientSecret: clientSecret,
        onRefresh: async newData => {
          console.log(`Refreshing user token`);
          await db.token.update({
            where: { id: token.id },
            data: {
              accessToken: encrypt(newData.accessToken),
              refreshToken: encrypt(newData.refreshToken),
              scopes: JSON.stringify(newData.scopes || []),
              obtainmentTimestamp: newData.obtainmentTimestamp,
              expiresIn: newData.expiresIn
            }
          });
        }
      },
      token
    );

    // Set up a Twitch API wrapper using the authorization provider, and then
    // use it to gather information about the current user.
    twitch.api = new ApiClient({ authProvider: twitch.authProvider });
    twitch.userInfo = await twitch.api.users.getMe();

    // If our incoming token doesn't have a userId in it yet, then we either
    // need to create a new record for that user or associate the token with the
    // existing record; a user could be in the table because they authorized
    // previously.
    if (token.userId === null) {
      // Try to find an existing user record in the database for this particular
      // user; there might be one from a previous authorization or gifting
      // incident.
      let dbUser = await db.user.findFirst({
        where: { userId: twitch.userInfo.userId }
      });

      // If we didn't find anything, add in a new record for that user.
      if (dbUser == null) {
        dbUser = await db.user.create({
          data: {
            userId: twitch.userInfo.id,
            userName: twitch.userInfo.name,
            displayName: twitch.userInfo.displayName
          }
        });
      }

      // Update the relation in the token to know that this is the associated
      // user.
      await db.token.update({
        where: { id: token.id },
        data: {
          userId: dbUser.userId
        }
      });
    }
  }
  catch (e) {
    // If there was an error, make sure that everyone knows that Twitch is not
    // connected.
    twitch.authProvider = undefined;
    twitch.api = undefined;
    twitch.userInfo = undefined

    throw e;
  }

  // Tell interested parties that we're now authorized.
  bridge.emit('twitch-authorize', twitch);

  // Transmit to all listeners the fact that we're currently authorized, and who
  // the authorized user is.
  sendTwitchAuthUpdate();

  console.log('Twitch integration setup complete');
}


// =============================================================================


/* This removes all current Twitch integrations that have been set up (if any),
 * in preparation for the user logging out of Twitch or changing their
 * current authorization. */
async function shutdownTwitchAccess(bridge) {
  // If we have not already set up Twitch access, there's nothing to shut down
  if (twitch.authProvider === undefined) {
    return;
  }

  // Clobber away our authorization provider and twitch API handle, as well as
  // the cached information on the current user.
  twitch.authProvider = undefined;
  twitch.api = undefined;
  twitch.userInfo = undefined;

  // Tell interested parties that we're no longer authorized.
  bridge.emit('twitch-deauthorize', twitch);

  // Let all connected listeners know that we are no longer authorized.
  sendTwitchAuthUpdate();

  console.log('Twitch integrations have been shut down');
}


// =============================================================================


/* This route kicks off our authorization with twitch. It will store some local
 * information and then redirect to Twitch to allow Twitch to carry out the
 * authentication process.
 *
 * The authentication is complete when Twitch redirects back to our application,
 * which can happen either after the user says they authorize, after they cancel
 * or not at all, if the user just closes the page. */
function authorize(req, res) {
  // If we're already authorized, then we don't want to try to authorize again.
  // So in that case, we can just leave.
  if (twitch.authProvider !== undefined) {
    console.log('The user is already authenticated; stopping the auth flow');
    return res.redirect('/panel/');
  }

  // When we make our request to Twitch, we provide it a random state string; it
  // will return it back untouched, allowing us to verify when the appropriate
  // route gets contacted that the response provided relates to the one that we
  // sent out.
  //
  // In our simple case here we assume only a single login is going on at a time
  // and will reject anything that doesn't match. In a larger application this
  // would be used to associate incoming authorizations with the requests that
  // originally started them.
  state = uuidv4();
  const params = {
    client_id: clientId,
    redirect_uri,
    force_verify: true,
    response_type: 'code',
    scope: bot_token_scopes.join(' '),
    state
  };

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${new URLSearchParams(params)}`);
};


// =============================================================================


/* This route kicks off our de-authorization process, which will check to see if
 * we currently have an access token and, if we do, remove it before redirecting
 * back to the root page. */
async function deauthorize(db, bridge, req, res) {
  // If we are actually authorized, then remove authorization before we redirect
  // back. In the case where we're not authorized, skip calling these (even
  // though it is fine to do so).
  if (twitch.authProvider !== undefined) {
    // Fetch the model that stores our token information, then remove the stored
    // token.
    await db.token.deleteMany({});

    // Shut down our access to Twitch; this will remove all cached information and
    // stop us from receiving messages or talking to the API.
    shutdownTwitchAccess(bridge);
  }

  res.redirect('/panel/');
};


// =============================================================================


/* This route is where Twitch will call us back after the user either authorizes
 * the application or declines to authorize.
 *
 * Twitch will send us back information about the authorization, which includes
 * a special code value that we can exchange for a token as well as the state
 * parameter that we gave Twitch when we started the authorization attempt, so
 * that we can verify that it's valid. */
async function twitchCallback(db, bridge, req, res) {
  // The query parameters that come back include a code value that we need to
  // use to obtain our actual access token and the state value that we
  // originally provided to Twitch when the authorization started.
  const code = req.query.code;
  const inState = req.query.state;

  // If the incoming state value doesn't match the one we used when we started
  // the authorization, then someone may be trying to spoof us.
  //
  // This can also happen if there is more than one authorization in progress at
  // a time, but in our simple example we don't handle that. In a more robust
  // sample, you could use the state to associate this call with the one that
  // started it to know who you're authorizing.
  if (req.query.state !== state) {
    console.log(`auth callback got out of date authorization code; potential spoof?`);
    return res.redirect('/panel/');
  }

  // If the user actually authorizes us, then Twitch sends us a code that we can
  // use in combination with our client ID and client secret to get the actual
  // access token that we require.
  //
  // If they instead decline, the code parameter will not be present.
  if (code !== undefined) {
    // Exchange the code we were given with Twitch to get an access code. This
    // makes a request to the Twitch back end.
    const rawToken = await exchangeCode(
      clientId,
      clientSecret,
      code, redirect_uri);

    // Create a new token record in the database from the raw token we got.  In
    // this record we need to make sure that the access and refresh tokens  are
    // encrypted.
    const token = await db.token.create({
      data: {
        id: objId(),
        accessToken: encrypt(rawToken.accessToken),
        refreshToken: encrypt(rawToken.refreshToken),
        scopes: JSON.stringify(rawToken.scopes || []),
        obtainmentTimestamp: rawToken.obtainmentTimestamp,
        expiresIn: rawToken.expiresIn
      }
    });

    // Set up our access to Twitch, including our authorization
    await setupTwitchAccess(db, token, bridge);
  }

  return res.redirect('/panel/');
};


// =============================================================================


/* Set up the application routes on the web server that allow us to handle the
 * Twitch Authorization and Deauthorization flow; this only needs to be done
 * one time and needs to be given the database so that it can persist any
 * token changes, and the application instances so that it can set up the routes
 * that it requires. */
function setupTwitchAuthorization(db, app, bridge) {
  // Let interested parties know that there's a new socket connected, in case
  // they need to take some action.
  bridge.on('socket-connect', data => {
    // Send a message to this socket to tell it the Twitch authorization state.
    // Further updates will automatically occur as they happen.
    sendTwitchAuthUpdate(data.socket);
  });

  // This route kicks off our authorization with twitch. It will store some
  // local information and then redirect to Twitch to allow Twitch to carry out
  // the authentication process.
  //
  // The authentication is complete when Twitch redirects back to our
  // application, which can happen either after the user says they authorize,
  // after they cancel or not at all, if the user just closes the page.
  app.get('/auth', (req, res) => authorize(req, res));

  // This route is where Twitch will call us back after the user either
  // authorizes the application or declines to authorize.
  //
  // Twitch will send us back information about the authorization, which
  // includes a special code value that we can exchange for a token as well as
  // the state parameter that we gave Twitch when we started the authorization
  // attempt, so that we can verify that it's valid.
  app.get('/auth/twitch', async (req, res) => twitchCallback(db, bridge, req, res));

  // This route kicks off our de-authorization process, which will check to see
  // if we currently have an access token and, if we do, remove it before
  // redirecting back to the root page.
  app.get('/deauth', async (req, res) => deauthorize(db, bridge, req, res));
}

// =============================================================================


module.exports = {
  setupTwitchAuthorization,
  setupTwitchAccess,
}