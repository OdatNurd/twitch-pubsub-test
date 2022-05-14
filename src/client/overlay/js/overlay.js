// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');

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

/* The DOM parser we use to turn our snippets of HTML into actual DOM nodes. */
const domParser = new DOMParser();

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


/* Create and return a new uniquely addressable div containing the information
 * on the gifter provided. */
function divForGifter(gifter) {
  return domParser.parseFromString(
    `<div class="gift-box" data-twitch-id="${gifter.userId}">
      <span class="name">${gifter.name}</span>
      (<span class="score">${gifter.score}</span>)
    </div>`, 'text/html').querySelector('div');
}


// =============================================================================


/* Given a div element that represents a leaderboard, check the contents of the
 * leaderboard entries (assumed to be in the first child div) to see which is
 * the longest, and then size the header element (assumed to be the first child
 * H4 tag) to be that wide.
 *
 * If the header or the child div is not present, then this silently does
 * nothing so as to not destroy the DOM or trigger errors. */
function resizeGifterHeader(boxElement, minWidth) {
  const contents = boxElement.querySelector('div');
  const header = boxElement.querySelector('h4');
  const headerWidth = minWidth ?? header.getBoundingClientRect().width;

  if (contents !== null && header !== null) {
    const maxWidth = Array.from(contents.children).reduce((prev, cur) => {
      const width = cur.getBoundingClientRect().width;
      return (width > prev) ? width : prev;
    }, headerWidth);

    gsap.to(header, { width: maxWidth, duration: 0.25 });
  }

  return headerWidth
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


/* Given a DOM node that is the parent leaderboard element container for one of
 * the leaderboards and a userID, return back the <div> that wraps that user;
 * null will be returned if there is no such user found; an error will also be
 * displayed. */
function divForUserId(parentLeaderboard, userId) {
  const div = parentLeaderboard.querySelector(`div[data-twitch-id="${userId}"]`);
  if (div === null) {
    console.log(`error while updating leaderboard; unable to find div for ${userId}`);
  }

  return div;
}


// =============================================================================

/* Update the leaderboard of the given type using the items provided; new items
 * will be added to the element provides. */
function updateLeaderboard(giftBox, board, headerWidth, dimensions, current_leaderboard, display_size, updated_data) {
  console.log(`updateLeaderboard(${headerWidth})`);
  // console.log(JSON.stringify(current_leaderboard, null, 2));

  // Create a timeline that will contain all of the animations that we're going
  // to be displaying as a part of the update. We make this paused and add in
  // animations as needed, and then play everything on the way out.
  const timeline = gsap.timeline({ paused: true, onComplete: () => resizeGifterHeader(giftBox, headerWidth) });

  // If the current leaderboard is undefined, this is the first update that it's
  // ever received; for our work below we need this to be valid.
  current_leaderboard = current_leaderboard ||   [];

  // Capture a set that represents the list of people that are currently
  // visualized on the leaderboard; this could be empty if this is the first
  // update of its type, so we need to guard against the list not being
  // available.
  const leaderboard = new Set(current_leaderboard.map(e => e.userId));

  // Do the same for the list of users in the update; this version is always an
  // array because we're going to need to spread it to make cloned sub-arrays.
  const update_users = updated_data.map(e => e.userId);

  // Create sub-arrays that are the people that are eligible to be on the
  // leaderboard or not eligible, based on the display size we were given.
  const eligible_partipants = [...update_users].splice(0, display_size);
  const ineligible_partipants = new Set([...update_users].splice(display_size));

  // Create a version of the update data that's addressable by looking up based
  // on the userId.
  const update_map = updated_data.reduce((table, user) => {
      table[user.userId] = user;
      return table;
    }, {});

  // =============================================================
  // Step 0: Update scores for people currently on the leaderboard
  // =============================================================
  current_leaderboard.forEach(user => {
    const new_score = update_map[user.userId].score;

    // If the score for this user didn't change, then there's nothing that we
    // have to do.
    if (user.score === new_score) {
      return;
    }

    // Make sure the entry in the leaderboard is up to date with the new score.
    user.score = new_score;

    // Look for a div that represents this particular user
    const div = divForUserId(board, user.userId);
    if (div === null) {
      return;
    }

    // Grab the score element out and animate it changing; this will make it
    // scale up while blurring, then alter the text to the new value before
    // shrinking back down.
    const score = div.querySelector('.score');
    if (score !== null) {
      const subTl = gsap.timeline({ defaults: { duration: 0.2 }})
        .to(score, { blur: 5, scale: 2.5, onComplete: () => score.innerText = user.score })
        .to(score, { blur: 0, scale: 1 });

      timeline.add(subTl, 0);
    }
  });


  // ====================================================================
  // Step 1: Kick people out of the leaderboard that have lost their spot
  // ====================================================================
  const leaving = [...leaderboard].filter(x => ineligible_partipants.has(x));
  // console.log('leaving => ', leaving);

  const departures_tl = gsap.timeline({ defaults: { duration: .65, ease: "elastic.out(2, 0.4)" }})
  leaving.forEach(userId => {
    const div = divForUserId(board, userId);
    if (div === null) {
      return;
    }

    departures_tl.to(div, { opacity: 0, x: -100, onComplete: () => {
      board.removeChild(div);
    }});
  });
  timeline.add(departures_tl);


  // =======================================================================
  // Step 2: Rearrange people that will remain in the list to their new spot
  // =======================================================================
  const loiterers = [...eligible_partipants].filter(x => leaderboard.has(x));
  // console.log('loiterers => ', loiterers);

  // If there are any loiterers around, then we can rearrange them as needed
  // so that they end up in the right spot.
  //
  // NOTE: This is going to capture the state of all children as they currently
  //       exist, but since we might have kicked people out, it's going to
  //       capture the state of children that are going away but are technically
  //       still here. Does that matter? Maybe not, if we position things such
  //       that they end up in the same place anyway?
  if (loiterers.length !== 0) {
    // Save the state of the current children.
    const startState = Flip.getState(board.children);
    let shifted = 0;

    // For each person hanging around, figure out what their index is going to
    // be, and also what their index currently is. If they're different, then
    // they need to move; if they're the same, we do nada.
    loiterers.forEach(userId => {
      const cur_idx = current_leaderboard.findIndex(user => user.userId === userId);
      const new_idx = eligible_partipants.indexOf(userId);

      if (cur_idx !== new_idx) {
        const div = divForUserId(board, userId);
        if (div === null) {
          return;
        }

        shifted++;
        div.style.top = new_idx * dimensions.height + dimensions.top;
      }
    });

    // If any children have shifted locations, then we can schedule the
    // animation now.
    if (shifted !== 0) {
      timeline.add(Flip.from(startState))
    }
  }


  // =======================================================================
  // Step 3: Add incoming new people into the leaderboard at the proper spot
  // =======================================================================
  const arrivals = [...eligible_partipants].filter(x => leaderboard.has(x) === false);
  // console.log('arrivals => ', arrivals);

  // If the list of arrivals is not empty but the leaderboard is, then this is
  // the very first user that's being added to the leaderboard. If that's the
  // case, we need to vanish away the placeholder.
  if (arrivals.length !== 0 && current_leaderboard.length === 0) {
    // Find the placeholder div in this board; if we find it, make it hide
    // itself, and then remove it from the DOM.
    const div = divForUserId(board, "-1");
    if (div !== null) {
      const subTl = gsap.timeline()
        .to(div, { duration: 0.50, scale: 0.25, blur: 3, opacity: 0, onComplete: () => {
          board.removeChild(div);
        }});
      timeline.add(subTl);
    }
  }

  const arrivals_tl = gsap.timeline({ defaults: { duration: .65, ease: "elastic.out(2, 0.4)" }})
  arrivals.forEach(userId => {
    const idx = eligible_partipants.indexOf(userId);
    const gifter = update_map[userId];

    const div = divForGifter(gifter);
    div.style.top = idx * dimensions.height + dimensions.top;
    board.appendChild(div);
    arrivals_tl.from(div, { opacity: 0, x: 500 });

  });
  timeline.add(arrivals_tl);

  // All animation setup is done, so start the animation running.
  timeline.play();

  // Return the new leaderboard; this is just the top portion of the incoming
  // update.
  return updated_data.splice(0, display_size);
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
