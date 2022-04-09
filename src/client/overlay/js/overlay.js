// =============================================================================


const getConfig = require('../../common/js/config');
const { getWebSocket } = require('../../common/js/websocket');

import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { Flip } from 'gsap/Flip';

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

/* The list of people that are on the bits leaderboard; when this is undefined,
 * there is not currently anyone in the bits list. */
let bitsLeaders = undefined;

/* This HTML is used to specify the default entry in a gifter box when it's
 * empty, so that people know they should gift. This also allows us to pick up
 * the dimensions of an item in the list. */
const placeholderHtml = `<div class="gift-box border">Gift now to take the lead!</div>`;


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
    `<div class="gift-box border" data-twitch-id="${gifter.userId}">
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
function resizeGifterHeader(boxElement) {
  const contents = boxElement.querySelector('div');
  const header = boxElement.querySelector('h4');

  if (contents !== null && header !== null) {
    const maxWidth = Array.from(contents.children).reduce((prev, cur) => {
      const width = cur.getBoundingClientRect().width;
      return (width > prev) ? width : prev;
    }, 0);

    header.style.width = `${maxWidth}px`;
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


/* Update the leaderboard of the given type using the items provided; new items
 * will be added to the element provides. */
function updateLeaderboard(board, type, items) {
  console.log(`updateLeaderboard(${type})`);
  // For now, only worry about bits; once this works for bits we can easily
  // make it more generic for subs, since the containers are the same.
  if (type !== 'bits') {
    return;
  }

  // If we don't already have a leaderboard, then this might be setting one up.
  if (bitsLeaders === undefined) {
    // If the list we got is empty, then just leave; this is the back end giving
    // us a courtesy update, but we don't need it here.
    if (items.length === 0) {
      return;
    }

    // Store this as the initial list of bits leaders.
    bitsLeaders = items;

    // Create a div for each of these items and then add them to the page.
    const bits = items.map((g, i) => divForGifter(g));
    board.replaceChildren(...bits);

    // Bounce them in from the right, in a staggered fashion; the list is now
    // visualized, we can leave.
    gsap.from(bits, { opacity: 1, x: 1920, duration: .65, stagger: 0.05, ease: "elastic.out(2, 0.4)" });
    return;
  }

  // The list is updating to new contents. Currently this assumes that the list
  // always has the same people in it, for expediency in testing. In any case,
  // save this new list of bits leaders so we know for next time.
  bitsLeaders = items;

  // If there is only 1 item in the list, there's not a lot of exciting fake
  // animations that we need to run.
  if (items.length < 1) {
    return;
  }

  // Create a timeline onto which we can attach our tweens.
  const timeline = gsap.timeline({ paused: true });

  // For each item in the incoming list, look to see if they have a div that
  // exists in the current page; if they do and their score is different than
  // what is being provided in the update, do an animation that will alter the
  // visible score.
  items.forEach(g => {
    // {userId: '66586458', name: 'odatnurd', score: 40}
    const div = board.querySelector(`div[data-twitch-id="${g.userId}"]`);
    if (div !== null) {
      const score = div.querySelector('.score');
      if (score !== null) {
        if (parseInt(score.innerText, 10) !== g.score) {
          score.innerText = g.score;
          timeline.to(score, { blur: 5, duration: 0.2 }, 0)
                  .to(score, { blur: 0, duration: 0.2 });
        }
      }
    }
  });

  // TODO:
  // If the number of items in the list is different, the new person won't show
  // up; that's an artifact of our hacky testing here. This should of course
  // take that into account.

  // Save the current state of the children in this board; this gets us an object
  // that contains the current position state.
  const state = Flip.getState(board.children);
  const firstIdx = 0;
  const lastIdx = items.length - 1;

  // Get the list of child nodes, and the top positions of the first and last
  // items, then swap their tops so that they appear to change positions visibly.
  const kids = board.children;
  const t1 = kids[firstIdx].getBoundingClientRect().top;
  const t2 = kids[lastIdx].getBoundingClientRect().top;
  kids[firstIdx].style.top = t2 - t1;
  kids[lastIdx].style.top = t1 - t2;

  // Get GSap to animate the items from the saved state. This will apply offsets
  // to the items as they currently exist to put them back where they started
  // visibly, and then animate them to the position they're currently in.
  timeline.add(Flip.from(state, {
    duration: 1,
    ease: "elastic.out(1.5, 2)",
    // absolute: true,
    onComplete: () => {
      // When the animation is complete, reset the tops and swap the dom
      // elements so they go into their native positions.
      kids[firstIdx].style.top = 0;
      kids[lastIdx].style.top = 0;

      // Swap the dom element position now
      board.replaceChildren(...Array.from(kids).reverse());
    }
  }));

  timeline.play();
  return;
}


// =============================================================================


/* Set up the global GSAP options that we need in order to get our animations
 * and other poritions of things working.
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
  resizeGifterHeader(gifterSubBox);
  resizeGifterHeader(gifterBitsBox);

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

      bitListBox.innerHTML = placeholderHtml;
      subListBox.innerHTML = placeholderHtml;
      resizeGifterHeader(gifterBitsBox);
      resizeGifterHeader(gifterSubBox);
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
  socket.on('leaderboard-bits-update', data =>
      updateLeaderboard(bitListBox, 'bits', data.splice(0, config.bitsLeadersCount)));

  // Update the subs leaderboard when a new message comes in.
  socket.on('leaderboard-subs-update', data =>
      updateLeaderboard(subListBox, 'subs', data.splice(0, config.subsLeadersCount)));
}


// =============================================================================


setup();
