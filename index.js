// =============================================================================


const { RefreshingAuthProvider, getTokenInfo, exchangeCode } = require('@twurple/auth');
const { SingleUserPubSubClient } = require('@twurple/pubsub');
const { ApiClient } = require('@twurple/api');

const express = require('express');
const { v4: uuidv4 } = require('uuid');


// =============================================================================


/* The scopes to request access for when we authenticate with twitch. */
const bot_token_scopes = ['bits:read',
                          'channel:read:redemptions',
                          'channel_subscriptions'];


// =============================================================================


/* The express application that houses the routes that we use to carry out
 * authentication with Twitch as well as serve user requests. */
const app = express();

/* The port on which the application listens and the URI that Twitch should
 * redirect back to whenever we communicate with it. */
const port = 3030;
const redirect_uri = `http://localhost:${port}/auth/twitch`

/* When a Twitch authorization is in progress, this represents the state code
 * that was passed to Twitch when we redirected there. Twitch will send this
 * back when it redirects back to us after the authentication either succeeds
 * or is cancelled.
 *
 * This allows us to verify that incoming requests are genuine and represent
 * actual responses from Twitch instead of just spoofs. */
let state = undefined;

/* When the user is authorized, this is used to wrap the token provided so that
 * we can keep it up to date, since tokens have a finite life. */
let authProvider = undefined;

/* When the user has authorized their Twitch account, this is set to the API
 * instance that allows us to make requests on their behalf. */
let twitchApi = undefined;

/* When the user has authorized their Twitch account, this is set up to be a
 * PubSub client to allow events for the logged in user to flow. */
let pubSubClient = undefined;

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

    // Create a Twurple authorization provider; this will take the token info as
    // it was given and make sure that the tokens are always kept up to date; so
    // if the application is long lived the token will be refreshed as needed.
    authProvider = new RefreshingAuthProvider(
      {
        clientId: process.env.TWITCHLOYALTY_CLIENT_ID,
        clientSecret: process.env.TWITCHLOYALTY_CLIENT_SECRET,
        onRefresh: async newData => {
          console.log(`Refreshing user token`);
        }
      },
      token
    );

    twitchApi = new ApiClient({ authProvider });
  }

  return res.redirect('/');
});


/* The root of the site:
 *
 * If this page is loaded and there's not a query parameter that indicates that
 * an authorization just happened, then include a link that will allow the
 * user to authorize themselves with Twitch.
 *
 * The authorization link goes to our route from above, which will set up
 * everything we need and then redirect the page to Twitch to allow it to carry
 * out the authorization on our behalf.
 *
 * If the query parameter is there, the link is not displayed; this does not
 * actually mean that the user is authorized, however. */
app.get('/', async (req, res) => {
  if (twitchApi === undefined) {
    res.send('<a href="/auth">Authorize with twitch</a>');
  } else {

    const userInfo = await twitchApi.users.getMe();
    res.send(`Welcome, ${userInfo.displayName}`);

    pubSubClient = new SingleUserPubSubClient({ authProvider });
    pubSubClient.onRedemption(msg => {
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
    });
    pubSubClient.onSubscription(msg => {
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
    });
    pubSubClient.onBits(msg => {
      console.log(`bits: ${bits}`);
      console.log(`isAnonymous: ${isAnonymous}`);
      console.log(`message: ${message}`);
      console.log(`totalBits: ${totalBits}`);
      console.log(`userId: ${userId}`);
      console.log(`userName: ${userName}`);
    });
  }
});

/* Get the server to listen for incoming requests. */
app.listen(port, () => {
    console.log(`Listening for requests on http://localhost:${port}`);
});
