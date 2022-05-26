// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');
const { remainingDuration, giveawayRunning } = require('../../common/js/utils');

const { resizeGifterHeader, updateLeaderboard, placeHolderHTML } = require('./leaderboard');
import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { Flip } from 'gsap/Flip';

const WebFont = require('webfontloader');
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


/* The div that contains the current countdown text. */
const countdownTxt = document.getElementById('countdown-clock');

/* The overall divs that contain the leaderboards for subs and bits; these
 * elements contain the header as well as the container divs that ultimately
 * contain the gifter boxes. */
const gifterSubBox = document.getElementById('gifters-subs');
const gifterBitsBox = document.getElementById('gifters-bits');

/* The native width of the headers for each of the boxes as defined in the HTML;
 * as the contents of the boxes change, the header needs to also change it's
 * width. We want to make sure we never make it smaller than the native size of
 * the text, or it will wrap in an unfortunate way. */
let subGifterHeaderMinWidth = undefined;
let bitGifterHeaderMinWidth = undefined;

/* The divs that contain the actual list of subs and bits leaders in each of the
 * boards. This is an aliased element lookup from the main gifter boxes. */
const subListBox = document.getElementById('sub-list');
const bitListBox = document.getElementById('bit-list');

/* When we need to animate items in and out of one of the leaderboards, we need
 * to know a specific position to which the element should go in order to get
 * the positioning we need.
 *
 * These items, gathered at startup, are DomRect instances that represent the
 * dimensions of the placeholder item that is added to each list at startup. */
let subListDim = undefined;
let bitListDim = undefined;

/* This contains all of the details on the most recently created giveaway; this
 * might be a giveaway that's currently in operation OR it might be a giveaway
 * that ended last week. The fields inside let you know the full status.
 *
 * This will be an empty object if no giveaway has ever been started (i.e. the
 * database is empty) or if there isn't an authorized Twitch user (in which case
 * no giveaways can be created at all). */
let giveaway = {};

/* These lists contain the people that are currently displayed in the bits and
 * subs leaderboards; the arrays are empty when there are no participants of
 * that type in the giveaway, or when there is no giveaway.
 *
 * In all other cases the array contains a set of sorted user records that say
 * who the person is and how many bits or subs they have gifted. */
let bitsLeaders = [];
let subsLeaders = [];


// =============================================================================


/* This is a helper function that can be used in a Draggable dragEnd event
 * handler, and will transmit an overlay drag event to the back end code to
 * tell the back end where the user decided the element that was dragged should
 * appear on the overlay. */
function dragEnder(target, socket) {
  target.classList.remove('border');

  const props = gsap.getProperty(target)
  socket.emit('overlay-drag', {
    name: target.id,
    x: props('x'),
    y: props('y')
  });
}


// =============================================================================


/* Given an overlay record that contains the name of an overlay and a positionm,
 * try to find that overlay item and translate to the appropriate position. */
function moveOverlay(overlay) {
  const element = document.getElementById(overlay.name);
  if (element !== null) {
    element.style.transform = `translate3d(${overlay.x}px, ${overlay.y}px, 0px)`;
  }
}


// =============================================================================


/* Given a box element that has at least one gift-box element in it, capture
 * and return back a DomRect that represents the dimensions of that element
 * so that it can be used to position other elements. */
function getGiftElementSize(boxElement) {
  const box = boxElement.querySelector('div.gift-box');
  if (box === null) {
    console.error('Unable to find gift box; cannot get element size');
    return null
  }

  return box.getBoundingClientRect();
}


// =============================================================================


/* Set up the global GSAP options that we need in order to get our animations
 * and other positions of things working.
 *
 * This includes registering libraries, registering animation plugins, and so
 * on. */
function setupGsap() {
  // Make sure that bundlers know that we're actually using this object, since
  // it's otherwise masked and we don't want tree shaking to kick us in the
  // jimmies.
  gsap.registerPlugin(Draggable);
  gsap.registerPlugin(Flip);

  const blurProperty = gsap.utils.checkPrefix("filter"),
          blurExp = /blur\((.+)?px\)/,
          getBlurMatch = target => (gsap.getProperty(target, blurProperty) || "").match(blurExp) || [];

  gsap.registerPlugin({
      name: "blur",
      get(target) {
          return +(getBlurMatch(target)[1]) || 0;
      },
      init(target, endValue) {
          let data = this,
              filter = gsap.getProperty(target, blurProperty),
              endBlur = "blur(" + endValue + "px)",
              match = getBlurMatch(target)[0],
              index;

          if (filter === "none") {
            filter = "";
          }

          if (match) {
            index = filter.indexOf(match);
            endValue = filter.substr(0, index) + endBlur + filter.substr(index + match.length);
          } else {
            endValue = filter + endBlur;
            filter += filter ? " blur(0px)" : "blur(0px)";
          }

          data.target = target;
          data.interp = gsap.utils.interpolate(filter, endValue);
      },

      render(progress, data) {
          data.target.style[blurProperty] = data.interp(progress);
      }
  });

}


