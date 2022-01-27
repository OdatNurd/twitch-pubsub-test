// =============================================================================

require('dotenv').config();

const { RefreshingAuthProvider, getTokenInfo, exchangeCode } = require('@twurple/auth');
const { SingleUserPubSubClient } = require('@twurple/pubsub');
const { ChatClient } = require('@twurple/chat');
const { ApiClient } = require('@twurple/api');

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { Server } = require("ws");
const WebSocketWrapper = require("ws-wrapper");

const trilogy = require('trilogy');
const crypto = require('crypto');


// =============================================================================


/* The scopes to request access for when we authenticate with twitch. */
const bot_token_scopes = ['chat:read', 'chat:edit',
                          'bits:read',
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
app.use(express.json());

/* The port on which the application listens and the URI that Twitch should
 * redirect back to whenever we communicate with it. */
const webPort = 3030;
const redirect_uri = `http://localhost:${webPort}/auth/twitch`

/* When we start up, we set up a websocket server to allow our overlay and
 * control page to talk to us and (by extension) each other. This sets the port
 * that's used, and the set holds the list of clients that are currently
 * connected so we can send them messages. */
const socketPort = 4040;
let webClients = new Set();

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

/* When an authentication has occurred and we have an access token that will
 * allow us to talk to Twitch on behalf of this user, the following values
 * are set up. */

/* A Twurple Authorization Provider; can be used to fetch and refresh tokens. */
let authProvider = undefined;

/* The currently authenticated user. */
let userInfo = undefined;

/* A Twurple ApiClient that allows us to talk to the Twitch API. */
let twitchApi = undefined;

/* When the chat system has been set up, these specify the chat client object
 * (which is a Twurple ChatClient instance) and the channel that the chat is
 * sending to (which is the name of the authorized user.
 *
 * Whenever we set up a chat client we need to listen for some events; if the
 * authorization is dropped, we have to leave the chat, and for that we need
 * to remove the listeners, and for that we need to track which ones we added;
 * that's what chatListeners is for. */
let chatClient = undefined;
let chatChannel = undefined;
let chatListeners = undefined;

/* A Twurple PubSub client that gives us information about subscribed events.
 * As we subscribe to events, we add the listeners to the listener array so
 * that if we need to, we can redact them. */
let pubSubClient = undefined;
let pubSubListeners = [];

// =============================================================================


/* Handle an incoming channel point redemption PubSub message. This will trigger
 * for any custom defined channel point redemption in the channel; it does not
 * however trigger for built in channel point redeems, since Twitch handles them
 * itself. */
function handleRedemption(msg) {
  sendSocketMessage('twitch-redeem', {
    authorized: true, userName: userInfo.displayName
  });

  console.log(`channelId: ${msg.channelId}`);              // channelId: 66586458
  console.log(`defaultImage: ${msg.defaultImage}`);        // defaultImage: [object Object]
  console.log(`id: ${msg.id}`);                            // id: d113cb94-13d3-487f-ab40-dd1d707df4e2
  console.log(`message: ${msg.message}`);                  // message: like this
  console.log(`redemptionDate: ${msg.redemptionDate}`);    // redemptionDate: Fri Jan 14 2022 22:50:25 GMT-0800 (Pacific Standard Time)
  console.log(`rewardCost: ${msg.rewardCost}`);            // rewardCost: 100
  console.log(`rewardId: ${msg.rewardId}`);                // rewardId: 648252cf-1b6d-409a-a901-1764f5abdd28
  console.log(`rewardImage: ${msg.rewardImage}`);          // rewardImage: [object Object]
  console.log(`rewardIsQueued: ${msg.rewardIsQueued}`);    // rewardIsQueued: false
  console.log(`rewardPrompt: ${msg.rewardPrompt}`);        // rewardPrompt: Consign your custom message to the bit bucket
  console.log(`rewardTitle: ${msg.rewardTitle}`);          // rewardTitle: /dev/null
  console.log(`status: ${msg.status}`);                    // status: FULFILLED
  console.log(`userDisplayName: ${msg.userDisplayName}`);  // userDisplayName: OdatNurd
  console.log(`userId: ${msg.userId}`);                    // userId: 66586458
  console.log(`userName: ${msg.userName}`);                // userName: odatnurd
};


// =============================================================================


/* Handle an incoming subscription PubSub message. This triggers for all
 * subscriptions, though we're primarily interested in gift subscriptions for
 * our purposes here. */
function handleSubscription(msg) {
  sendSocketMessage('twitch-sub', {
    gifterDisplayName: msg.gifterDisplayName,
    gifterId: msg.gifterId,
    userDisplayName: msg.userDisplayName,
    userId: msg.userId,
  });

  console.log(`cumulativeMonths: ${msg.cumulativeMonths}`);   // cumulativeMonths: 11                                            cumulativeMonths: 1
  console.log(`giftDuration: ${msg.giftDuration}`);           // giftDuration: null                                              giftDuration: 1
  console.log(`gifterDisplayName: ${msg.gifterDisplayName}`); // gifterDisplayName: null                                         gifterDisplayName: marisuemartin
  console.log(`gifterId: ${msg.gifterId}`);                   // gifterId: null                                                  gifterId: 499189939
  console.log(`gifterName: ${msg.gifterName}`);               // gifterName: null                                                gifterName: marisuemartin
  console.log(`isAnonymous: ${msg.isAnonymous}`);             // isAnonymous: false                                              isAnonymous: false
  console.log(`isGift: ${msg.isGift}`);                       // isGift: false                                                   isGift: true
  console.log(`isResub: ${msg.isResub}`);                     // isResub: true                                                   isResub: false
  console.log(`message: ${msg.message}`);                     // message: [object Object]                                        message: null
  console.log(`months: ${msg.months}`);                       // months: 11                                                      months: 1
  console.log(`streakMonths: ${msg.streakMonths}`);           // streakMonths: 11                                                streakMonths: 0
  console.log(`subPlan: ${msg.subPlan}`);                     // subPlan: 1000                                                   subPlan: 1000
  console.log(`time: ${msg.time}`);                           // time: Sun Jan 16 2022 10:07:01 GMT-0800 (Pacific Standard Time) time: Sun Jan 16 2022 10:07:29 GMT-0800 (Pacific Standard Time)
  console.log(`userDisplayName: ${msg.userDisplayName}`);     // userDisplayName: marisuemartin                                  userDisplayName: PhutBot
  console.log(`userId: ${msg.userId}`);                       // userId: 499189939                                               userId: 56740791
  console.log(`userName: ${msg.userName}`);                   // userName: marisuemartin                                         userName: phutbot
};

// =============================================================================


/* Handle an incoming bit cheer PubSub message. This is triggered for all cheers
 * that occur. */
function handleBits(msg) {
  sendSocketMessage('twitch-bits', {
    bits: msg.bits,
    isAnonymous: msg.isAnonymous,
    message: msg.message,
    totalBits: msg.totalBits,
    userId: msg.userId,
    userName : msg.userName,
  });

  console.log(`bits: ${msg.bits}`);                // bits: 100
  console.log(`isAnonymous: ${msg.isAnonymous}`);  // isAnonymous: false
  console.log(`message: ${msg.message}`);          // message: SeemsGood100
  console.log(`totalBits: ${msg.totalBits}`);      // totalBits: 1454
  console.log(`userId: ${msg.userId}`);            // userId: 136337257
  console.log(`userName: ${msg.userName}`);        // userName: valleydweller
};

// =============================================================================


/* Given an object that contains token data, set up the appropriate Twitch
 * integrations. */
async function setupTwitchAccess(model, token) {
  // If we've already set up Twitch access, be a giant coward and refuse to do
  // it again. The user needs to deauth first.
  if (authProvider !== undefined) {
    return;
  }

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
  // track the leader board. Since we may need to remove these, we need to
  // store the listeners as we add them.
  pubSubClient = new SingleUserPubSubClient({ authProvider });
  pubSubListeners = await Promise.all([
    pubSubClient.onRedemption(msg => handleRedemption(msg)),
    pubSubClient.onSubscription(msg => handleSubscription(msg)),
    pubSubClient.onBits(msg => handleBits(msg)),
  ]);

  // Transmit to all listeners the fact that we're currently authorized, and who
  // the authorized user is.
  sendSocketMessage('twitch-auth', { authorized: true, userName: userInfo.displayName});

  console.log('Twitch integration setup complete');
}


// =============================================================================


/* This will do the work necessary to connect the back end system to the Twitch
 * channel of the currently authorized user. We set up a couple of simple event
 * listeners here to allow us to monitor the system. */
async function setupTwitchChat() {
  // If we've already set up Twitch chat or haven't set up Twitch access, we
  // can't proceed.
  if (chatClient !== undefined || authProvider === undefined) {
    return;
  }

  // Set up the name of the channel we're going to be sending to, which is the
  // username of the authorized user.
  chatChannel = userInfo.name;

  // Create a chat client using the global authorization provider.
  chatClient = new ChatClient({
    authProvider,
    channels: [chatChannel],
    botLevel: "known",   // "none", "known" or "verified"

    // When this is true, the code assumes that the bot account is a mod and
    // uses a different rate limiter. If the bot is not ACTUALLY a mod and you
    // do this, you may end up getting it throttled, which is Not Good (tm).
    isAlwaysMod: true,
  });

  // Set up the listeners for chat events that we're interested in handling;
  // these are captured into a list so we can destroy them later.
  chatListeners = [
    // Display a notification when the chat connects,.
    chatClient.onConnect(() => {
      console.log('Twitch chat connection established');
    }),

    // Display a notification when the chat disconnects.
    chatClient.onDisconnect((_manually, _reason) => {
      console.log('Twitch chat has been disconnected');
    }),

    // Handle a situation in which authentication of the bot failed; this would
    // happen if the bot user redacts our ability to talk to chat from within
    // Twitch without disconnecting in the app, for example.
    chatClient.onAuthenticationFailure(message => {
      console.log(`Twitch chat Authentication failed: ${message}`);
    }),

    // As a part of the connection mechanism, we also need to tell the server
    // what name we're known by. Once that happens, this event triggers.
    chatClient.onRegister(() => {
      console.log(`Registered with Twitch chat as ${chatClient.currentNick}`);
    }),

    // Handle cases where sending messages fails due to being rate limited or
    // other reasons.
    chatClient.onMessageFailed((channel, reason) => console.log(`${channel}: message send failed: ${reason}`)),
    chatClient.onMessageRatelimit((channel, message) => console.log(`${channel}: rate limit hit; did not send: ${message}`)),
  ]

  // We're done, so indicate that we're connecting to twitch.
  console.log(`Connecting to Twitch chat and joining channel ${chatChannel}`);
  await chatClient.connect();
}


// =============================================================================


/* This will tear down (if it was set up) the Twitch chat functionality; once
 * this is called, it will no longer be possible to send messages to chat until
 * the chat connection is manually re-established. */
function leaveTwitchChat() {
  // If we're not in the chat right now, we can leave without doing anything/
  if (chatClient === undefined || chatListeners === undefined) {
    return;
  }

  // Actively leave the chat, and then remove all of of the listeners that are
  // associated with it so that we can remove the instance; otherwise they will
  // hold onto it's reference.
  chatClient.quit();
  for (const listener in chatListeners) {
    chatClient.removeListener(listener);
  }

  // Clobber away the values that tell us that we're connected to the chat.
  chatListeners = undefined;
  chatClient = undefined;
  chatChannel = undefined;
}


// =============================================================================


/* This removes all current Twitch integrations that have been set up (if any),
 * in preparation for the user logging out of Twitch or changing their
 * current authorization. */
async function shutdownTwitchAccess() {
  // If we have not already set up Twitch access, there's nothing to shut down
  if (authProvider === undefined) {
    return;
  }

  // If we previously set up listeners in this run, we need to remove them
  // before we shut down.
  if (pubSubClient !== undefined) {
    pubSubListeners.forEach(listener => pubSubClient.removeListener(listener));
    pubSubClient = undefined;
    pubSubListeners = []
  }

  // Clobber away our authorization provider and twitch API handle, as well as
  // the cached information on the current user.
  authProvider = undefined;
  twitchApi = undefined;
  userInfo = undefined;

  // Let all connected listeners know that we are no longer authorized.
  sendSocketMessage('twitch-auth', { authorized: false });

  console.log('Twitch integrations have been shut down');
}


// =============================================================================


/* Set up the websocket listener that the overlay and the control panel will use
 * to communicate with the server and get updates. We do this rather than a long
 * poll so that everything is more interactive and speedy. */
function setupWebSockets() {
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
      authorized: authProvider !== undefined,
      userName: userInfo !== undefined ? userInfo.displayName : undefined
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


function sendSocketMessage(event, ...args) {
  webClients.forEach(socket => socket.emit(event, ...args));
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
    const cipher = crypto.createCipheriv(algorithm, process.env.TWITCHLOYALTY_CRYPTO_SECRET, iv);
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
    const decipher = crypto.createDecipheriv(algorithm, process.env.TWITCHLOYALTY_CRYPTO_SECRET, iv);
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
  // If we're already authorized, then we don't want to try to authorize again.
  // So in that case, we can just leave.
  if (authProvider !== undefined) {
    console.log('The user is already authenticated; stopping the auth flow');
    return res.redirect('/');
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
    client_id: process.env.TWITCHLOYALTY_CLIENT_ID,
    redirect_uri,
    force_verify: true,
    response_type: 'code',
    scope: bot_token_scopes.join(' '),
    state
  };

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${new URLSearchParams(params)}`);
});


/* This route kicks off our de-authorization process, which will check to see if
 * we currently have an access token and, if we do, remove it before redirecting
 * back to the root page. */
app.get('/deauth', async (req, res) => {
  // If we are actually authorized, then remove authorization before we redirect
  // back. In the case where we're not authorized, skip calling these (even
  // though it is fine to do so).
  if (authProvider !== undefined) {
    // Shut down our access to Twitch; this will remove all cached information and
    // stop us from receiving messages or talking to the API.
    shutdownTwitchAccess();
    leaveTwitchChat();

    const model = await db.model('tokens', TokenSchema);
    await model.remove({ id: 1 });
  }

  res.redirect('/');
});

app.post('/test/bits', async (req, res) => {
  handleBits(req.body);
  res.json({success: true});
})

app.post('/test/subs', async (req, res) => {
  handleSubscription(req.body);
  res.json({success: true});
})

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

    // Set up our access to Twitch and to Chat; we're specifically not bothering
    // to wait for the Twitch chat to connect; that promise can resolve on its
    // own.
    await setupTwitchAccess(model, token);
    setupTwitchChat();
  }

  return res.redirect('/');
});

/* Set up some middleware that will serve static files out of the public folder
 * so that we don't have to inline the pages in code. */
app.use(express.static('public'));

/* Get the server to listen for incoming requests. */
app.listen(webPort, () => {
    console.log(`Listening for requests on http://localhost:${webPort}`);
});


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function setup() {
  // Start up the WebSocket listener
  setupWebSockets();

  // Fetch the model that we use to store our tokens.
  const model = await db.model('tokens', TokenSchema);

  // Try to fetch out the token. If we find one, then we can decrypt the token
  // and refresh token and pass them in to set up the environment.
  const token = await model.findOne({ id: 1 });
  if (token !== undefined) {
    token.accessToken = decrypt(token.accessToken);
    token.refreshToken = decrypt(token.refreshToken);
    await setupTwitchAccess(model, token);
    setupTwitchChat();
  }
}

setup();