// =============================================================================


const { SingleUserPubSubClient } = require('@twurple/pubsub');
const { sendSocketMessage } = require('./socket');


// =============================================================================


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
    message: msg.message,
    rewardId: msg.rewardId,
    userDisplayName: msg.userDisplayName,
    userId: msg.userId,
  });

  // If the incoming redemption is special, do something special with it.
  //
  // This particularl hard coded redeem ID is the one for the /dev/null redeem.
  if (msg.rewardId === '648252cf-1b6d-409a-a901-1764f5abdd28') {
    // chatSay('$heckle')
  }

  console.log("-----------------------------");
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
  console.log("-----------------------------");
};


// =============================================================================


/* Handle an incoming subscription PubSub message. This triggers for all
 * subscriptions, though we're primarily interested in gift subscriptions for
 * our purposes here. */
function handleSubscription(msg) {
  sendSocketMessage('twitch-sub', {
    gifterDisplayName: msg.gifterDisplayName,
    gifterId: msg.gifterId,
    isAnonymous: msg.isAnonymous,
    userDisplayName: msg.userDisplayName,
    userId: msg.userId,
  });

  console.log("-----------------------------");
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
  console.log("-----------------------------");
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

  console.log("-----------------------------");
  console.log(`bits: ${msg.bits}`);                // bits: 100
  console.log(`isAnonymous: ${msg.isAnonymous}`);  // isAnonymous: false
  console.log(`message: ${msg.message}`);          // message: SeemsGood100
  console.log(`totalBits: ${msg.totalBits}`);      // totalBits: 1454
  console.log(`userId: ${msg.userId}`);            // userId: 136337257
  console.log(`userName: ${msg.userName}`);        // userName: valleydweller
  console.log("-----------------------------");
};


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
  handleRedemption,
  handleSubscription,
  handleBits,
}