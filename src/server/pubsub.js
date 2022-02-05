// =============================================================================


const { SingleUserPubSubClient } = require('@twurple/pubsub');
const { sendSocketMessage } = require('./socket');
const { handleRedemption, handleSubscription, handleBits } = require('./handler');


// =============================================================================


/* A Twurple PubSub client that gives us information about subscribed events.
 * As we subscribe to events, we add the listeners to the listener array so
 * that if we need to, we can redact them. */
let pubSubClient = undefined;
let pubSubListeners = [];


// =============================================================================


/* This sets up our connectivity to Twitch via PubSub; it requires that an
 * actively authorized user is available to the overlay, and uses the
 * authorization gained from that user to subscribe to the events that we're
 * interested in handling. */
async function setupTwitchPubSub(twitch) {
  if (pubSubClient !== undefined) {
    return;
  }

  // Set up our PubSub client and listen for the events that will allow us to
  // track the leader board. Since we may need to remove these, we need to
  // store the listeners as we add them.
  pubSubClient = new SingleUserPubSubClient({ authProvider: twitch.authProvider });
  pubSubListeners = await Promise.all([
    pubSubClient.onRedemption(msg => handleRedemption(msg)),
    pubSubClient.onSubscription(msg => handleSubscription(msg)),
    pubSubClient.onBits(msg => handleBits(msg)),
  ]);
}


// =============================================================================


/* Shut down an active Twitch PubSub connection (if there is one), removing
 * any existing listeners and shutting them down. */
function shutdownTwitchPubSub() {
  // If we previously set up listeners in this run, we need to remove them
  // before we shut down.
  if (pubSubClient !== undefined) {
    pubSubListeners.forEach(listener => pubSubClient.removeListener(listener));
    pubSubClient = undefined;
    pubSubListeners = []
  }
}


// =============================================================================


module.exports = {
  setupTwitchPubSub,
  shutdownTwitchPubSub,
}