// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket, trackConnectionState } = require('../../common/js/websocket');

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
let currentUser = { authorized: false, userName: undefined } ;

/* The status of the currently active giveaway (if any); this tracks things like
 * the duration and the elapsed time. */
let currentGiveaway = undefined;


// =============================================================================


/* Using an object shaped like a giveaway information object, update the
 * duration field with the amount of time that's currently remaining in the
 * giveaway. */
const updateRunningDuration = (data) => {
  currentGiveaway.duration = data.duration;
  currentGiveaway.elapsedTime = data.elapsedTime;

  const remain = humanize(currentGiveaway.duration - currentGiveaway.elapsedTime);
  durationFld.value = currentGiveaway.paused ? `Giveaway is paused (${remain} remain)` : `${remain} remaining`;
}


// =============================================================================


/* When called, this will toggle the hidden state of the portions of the panel
 * that control being able to cancel a giveaway. */
const confirmToggle = () => {
  [warningTxt, cancelBtn, confirmBtn].forEach(el => el.classList.toggle('hidden'));
  toggleID = undefined;
}


// =============================================================================


/* If there's not currently a giveaway running, then capture the current
 * duration and start one; otherwise, pause the current giveaway.
 *
 * In both cases a message is sent to the back end to tell it what is
 * happening. */
const startGiveaway = () => {
  const pause_map = { true: 'unpause', false: 'pause' };

  if (currentGiveaway === undefined) {
    window.fetch('/giveaway/start?' + new URLSearchParams({
      duration: parse(durationFld.value),
      userId: currentUser.userId
    }));
  } else {
    window.fetch(`/giveaway/${pause_map[currentGiveaway.paused]}`);
  }
}


// =============================================================================


/* Alter the panel controls that allow the user to start, pause and stop a
 * giveaway so that they can control things as appropriate.
 *
 * The controls are set up based on the current user (if any) and the current
 * giveaway information (if any). */
function updatePanelControls() {
  // Update the authorization button to take a different action when clicked,
  // which will depend on wether or not there's currently someone authorized.
  authBtn.innerText = currentUser.authorized ? `Deauthorize ${currentUser.userName}` : 'Authorize with Twitch';
  authLink.href = currentUser.authorized ? '/deauth' : '/auth';

  // If there is no current giveaway or there is not currently an authorized
  // user, then all of the controls should be reset to the state that allows
  // the user to start a new giveaway.
  //
  // In the case of there not being a giveaway, we want to start one, and in
  // the case of there being no user, we don't want to display any potentially
  // existing giveaway information.
  if (currentGiveaway === undefined || currentUser.authorized === false) {
    // Allow the user to enter a duration for the giveaway into the field,
    // which should be empty of any previous text.
    durationFld.value = '';
    durationFld.disabled = ! (currentUser.authorized === true);

    // The button should allow us to start a giveaway, but it also requires
    // that the user type a valid duration into the input field first, so the
    // button needs to be initially disabled.
    startBtn.innerText = 'Start Giveaway';
    startBtn.disabled = true;

    // Since there's no giveaway running, the button for cancelling it should
    // be disabled.
    cancelBtn.disabled = true;
  } else {
    // When there's a giveaway running (even if it's paused), the duration
    // field is used as an informational field to tell us the current state of
    // things, so set its value as appropriate and disable it so that the user
    // can't type into it.
    updateRunningDuration(currentGiveaway);
    durationFld.disabled = true;

    // When a giveaway is running, the start button is allowed to pause it.
    startBtn.innerText = currentGiveaway.paused ? 'Resume Giveaway Clock' : 'Pause Giveaway Countdown'
    startBtn.disabled = false;

    // Regardless of wether the currently active giveaway is running or is
    // just paused, the user should be able to cancel it if they want to.
    cancelBtn.disabled = false;
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
  startBtn.addEventListener('click', () => startGiveaway());

  // Every time the text in the input changes; use that to see if the value will
  // parse and enable or disable the start button as appropriate
  durationFld.addEventListener('input', () => {
    const duration = parse(durationFld.value);
    startBtn.disabled = (duration === null || duration < 1000);
  });

  // This one only fires when a new input is commited into the input field's
  // value; so it won't trigger twice in a row for the same input for example.
  durationFld.addEventListener('keydown', event => {
    if (event.code === 'Enter' && startBtn.disabled === false) {
      startBtn.dispatchEvent(new Event('click', {}))
    }
  });

  cancelBtn.addEventListener('click', () => {
    // Flip the state of our confirm buttons; put it back after a few seconds
    confirmToggle();
    toggleID = window.setTimeout(() => confirmToggle(), 5000);
  });

  // The confirm button will confirm; that's why it's called that.
  confirmBtn.addEventListener('click', () => {
    // Flip the button state back; we also need to cancel the confirmation
    // timer.
    window.clearTimeout(toggleID);
    confirmToggle();

    if (currentGiveaway !== undefined) {
      window.fetch('/giveaway/cancel');
    }
  });

  // Update the Twitch authorization controls in the panel based on the
  // currently available Twitch authorization state, as transmitted from the
  // back end.
  socket.on("twitch-auth", data => {
    console.log(data);
    currentUser = data;
    updatePanelControls();
  });

  // Receive updates on the current state of the giveaway that's currently in
  // progress, if any. This gets disopatched when the socket first connects
  // too.
  socket.on("giveaway-info", data => {
    console.log(data);
    // Set up the current giveaway, which is either a fully populated object
    // or, if the other end is telling us that there's no giveaway information
    // assume that the value is just undefined.
    currentGiveaway = Object.keys(data).length === 0 ? undefined : data;
    updatePanelControls();
  });

  // Handle updates about ongoing giveaway timer ticks by updating the text
  // that appears in the duration field.
  socket.on("giveaway-tick", data => updateRunningDuration(data));

  // Handle an incoming notification of bits and subs being broadcast from the
  // back end.
  socket.on("twitch-bits", data => console.log(data));
  socket.on("twitch-sub", data => console.log(data));
}


// =============================================================================


setup();