// =============================================================================


/* Set up the initial state of the gift boxes by putting placeholders in them
 * and making sure that we know the sizes of those placeholders for later
 * animations. */
function setupGiftBoxes(config) {
  // Make sure that the content in the page has a placeholder starter item for
  // each of the two leader boxes, then size the headers so that they align with
  // the placeholder.
  subListBox.innerHTML = placeHolderHTML('subs');
  bitListBox.innerHTML = placeHolderHTML('bits');
  subGifterHeaderMinWidth = resizeGifterHeader(gifterSubBox);
  bitGifterHeaderMinWidth = resizeGifterHeader(gifterBitsBox);

  // Capture the dimensions of the gift boxes that we just added, so that as we
  // need to generate animations we can position them the same as they will
  // position themselves natively in the DOM.
  subListDim = getGiftElementSize(gifterSubBox);
  bitListDim = getGiftElementSize(gifterBitsBox);

  // The gift children that we add to the gift boxes are positioned absolutely,
  // and so they are removed from the document flow and don't contribute to the
  // parent height.
  //
  // Since we know exactly how big each item is and the total number of  them
  // that can appear in the list at most, force the height of each overall
  // leaderboard parent to increase their height by that much so that they will
  // visually be large enough to hold all children.
  const subBox = gifterSubBox.getBoundingClientRect();
  const bitBox = gifterBitsBox.getBoundingClientRect();

  gifterSubBox.style.height = `${subBox.height + (config.subsLeadersCount * subListDim.height)}px`;
  gifterBitsBox.style.height = `${bitBox.height + (config.bitsLeadersCount * bitListDim.height)}px`;
}


// =============================================================================


/* Given a list of database records for elements in the page that represent our
 * overlays, position those elements on the page and set them up for a drag/drop
 * operation that will cause an update on the new position to be broadcast back
 * to the back end server. */
function setupOverlays(overlays, socket) {
  // For all of the overlay elements that were loaded, look them up in the DOM
  // and, if found, set an appropriate transformation property upon them.
  overlays.forEach(overlay => {
    moveOverlay(overlay);
  });

  // Set up all of our draggable elements; this needs to happen after a short
  // delay or sometimes (for unknown, sketchy and slightly skeevy reasons) the
  // above set of the translation will be clobbered and the item will appear in
  // the top left corner with no translation. Wacky.
  window.setTimeout(() => {
    Draggable.create(countdownTxt, {
      bounds: document.getElementById('viewport'),
      onDragStart: function() { this.target.classList.add('border'); },
      onDragEnd: function () { dragEnder(this.target, socket); }
    });

    Draggable.create(gifterSubBox, {
      bounds: document.getElementById('viewport'),
      onDragStart: function() { this.target.classList.add('border'); },
      onDragEnd: function () { dragEnder(this.target, socket); }
    });

    Draggable.create(gifterBitsBox, {
      bounds: document.getElementById('viewport'),
      onDragStart: function() { this.target.classList.add('border'); },
      onDragEnd: function () { dragEnder(this.target, socket); }
    });
  }, 1000);

}


// =============================================================================


/* This handles an authorization event update from the back end, which tells us
 * when a user either authorizes the panel or removes existing authorization.
 *
 * For our purposes here in the overlay, we only need to handle making the
 * contents of the overlay hidden or visible; we don't care about the
 * authorization per se. */
function handleAuthUpdate(authData) {
  const overlayComponents = [countdownTxt, gifterSubBox, gifterBitsBox];
  const opacity = authData.authorized === false ? 0 : 1;

  gsap.to(overlayComponents, { opacity, duration: 1 });
}


// =============================================================================


