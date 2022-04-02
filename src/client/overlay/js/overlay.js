// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');

import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';

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
const gifterSubBox = document.getElementById('gifters-subs');
const gifterBitsBox = document.getElementById('gifters-bits');

const bitListBox = document.getElementById('bit-list');
const subListBox = document.getElementById('sub-list');

/* The DOM parser we use to turn our snippets of HTML into actual DOM nodes. */
const domParser = new DOMParser();

/* The status of the currently active giveaway (if any); this tracks things like
 * the duration and the elapsed time. */
let currentGiveaway = undefined;


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


/* Update the leaderboard of the given type using the items provided; new items
 * will be added to the element provides. */
function updateLeaderboard(board, type, items) {
  const bits = items.map((g, i) =>
    domParser.parseFromString(
      `<div id="${type}-${i+1}">
        <span class="name">${g.name}</span>
        (<span class="score">${g.score}</span>)
      </div>`, 'text/html').querySelector('div'));

  board.replaceChildren(...bits);
}


// =============================================================================


/* Set up everything in the overlay. This initializes the state of everything,
 * ensures that we're connected to the back end socket server, and sets up the
 * appropriate handlers for knowing when key events occur. */
async function setup() {
  // Make sure that bundlers know that we're actually using this object, since
  // it's otherwise masked and we don't want tree shaking to kick us in the
  // jimmies.
  gsap.registerPlugin(Draggable);

  // Get our configuration, and then use it to connect to the back end so that
  // we can communicate with it and get events.
  const config = await getConfig();
  const socket = getWebSocket(location.hostname, config.socketPort);

  // For all of the overlay elements that were loaded, look them up in the DOM
  // and, if found, set an appropriate transformation property upon them.
  config.overlays.forEach(overlay => {
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

  // When the information on the current giveaway changes, take an action; this
  // triggers when  a new giveaway starts, one ends, or the pause state changes.
  socket.on("giveaway-info", data => {
    // Set up our current giveaway to track the incoming data.
    currentGiveaway = Object.keys(data).length === 0 ? undefined : data;

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
  socket.on('leaderboard-bits-update', data =>
      updateLeaderboard(bitListBox, 'bits', data.splice(0, config.bitsLeadersCount)));

  // Update the subs leaderboard when a new message comes in.
  socket.on('leaderboard-subs-update', data =>
      updateLeaderboard(subListBox, 'subs', data.splice(0, config.subsLeadersCount)));
}


// =============================================================================


setup();
