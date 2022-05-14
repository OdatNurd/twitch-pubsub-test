// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');

const { resizeGifterHeader, updateLeaderboard } = require('./leaderboard');
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

/* The status of the currently active giveaway (if any); this tracks things like
 * the duration and the elapsed time. */
let currentGiveaway = undefined;

/* The list of people that are on the bits and subs leaderboards; when they are
 * undefined, there is not currently anyone in that list. When defined, the list
 * is an array of the update objects that make up that leaderboard, in the order
 * in which the items appear there. */
let bitsLeaders = undefined;
let subsLeaders = undefined;

/* This HTML is used to specify the default entry in a gifter box when it's
 * empty, so that people know they should gift. This also allows us to pick up
 * the dimensions of an item in the list. */
const placeholderHtml = `<div class="gift-box" data-twitch-id="-1">Gift now to take the lead!</div>`;


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
function setupGiftBoxes() {
  // Make sure that the content in the page has a placeholder starter item for
  // each of the two leader boxes, then size the headers so that they align with
  // the placeholder.
  subListBox.innerHTML = placeholderHtml;
  bitListBox.innerHTML = placeholderHtml;
  subGifterHeaderMinWidth = resizeGifterHeader(gifterSubBox);
  bitGifterHeaderMinWidth = resizeGifterHeader(gifterBitsBox);

  // Capture the dimensions of the gift boxes that we just added, so that as we
  // need to generate animations we can position them the same as they will
  // position themselves natively in the DOM.
  subListDim = getGiftElementSize(gifterSubBox);
  bitListDim = getGiftElementSize(gifterBitsBox);
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

/* Set up everything in the overlay. This initializes the state of everything,
 * ensures that we're connected to the back end socket server, and sets up the
 * appropriate handlers for knowing when key events occur. */
async function setup() {
  // Set up all of the global gsap operations.
  setupGsap();

  // Do the initial setup on the gift boxes, which puts in placeholders for
  // the empty items and captures their dimensions for use in later animation
  // positioning.
  setupGiftBoxes();

  // Get our configuration, and then use it to connect to the back end so that
  // we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort);

  // Using the configuration information on overlays ansd their positions, move
  // them into the appropriate place, and set up the drag/drop on their
  // components.
  setupOverlays(config.overlays, socket);

  // When the information on the current giveaway changes, take an action; this
  // triggers when  a new giveaway starts, one ends, or the pause state changes.
  socket.on("giveaway-info", data => {
    // Set up our current giveaway to track the incoming data.
    currentGiveaway = Object.keys(data).length === 0 ? undefined : data;
    if (currentGiveaway === undefined) {
      bitsLeaders = undefined;
      subsLeaders = undefined;

      bitListBox.innerHTML = placeholderHtml;
      subListBox.innerHTML = placeholderHtml;
      resizeGifterHeader(gifterBitsBox, subGifterHeaderMinWidth);
      resizeGifterHeader(gifterSubBox, bitGifterHeaderMinWidth);
    }

    if (currentGiveaway !== undefined) {
      gsap.to(countdownTxt, { opacity: 1, duration: 1 });
      gsap.to(gifterSubBox, { opacity: 1, duration: 1 });
      gsap.to(gifterBitsBox, { opacity: 1, duration: 1 });
    }

    if (currentGiveaway === undefined) {
      gsap.to(countdownTxt, { opacity: 0, duration: 1 });
      gsap.to(gifterSubBox, { opacity: 0, duration: 1 });
      gsap.to(gifterBitsBox, { opacity: 0, duration: 1 });
    }

    if (data.paused) {
      countdownTxt.classList.add('pause');
    } else {
      countdownTxt.classList.remove('pause');
    }
  });

  // When we're told that an overlay moved, react to it. Currently this will
  // foolishly update the overlay item that caused this event to trigger, but
  // this sort of thing doesn't happen very frequently, so let's try not to
  // stress about it.
  socket.on('overlay-moved', data => {
    moveOverlay(data);
  });

  // When the duration of the giveaway changes, update things.
  socket.on("giveaway-tick", data => {
    countdownTxt.innerText = `${humanize(data.duration - data.elapsedTime)} remaining`;
  });

  // Update the bits leaderboard when a new message comes in.
  socket.on('leaderboard-bits-update', data => {
    bitsLeaders = updateLeaderboard(gifterBitsBox, bitListBox, bitGifterHeaderMinWidth, bitListDim, bitsLeaders, config.bitsLeadersCount, data);
  });

  // Update the subs leaderboard when a new message comes in.
  socket.on('leaderboard-subs-update', data => {
      subsLeaders = updateLeaderboard(gifterSubBox, subListBox, subGifterHeaderMinWidth, subListDim, subsLeaders, config.subsLeadersCount, data);
  });
}


// =============================================================================

WebFont.load({
  google: {
    families: ['Orbitron:900', 'Montserrat:600', 'Roboto:500']
  },
  active: () => setup(),
  inactive: () => console.log('Unable to load our web fonts; cannot display'),
});