/* This will set the giveaway information provided as the currently known
 * giveaway, and will then update the elapsed time as appropriate for this
 * information.
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

  // Since many states in here need to make sure that the pause state is turned
  // off, turn it off by default and then we only need to turn it on if the
  // giveaway is actually paused.
  countdownTxt.classList.remove('pause');

  // If the object that we got is empty, then there's no information on any
  // particular giveaway, either past or present. In that case the remaining
  // duration should say that there's not any giveaway yet.
  //
  // The same situation also applies if there's no authorized user to create a
  // new giveaway.
  if (Object.keys(giveaway).length === 0) {
    countdownTxt.innerText = 'No giveaway yet; hold tight!';
    return;
  }

  // The giveaway that we're storing must have some information; if it's not a
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
 * this by making sure that the various parts of the overlay are tracking as
 * expected. */
function handleGiveawayTick(newGiveawayData) {
  // This gets sent whenever the state of a giveaway whose information we got
  // via a giveaway-info event changes state, such as pausing, resuming,
  // time changing, etc.
  //
  // Don't be a total maroon this time, this carries new state directly, so do
  // NOT try to compare it against the current information.
  giveaway = newGiveawayData;

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
 * Updates are assumed to be either a list of people that have participated or
 * an empty list, if the list of participants has been cleared away (such as
 * when a new giveaway starts). */
function handleParticipantUpdate(config, eventName, updateData) {
  switch(eventName) {
    case 'bits':
      if (updateData.length === 0) {
        bitListBox.innerHTML = placeHolderHTML('bits');
        bitsLeaders = [];
        return resizeGifterHeader(gifterBitsBox, subGifterHeaderMinWidth);
      }

      bitsLeaders = updateLeaderboard(gifterBitsBox, bitListBox, bitGifterHeaderMinWidth, bitListDim, bitsLeaders, config.bitsLeadersCount, updateData);
      break;

    case 'subs':
      if (updateData.length === 0) {
        subListBox.innerHTML = placeHolderHTML('subs');
        subsLeaders = [];
        return resizeGifterHeader(gifterSubBox, bitGifterHeaderMinWidth);
      }

      subsLeaders = updateLeaderboard(gifterSubBox, subListBox, subGifterHeaderMinWidth, subListDim, subsLeaders, config.subsLeadersCount, updateData);
      break;
  }
}


// =============================================================================


/* Set up everything in the overlay. This initializes the state of everything,
 * ensures that we're connected to the back end socket server, and sets up the
 * appropriate handlers for knowing when key events occur. */
async function setup() {
  // Set up all of the global gsap operations.
  setupGsap();

  // Get our configuration, and then use it to connect to the back end so that
  // we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort, 'overlay');

  // Do the initial setup on the gift boxes, which puts in placeholders for
  // the empty items and captures their dimensions for use in later animation
  // positioning.
  setupGiftBoxes(config);

  // Using the configuration information on overlays ansd their positions, move
  // them into the appropriate place, and set up the drag/drop on their
  // components.
  setupOverlays(config.overlays, socket);

  // This event triggers whenever the authorization state changes in the overlay
  // to either say someone is authorized, or remove their authorization and go
  // back to a default state.
  //
  // We need to handle this specifically because if the user removes their
  // authorization, the overlay needs to remove any displayed data; the back end
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
    // tracking and update the overlay as appropriate.
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
  // If the array has any items in it at all, it's because of a state change in
  // the peopl;e that are participating in the giveaway.
  //
  // For both of these events we take the same actions, except that the list of
  // participants and the container that wraps them are different.
  socket.on('leaderboard-bits-update', data => handleParticipantUpdate(config, 'bits', data));
  socket.on('leaderboard-subs-update', data => handleParticipantUpdate(config, 'subs', data));

  // When we're told that an overlay moved, react to it. Currently this will
  // foolishly update the overlay item that caused this event to trigger, but
  // this sort of thing doesn't happen very frequently, so let's try not to
  // stress about it.
  socket.on('overlay-moved', data => {
    moveOverlay(data);
  });
}


// =============================================================================


/* Preload any google fonts that we're using in the page; once all of the fonts
 * are successfully loaded, the setup() function will be invoked to do any final
 * setup.
 *
 * When changing a font here, you may also need to change the associated CSS in
 * the overlay.css file, since that is what specifies the actual font faces to
 * be used. */
WebFont.load({
  google: {
    families: ['Orbitron:900', 'Montserrat:600', 'Roboto:500']
  },
  active: () => setup(),
  inactive: () => console.log('Unable to load our web fonts; cannot display'),
});
