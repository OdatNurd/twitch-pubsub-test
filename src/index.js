// =============================================================================


const { RefreshingAuthProvider, getTokenInfo, exchangeCode } = require('@twurple/auth');
const { SingleUserPubSubClient } = require('@twurple/pubsub');
const { ApiClient } = require('@twurple/api');

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const trilogy = require('trilogy');
const crypto = require('crypto');


// =============================================================================


/* The scopes to request access for when we authenticate with twitch. */
const bot_token_scopes = ['bits:read',
                          'channel:read:redemptions',
                          'channel_subscriptions'];

/* The schema for storing incoming tokens in the database. This is based on the
 * AccessToken class that's available in Twurple, and the field names here
 * mirror the ones used there. */
const TokenSchema = {
  id: 'increments',

  accessToken: { type: String, nullable: false },
  refreshToken: { type: String, nullable: true },
  scopes: { type: Array, defaultsTo: [] },
  obtainmentTimestamp: { type: Number, defaultsTo: 0 },
  expiresIn: { type: Number, defaultsTo: 0, nullable: true },
};

// =============================================================================


/* Set up a trilogy database handle to persist our data. */
const db = trilogy.connect('database.db');

/* The express application that houses the routes that we use to carry out
 * authentication with Twitch as well as serve user requests. */
const app = express();

/* The port on which the application listens and the URI that Twitch should
 * redirect back to whenever we communicate with it. */
const port = 3030;
const redirect_uri = `http://localhost:${port}/auth/twitch`

/* When we persist token information into the database, we first encrypt it to
 * ensure that casual inspection doesn't leak anything important. This sets the
 * algorithm that is used for the encryption. */
const algorithm = 'aes-256-ctr';

/* When a Twitch authorization is in progress, this represents the state code
 * that was passed to Twitch when we redirected there. Twitch will send this
 * back when it redirects back to us after the authentication either succeeds
 * or is cancelled.
 *
 * This allows us to verify that incoming requests are genuine and represent
 * actual responses from Twitch instead of just spoofs. */
let state = undefined;

/* When an authentication has occured and we have an access token that will
 * allow us to talk to Twitch on behalf of this user, the following values
 * are set up. */

/* A Twurple Authorization Provider; can be used to fetch and refresh tokens. */
let authProvider = undefined;

/* The currently authenticated user. */
let userInfo = undefined;

/* A Twurple ApiClient that allows us to talk to the Twitch API. */
let twitchApi = undefined;

/* A Twurple PubSub client that gives us information about subscribed events. */
let pubSubClient = undefined;


// =============================================================================


/* Handle an incoming channel point redemption PubSub message. This will trigger
 * for any custom defined channel point redemption in the channel; it does not
 * however trigger for built in channel point redeems, since Twitch handles them
 * itself. */
function handleRedemption(msg) {
  console.log(`channelId: ${msg.channelId}`);
  console.log(`defaultImage: ${msg.defaultImage}`);
  console.log(`id: ${msg.id}`);
  console.log(`message: ${msg.message}`);
  console.log(`redemptionDate: ${msg.redemptionDate}`);
  console.log(`rewardCost: ${msg.rewardCost}`);
  console.log(`rewardId: ${msg.rewardId}`);
  console.log(`rewardImage: ${msg.rewardImage}`);
  console.log(`rewardIsQueued: ${msg.rewardIsQueued}`);
  console.log(`rewardPrompt: ${msg.rewardPrompt}`);
  console.log(`rewardTitle: ${msg.rewardTitle}`);
  console.log(`status: ${msg.status}`);
  console.log(`userDisplayName: ${msg.userDisplayName}`);
  console.log(`userId: ${msg.userId}`);
  console.log(`userName: ${msg.userName}`);
};


// =============================================================================


/* Handle an incoming subscription PubSub message. This triggers for all
 * subscriptions, though we're primarily interested in gift subscriptions for
 * our purposes here. */
function handleSubscription(msg) {
  console.log(`cumulativeMonths: ${cumulativeMonths}`);
  console.log(`giftDuration: ${giftDuration}`);
  console.log(`gifterDisplayName: ${gifterDisplayName}`);
  console.log(`gifterId: ${gifterId}`);
  console.log(`gifterName: ${gifterName}`);
  console.log(`isAnonymous: ${isAnonymous}`);
  console.log(`isGift: ${isGift}`);
  console.log(`isResub: ${isResub}`);
  console.log(`message: ${message}`);
  console.log(`months: ${months}`);
  console.log(`streakMonths: ${streakMonths}`);
  console.log(`subPlan: ${subPlan}`);
  console.log(`time: ${time}`);
  console.log(`userDisplayName: ${userDisplayName}`);
  console.log(`userId: ${userId}`);
  console.log(`userName: ${userName}`);
};


// =============================================================================


/* Handle an incoming bit cheer PubSub message. This is triggered for all cheers
 * that occur. */
function handleBits(msg) {
  console.log(`bits: ${bits}`);
  console.log(`isAnonymous: ${isAnonymous}`);
  console.log(`message: ${message}`);
  console.log(`totalBits: ${totalBits}`);
  console.log(`userId: ${userId}`);
  console.log(`userName: ${userName}`);
};

// =============================================================================


/* Given an object that contains token data, set up the apporopriate Twitch
 * integrations. */
