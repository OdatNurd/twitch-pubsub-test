// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');
const { remainingDuration, giveawayRunning } = require('../../common/js/utils');

const humanize = require("humanize-duration").humanizer({
  language: "shortEn",
  languages: {
    shortEn: {
      y: () => "y",
      mo: () => "mo",
      w: () => "w",
      d: () => "d",
      h: () => "h",
      m: () => "m",
      s: () => "s",
      ms: () => "ms",
    },
  },
  round: true
});


// =============================================================================

/* The DOM parser we use to turn our snippets of HTML into actual DOM nodes. */
const domParser = new DOMParser();

/* The header that contains the current countdown duration text. */
const countdownTxt = document.getElementById('countdown-clock');

/* The overall divs that contain the leaderboards for subs and bits; these
 * elements are what will contain the overall divs that represent the contents
 * of the leaderboards in the panel. */
const subListBox = document.getElementById('sub-list');
const bitListBox = document.getElementById('bit-list');


// =============================================================================


/* Create and return a new uniquely addressable div containing the information
 * on the gifter provided. */
function divForGifter(gifter) {
  return domParser.parseFromString(
    `<div class="gift-box">
      <span class="name">${gifter.name}</span>
      (<span class="score">${gifter.score}</span>)
    </div>`, 'text/html').querySelector('div');
}


// =============================================================================


/* This handles an authorization event update from the back end, which tells us
 * when a user either authorizes the panel or removes existing authorization.
 *
 * For our purposes here, all we need to do is watch to see if a user is
 * removing their authorization, and if so update the panel to remove the
 * currently displayed giveaway data. */
function handleAuthUpdate(authData) {
  // If the user is authorized, then we're going to get an update that will
  // populate the panel, so we don't need to do anything explicitly here.
  if (authData.authorized === true) {
    return;
  }

  // Clear away the participants and reset the header so that the panel is
  // reset, since the user is no longer authorized.
  bitListBox.innerHTML = '';
  subListBox.innerHTML = '';
  countdownTxt.innerText = 'No giveaway yet; hold tight!';
  countdownTxt.classList.remove('pause');
}


// =============================================================================


/* This handles an update to the known giveaway information by updating the
 * contents of the panel to reflect what's given in the update.
 *
 * For our purposes here all this has to do is either show a remaining duration
 * and otherwise handle whether the giveaway is paused or not. */
function setGiveawayInformation(giveaway) {
  // Since many states in here need to make sure that the pause state is turned
  // off, turn it off by default and then we only need to turn it on if the
  // giveaway is actually paused.
  countdownTxt.classList.remove('pause');

  // If the object that we got is empty, then there's no information on any
  // particular giveaway, either past or present. In that case the remaining
  // duration should say that there's not any giveaway yet.
  if (Object.keys(giveaway).length === 0) {
    countdownTxt.innerText = 'No giveaway yet; hold tight!';
    return;
  }

  // The giveaway object we got must have some information; if it's not a
  // currently running giveaway, then set in a placeholder for that.
  //
  // This covers the state changes for being cancelled by the streamer as well
  // as a duration change that caused the giveaway to expend it's entire elapsed
  // time.
  if (giveawayRunning(giveaway) === false) {
    countdownTxt.innerText = 'The giveaway has ended!';
    return;
  }

  // If we get here, the state change is telling us either that the duration
  // changed or that the pause state changed. In either case, update the display
  // as appropriate.
  countdownTxt.innerText = `${humanize(giveaway.duration - giveaway.elapsedTime)} remaining`;

  if (giveaway.paused) {
    countdownTxt.classList.add('pause');
  }
}


// =============================================================================


/* This handles a tick of giveaway information, which only triggers when the
 * state of a giveaway we've previously been told about changes. We respond to
 * this by making sure that the duration remaining is properly updated. */
function handleGiveawayTick(giveaway) {
  // Since many states in here need to make sure that the pause state is turned
  // off, turn it off by default and then we only need to turn it on if the
  // giveaway is actually paused.
  countdownTxt.classList.remove('pause');

  // If the giveaway is no longer running (because it was cancelled or it
  // expired), then we can set the countdown text and we're done.
  if (giveawayRunning(giveaway) === false) {
    countdownTxt.innerText = 'The giveaway has ended!';
    return;
  }

  countdownTxt.innerText = `${humanize(giveaway.duration - giveaway.elapsedTime)} remaining`;
  if (giveaway.paused) {
    countdownTxt.classList.add('pause');
  }
}


// =============================================================================


/* This handles an update from the back end telling us that the participants in
 * one of the leaderboards has changed. This can trigger for both bits and subs
 * and both are handled the same way other than being visualized in different
 * containers in the page.
 *
 * We don't store this information, so this just causes a direct update to the
 * content of the panel with the given update data. */
function handleParticipantUpdate(config, eventName, updateData) {
  // Based on whether this is a bits or subs update, handle it by throwing away
  // the contents of the div and then re-populating it with the new results.
  switch(eventName) {
    case 'bits':
      bitListBox.innerHTML = '';

      updateData.forEach(gifter => {
        const div = divForGifter({ name: gifter.name, score: gifter.score });
        bitListBox.appendChild(div);
      });
      break;

    case 'subs':
      subListBox.innerHTML = '';

      updateData.forEach(gifter => {
        const div = divForGifter({ name: gifter.name, score: gifter.score });
        subListBox.appendChild(div);
      });
      break;
  }
}


// =============================================================================


/* Set up everything in the panel. This initializes the state of everything,
 * ensures that we're connected to the back end socket server, and sets up the
 * appropriate handlers for knowing when key events occur. */
async function setup() {
  // Get our configuration, and then use it to connect to the back end so that
  // we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort, 'results');

  // This event triggers whenever the authorization state changes in the overlay
  // to either say someone is authorized, or remove their authorization and go
  // back to a default state.
  //
  // We need to handle this specifically because if the user removes their
  // authorization, the panel needs to remove any displayed data; the back end
  // won't provide an update to us in that case since the auth message tells us.
  socket.on("twitch-auth", data => {
    console.log('twitch-auth', data);

    handleAuthUpdate(data)
  });

  // This event triggers to give us information about a giveaway, which can be
  // either a past one or an ongoing one, or it can tell us that there is no
  // giveaway information to display as well, such as if there has never been
  // a giveaway or there's not an authorized user.
  socket.on("giveaway-info", data => {
    console.log('giveaway-info', data);

    // Use this information to set the information for the giveaway we're
    // tracking and update the display as appropriate.
    setGiveawayInformation(data);
  });

  // This event triggers whenever any state changes in a giveaway that we have
  // been told about in a giveawy-info event, such as time expiring, the
  // giveaway ending, pause, resume or cancel, etc.
  socket.on("giveaway-tick", data => {
    // console.log('giveaway-tick', data);

    handleGiveawayTick(data);
  });

  // The events that track updates to the bits and subs leaderboard data always
  // send us an array, even if it might be empty. The array will be empty if
  // there has never been a giveaway, the user is not authorized to start one,
  // or a new fresh giveaway just started.
  //
  // For our purposes here, we handle these events by just throwing away
  // everything we've seen in that leaderboard and populating it fresh.
  socket.on('leaderboard-bits-update', data => handleParticipantUpdate(config, 'bits', data));
  socket.on('leaderboard-subs-update', data => handleParticipantUpdate(config, 'subs', data));
}


// =============================================================================


setup();
