// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket, trackConnectionState } = require('../../common/js/websocket');
const { remainingDuration, giveawayRunning } = require('../../common/js/utils');

// For parsing the desired length of giveaways
const parse = require('parse-duration').default;
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

let toggleID = undefined;


// =============================================================================


/* The panel controls related to authorization and the currently authorized
 * user. */
const authLink = document.getElementById('auth-link');
const authBtn = document.getElementById('authorize-btn');

/* The panel controls that relate to starting, pausing, cancelling and showing
 * the current status of active giveaways. */
const durationFld = document.getElementById('giveaway-duration');
const startBtn = document.getElementById('giveaway-start-btn');
const cancelBtn = document.getElementById('giveaway-cancel-btn');
const warningTxt = document.getElementById('warning');
const confirmBtn = document.getElementById('giveaway-confirm-btn');

/* The user that is currently authorized (if any); the data that's sent up to
 * us about giveaways and the data that is associated with them associates with
 * this user. */
let user = { authorized: false, userName: undefined } ;

/* The status of the currently active giveaway. When this is an empty object,
 * we don't know anything about any giveaways. This will be true when the page
 * loads, and if a currently authenticated revokes their authorization for the
 * app.
 *
 * In all other cases, this is an object that tells us the properties of the
 * giveaway we're currently visualizing. */
let giveaway = {};


// =============================================================================


/* Toggle the hidden state of the portions of the control panel that allow the
 * user to confirm that they want to cancel a video.
 *
 * This can be called manually, as well as on a timer so that if you decide you
 * don't want to cancel, the confirmation can be hidden again. */
const toggleConfirmState = () => {
  [warningTxt, cancelBtn, confirmBtn].forEach(el => el.classList.toggle('hidden'));
  toggleID = undefined;
}


// =============================================================================


/* This gets invoked whenever the button for starting/pausing/resuming a
 * giveaway is pressed.
 *
 * If there's a giveaway that's currently running, this will either pause or
 * unpause depending on the curent state of the giveaway.
 *
 * When there's no giveaway actively running, this wil instead start one going
 * by using the content in the duration field.
 *
 * The button is expected to be disabled if the duration field is not valid,
 * so that in the case that a giveaway should be started, all preconditions
 * have been met if the function gets called. */
const startOrPauseGiveaway = () => {
  // If there's a giveaway that's currently running, then send a message to the
  // back end to get it to either pause or unpause as appropriate.
  if (giveawayRunning(giveaway) === true) {
    const pause_map = { true: 'unpause', false: 'pause' };
    return window.fetch(`/giveaway/${pause_map[giveaway.paused]}`);
  }


  // Gather the duration out of the duration field and use it to request that a
  // new giveaway be started. We can't be called unless the duration field is a
  // valid duration.
  window.fetch('/giveaway/start?' + new URLSearchParams({
    duration: parse(durationFld.value),
    userId: user.userId
  }));
}


// =============================================================================


/* Alter the portion of the panel that tracks wether or not there is any user
 * that is authorized for the panel. This gets invoked every time the user data
 * changes. */
function updateUserAuthControls(newUserData) {
  // Store this information as the new authorized user.
  user = newUserData;

  // Update the authorization button to take a different action when clicked,
  // which will depend on wether or not there's currently someone authorized.
  authBtn.innerText = user.authorized ? `Deauthorize ${user.userName}` : 'Authorize with Twitch';
  authLink.href = user.authorized ? '/deauth' : '/auth';
}


// =============================================================================


/* This will set the giveaway information provided as the currently known
 * giveaway information, and will then alter the controls in the panel that
 * allow the user to start, pause, resume and cancel a giveaway, so that they
 * can control their entire giveaway process.
 *
 * This gets invoked every time the underlying data on the giveaway changes;
 * this can happen in the following ways:
 *   - We connect to the back end, and it sends us the current into
 *   - The user deauthorizes the application for their channel
 *   - The user authorizes themselves with Twitch
 *   - A brand new giveaway starts
 *
 * The giveaway variable contains the fields that tell us about the giveaway
 * we're tracking; a giveaway can either be running or not. Here "running" means
 * that the giveaway is not cancelled and has some time remaining on it (pause
 * state does not matter).
 *
 * The giveaway variable is an empty object if we don't know about any giveaway,
 * such as when the database is completely empty or the user is not authorized.
 * In all other cases it has some giveaway data in it, even if it's not a
 * current one. */