async function setupTwitchAccess(model, token) {
  // Create a Twurple authorization provider; this will take the token info as
  // it was given and make sure that the tokens are always kept up to date; so
  // if the application is long lived the token will be refreshed as needed.
  authProvider = new RefreshingAuthProvider(
    {
      clientId: process.env.TWITCHLOYALTY_CLIENT_ID,
      clientSecret: process.env.TWITCHLOYALTY_CLIENT_SECRET,
      onRefresh: async newData => {
        console.log(`Refreshing user token`);
        await model.update({ id: 1 }, {
          accessToken: encrypt(newData.accessToken),
          refreshToken: encrypt(newData.refreshToken),
          scopes: newData.scopes || [],
          obtainmentTimestamp: newData.obtainmentTimestamp,
          expiresIn: newData.expiresIn
        });
      }
    },
    token
  );

  // Set up a Twitch API wrapper using the authorization provider, and then
  // use it to gather information about the current user.
  twitchApi = new ApiClient({ authProvider });
  userInfo = await twitchApi.users.getMe();

  // Set up our PubSub client and listen for the events that will allow us to
  // track the leaderboard.
  pubSubClient = new SingleUserPubSubClient({ authProvider });
  pubSubClient.onRedemption(msg => handleRedemption(msg));
  pubSubClient.onSubscription(msg => handleSubscription(msg));
  pubSubClient.onBits(msg => handleBits(msg));

  console.log('Twitch stuff has been set up');
}

// =============================================================================


/* Given a piece of text, encrypt it. This will return an encrypted version of
 * the string suitable for passing to the decrypt endpoint. */
function encrypt(text) {
    // Create a new initialization vector for each encryption for extra
    // security; this makes the key harder to guess, but is required in order to
    // decrypt the data.
    const iv = crypto.randomBytes(16);

    // Do the encryption on the data, leaving it in an encrypted buffer.
    const cipher = crypto.createCipheriv(algorithm, process.env.TWITCHBOT_CRYPTO_SECRET, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    // The returned value needs to contain the initialization vector used during
    // the operation as well as the data, so bundle it into an object.
    //
    // We then convert that into a string and encode it as base64 so that it's a
    // single string that's easier on the eyes and easier to store in the
    // database.
    return Buffer.from(JSON.stringify({
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    })).toString('base64');
}


// =============================================================================


/* Given a piece of encrypted text that was returned from the encrypt function,
 * decrypt it and return the original string. */
function decrypt(text) {
    // Decode the incoming text back into base64, and then decode it back into
    // an object that contains the encrypted data and the vector used to create
    // it.
    const hash = JSON.parse(Buffer.from(text, 'base64').toString('utf-8'));
    const iv = Buffer.from(hash.iv, 'hex');

    // Create the object that will do the decrypt using the data from the hash
    const decipher = crypto.createDecipheriv(algorithm, process.env.TWITCHBOT_CRYPTO_SECRET, iv);
    const content = Buffer.from(hash.content, 'hex');

    // Return the decrypted data.
    return Buffer.concat([decipher.update(content), decipher.final()]).toString();
}


// =============================================================================


/* This route kicks off our authorization with twitch. It will store some local
 * information and then redirect to Twitch to allow Twitch to carry out the
 * authentication process.
 *
 * The authentication is complete when Twitch redirects back to our application,
 * which can happen either after the user says they authorize, after they cancel
 * or not at all, if the user just closes the page. */
app.get('/auth', (req, res) => {
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
    client_id: process.env.TWITCHLOYALTY_CLIENT_ID,
    redirect_uri,
    force_verify: true,
    response_type: 'code',
    scope: bot_token_scopes.join(' '),
    state
  };

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${new URLSearchParams(params)}`);
});


/* This route is where Twitch will call us back after the user either authorizes
 * the application or declines to authorize.
 *
 * Twitch will send us back information about the authorization, which includes
 * a special code value that we can exchange for a token as well as the state
 * parameter that we gave Twitch when we started the authorization attempt, so
 * that we can verify that it's valid. */
app.get('/auth/twitch', async (req, res) => {
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
    return res.redirect('/');
  }

  // If the user actually authorizes us, then Twitch sends us a code that we can
  // use in combination with our client ID and client secret to get the actual
  // access token that we require.
  //
  // If they instead decline, the code parameter will not be present.
  if (code !== undefined) {
    // Exchange the code we were given with Twitch to get an access code. This
    // makes a request to the Twitch back end.
    const token = await exchangeCode(
      process.env.TWITCHLOYALTY_CLIENT_ID,
      process.env.TWITCHLOYALTY_CLIENT_SECRET,
      code, redirect_uri);

    // Persist the token into the database; here we also encrypt the access and
    // refresh tokens to make sure that they don't accidentally leak.
    const model = await db.model('tokens', TokenSchema);
    await model.updateOrCreate({
      id: 1,
      accessToken: encrypt(token.accessToken),
      refreshToken: encrypt(token.refreshToken),
      scopes: token.scopes || [],
      obtainmentTimestamp: token.obtainmentTimestamp,
      expiresIn: token.expiresIn,
    });

    // Set up our access
    await setupTwitchAccess(model, token);
  }

  return res.redirect('/');
});

/* Set up some middleware that will serve static files out of the public folder
 * so that we don't have to inline the pages in code. */
app.use(express.static('public'));

/* Get the server to listen for incoming requests. */
app.listen(port, () => {
    console.log(`Listening for requests on http://localhost:${port}`);
});


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function setup() {
  // Fetch the model that we use to store our tokens.
  const model = await db.model('tokens', TokenSchema);

  // Try to fetch out the token. If we find one, then we can decrypt the token
  // and refresh token and pass them in to set up the environment.
  const token = await model.findOne({ id: 1 });
  if (token !== undefined) {
    token.accessToken = decrypt(token.accessToken);
    token.refreshToken = decrypt(token.refreshToken);
    setupTwitchAccess(model, token);
  }
}

setup();