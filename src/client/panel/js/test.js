// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket, trackConnectionState } = require('../../common/js/websocket');

const testData = require('./test_users');


// =============================================================================


/* The list of controls that are in the bits portion of the test panel. */
const bUser = document.getElementById('bits-user');
const bBits = document.getElementById('bits-amount');
const bTrigger = document.getElementById('bits-btn');

/* The list of controls that are in the subs portion of the test panel. */
const sGifter = document.getElementById('sub-gifter');
const sSubCount = document.getElementById('sub-amount');
const sStrigger = document.getElementById('sub-test');
const sGift = document.getElementById('sub-is-gift');


// =============================================================================


/* Given a select element in the page, add appropriate option tags to allow
 * for selecting a user from the list; the list will use the display name as
 * the text and the userID as the value. */
function addTestUserOptions(selectTag) {
  // Add an option group for each file, and inside of the group all of the
  // items contained within that file.
  Object.keys(testData).forEach(userId => {
    const tag = document.createElement('option');
    tag.value = userId;
    tag.innerText = userId === "Anonymous" ? userId : testData[userId].displayName;

    selectTag.append(tag);
  })
}


// =============================================================================


/* Set up the controls and events for the test panel. */
async function setup() {
  // Get our configuration, and then use it to connect to the back end so
  // that we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort,
                             trackConnectionState('connection-state'));

  // Set up the select tag with the list of test users.
  addTestUserOptions(bUser);

  bTrigger.addEventListener('click', async () => {
    const isAnonymous = (bUser.value === 'Anonymous');
    const userInfo = isAnonymous ? testData["Anonymous"] : testData[bUser.value];

    await window.fetch('/test/bits', {
      method: 'post',
      body: JSON.stringify({
        bits: Math.trunc(bBits.value),
        isAnonymous,
        message: 'This is a test bits message',
        totalBits: 1454,
        userId: userInfo.userId,
        userName: userInfo.userName,
      }),
      headers: {'Content-Type': 'application/json'}
    });
  });


  // Set up the select tag with the list of test users.
  addTestUserOptions(sGifter);

  // Get the sub count; if this isn't a gifted sub, it's always just a single
  // sub no matter what the form says because you can't subscribe yourself
  // several times in a row.
  sStrigger.addEventListener('click', async () => {
    const isAnonymous = (sGifter.value === 'Anonymous');
    const isGift = sGift.checked;

    // Who's the gifter here? If this is not a gift, then the "anonymous" user
    // is the gifter (i.e. nobody); otherwise it's the user that was selected in
    // the box, which could in fact be the anonymous user if this is an
    // anonymous gift.
    const gifter = isGift ? (isAnonymous ? testData['Anonymous'] : testData[sGifter.value])
                          : testData['Anonymous'];

    // Who's getting the sub? If this is a gift, then we randomly pick the user
    // being gifted. If it's not a gift, then it's the user selected in the box.
    // In the case that that user is anonymous, we need to randomly pick a name
    // here because subs can't be anonymous, only the gifter can.
    const giftee = isGift ? testData['56740791']
                          : (isAnonymous ? testData["66586458"] : testData[sGifter.value]);

    // What's the gift sub count? This is the value given in the text box, but
    // will force itself to be a single if this isn't a gift sub.
    const count = isGift ? Math.trunc(sSubCount.value) : 1;

    await Promise.all(Array(count)
      .fill(null).map(
          () => window.fetch('/test/subs', {
            method: 'post',
            body: JSON.stringify({
              cumulativeMonths: 1,
              giftDuration: isGift ? 1 : null,
              gifterDisplayName: gifter.displayName,
              gifterId: gifter.userId,
              gifterName: gifter.userName,
              isAnonymous: isAnonymous,
              isGift: isGift,
              isResub: false,
              message: null,
              months: 1,
              streakMonths: 0,
              subPlan: 1000,
              time: new Date(),
              userDisplayName: giftee.displayName,
              userId: giftee.userId,
              userName: giftee.userName
            }),
            headers: {'Content-Type': 'application/json'}
          })
      )
    );
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