function setGiveawayInformation(newGiveawayData) {
  // Keep this information as the current giveaway; this update always comes
  // from a 'giveaway-info' event, which is always considered to be gospel.
  giveaway = newGiveawayData;

  // If the object that we got is empty, then there's no information on any
  // particular giveaway, either past or present. In that case the controls
  // should be set such that we can start a new giveaway.
  //
  // The same situation also applies if there IS giveaway information, but it's
  // for a giveaway that can't possibly run. In that case we also want to set up
  // to start a new giveaway.
  //
  // If there's no authorized user, this also needs to trigger except that the
  // controls in the panel are disabled to stop you from starting a giveaway.
  if (Object.keys(giveaway).length === 0 || giveawayRunning(giveaway) === false || user.authorized === false) {
    // Allow the user to enter a duration for the giveaway into the field, which
    // should be empty of any previous text it might have. The field can only be
    // enabled if there's a logged in user, since we need user credentials to
    // start a new giveaway.
    durationFld.value = '';
    durationFld.disabled = ! (user.authorized === true);

    // The button should allow us to start a giveaway, but it also requires
    // that the user type a valid duration into the input field first, so the
    // button needs to be initially disabled.
    startBtn.innerText = 'Start Giveaway';
    startBtn.disabled = true;

    // Since there's no giveaway running, the button for cancelling it should
    // be disabled.
    cancelBtn.disabled = true;
    return;
  }

  // We have been given information for a giveaway that could actually be
  // running; In that case we need to update the controls.
  //
  // Start by creating a human readable version of the duration and set it into
  // the field; the duration field also needs to be disabled, since you can't
  // type into it while a giveaway is running.
  const remain = humanize(remainingDuration(giveaway));
  durationFld.value = giveaway.paused ? `Giveaway is paused (${remain} remain)` : `${remain} remaining`;
  durationFld.disabled = true;

  // The text of the start button needs to change to indicate that it's either
  // going to pause or resume the giveaway; it should also be enabled so that
  // it can be clicked.
  startBtn.innerText = giveaway.paused ? 'Resume Giveaway Clock' : 'Pause Giveaway Countdown'
  startBtn.disabled = false;

  // Regardless of wether the currently active giveaway is running or is
  // just paused, the user should be able to cancel it if they want to.
  cancelBtn.disabled = false;
}


// =============================================================================


/* This will handle an update tick from the back end code, which allows us to
 * update our current notion of what the giveaway state is and how the panel
 * represents itself.
 *
 * A tick happens in the following situations:
 *   - Some time has elapsed on a running giveaway
 *   - The pause state has changed
 *   - The cancel state has changed
 *   - The giveaway has ended (when the tick happens, no more time is remaining)
 *
 * This call will update the stored giveaway information and update the panel
 * accordingly. */
function handleGiveawayTick(newGiveawayData) {
  // Every tick is a complete new data object; use it to update our stored
  // state information.
  giveaway = newGiveawayData;

  // Update the duration field with the new elapsed duration.
  const remain = humanize(remainingDuration(giveaway));
  durationFld.value = giveaway.paused ? `Giveaway is paused (${remain} remain)` : `${remain} remaining`;

  // If the pause state has changed, we need to update the text on the button
  // that tells us what it does.
  startBtn.innerText = giveaway.paused ? 'Resume Giveaway Clock' : 'Pause Giveaway Countdown'

  // If the giveaway has been cancelled or has finished running, then trigger an
  // update that clears away the known data.
  if (giveaway.cancelled === true || remainingDuration(giveaway) <= 0) {
    // Allow the user to enter a duration for the giveaway into the field, which
    // should be empty of any previous text it might have. The field can only be
    // enabled if there's a logged in user, since we need user credentials to
    // start a new giveaway.
    durationFld.value = '';
    durationFld.disabled = ! (user.authorized === true);

    // The button should allow us to start a giveaway, but it also requires
    // that the user type a valid duration into the input field first, so the
    // button needs to be initially disabled.
    startBtn.innerText = 'Start Giveaway';
    startBtn.disabled = true;

    // Since there's no giveaway running, the button for cancelling it should
    // be disabled.
    cancelBtn.disabled = true;
  }
}


// =============================================================================


/* Set up all of our handlers and kick the panel off; this will among other
 * things make sure that we're connected to the back end and that we're
 * listening for the appropriate events. */
async function setup() {
  // Get our configuration, and then use it to connect to the back end so
  // that we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort, 'controls',
                              trackConnectionState('connection-state'));

  // The start button either starts a new giveaway or pauses the existing
  // one, depending on the current state.
  startBtn.addEventListener('click', () => startOrPauseGiveaway());

  // Every time the text in the duration field changes, check to see if the
  // value will parse and enable or disable the start button as appropriate
  durationFld.addEventListener('input', () => {
    const duration = parse(durationFld.value);
    startBtn.disabled = (duration === null || duration < 1000);
  });

  // When new input is commited into the duration field, trigger a fake event
  // on the start button. This won't fire while entering text, only when enter
  // is pressed.
  durationFld.addEventListener('keydown', event => {
    if (event.code === 'Enter' && startBtn.disabled === false) {
      startBtn.dispatchEvent(new Event('click', {}))
    }
  });

  // Whenever the cancel button is clicked, display the portion of the panel
  // that asks you to confirm that you want to actually cancel. A timeout is
  // set after which the controls go back to their original state.
  cancelBtn.addEventListener('click', () => {
    toggleConfirmState();
    toggleID = window.setTimeout(() => toggleConfirmState(), 5000);
  });

  // Whenever the confirmation button is clicked, transmit a message to the
  // back end to tell it to cancel the current giveaway. This button is only
  // visible after the user clicks the cancel button, which makes this button
  // appear.
  confirmBtn.addEventListener('click', () => {
    // Since this button is only visible while we're confirming, clear the
    // timer that was set up to rever the page, then manually revert it.
    window.clearTimeout(toggleID);
    toggleConfirmState();

    // If there is actually a giveaway running, cancel it.
    if (giveawayRunning(giveaway) === true) {
      window.fetch('/giveaway/cancel');
    }
  });

  // Whenever we get informed about a twitch authorization change, update the
  // controls in the panel as appropriate. This can do things like change the
  // content displayed (e.g. to display a username) as well as to enable or
  // disable controls based on the authorization state.
  socket.on("twitch-auth", data => {
    // console.log('twitch-auth', data);

    // Update the authorization controls using this new data; this also requires
    // us to update the panel as well, since the auth state changes the state of
    // other things.
    updateUserAuthControls(data);
  });

  // This event fires to give us information on the current giveaway; this
  // triggers whenever Twitch authorizes or deauthorizes, right after we connect
  // our socket to the back end, and when giveaways start.
  //
  // The data that we get is either an empty object if there is no giveaway
  // information for the current user, or it's information on a giveaway. That
  // giveaway may be complete, but we get information on it anyway.
  socket.on("giveaway-info", data => {
    // console.log('giveaway-info', data);

    // Use this information to set the information for the giveaway we're
    // tracking and update the controls as appropriate.
    setGiveawayInformation(data);
  });

  // This event fires whenever the state of a giveaway changes; where 'giveaway-
  // info' tells us that the overall information, this tells us when it changes
  // from paused to unpaused and vice versa, the duration changes, or it
  // cancels.
  //
  // The input is a complete object of the same shape as the giveaway
  // information, only here we know that there are certain status fields that
  // are our focus.
  socket.on("giveaway-tick", data => {
    // console.log('giveaway-tick', data);

    // Use this information to see how the state is changing and update as
    // appropriate.
    handleGiveawayTick(data);
  });

  // Handle an incoming notification of bits and subs being broadcast from the
  // back end. This is currently uninteresting to us, but might be interesting
  // later.
  // socket.on("leaderboard-bits-update", data => console.log('leaderboard-bits-update', data));
  // socket.on("leaderboard-subs-update", data => console.log('leaderboard-subs-update', data));
}


// =============================================================================


setup();
