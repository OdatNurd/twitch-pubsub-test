// =============================================================================


import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { Flip } from 'gsap/Flip';


// =============================================================================


/* The DOM parser we use to turn our snippets of HTML into actual DOM nodes. */
const domParser = new DOMParser();


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


/* Return back the placeholder HTML that should be used to fill out one of the
 * leaderboards (either bits or subs) when it's empty to let the viewers of the
 * stream know that they can gift in order to take the lead.
 *
 * Valid values are 'subs' and 'bits'. */
function placeHolderHTML(holderType) {
  let msg = 'Gift subs now to take the lead!'
  if (holderType === 'bits') {
    msg = 'Cheer now to take the lead!'
  }

  // This needs to have the same class and attribute as a standard div gifter
  // so that it's styled the same and it addressable as the placeholder if
  // needed; the actual content doesn't matter.
  return `<div class="gift-box" data-twitch-id="-1">${msg}</div>`;
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


/* This function uses the incoming update data to queue up some animations for
 * adjusting the scores of people that currently appear on the screen, if their
 * total gift amount in this board has changed.
 *
 * This will animate them even if they're about to be kicked out of the list. */
function updateExistingUserScores(board, current_leaderboard, update_map, parent_timeline) {
  current_leaderboard.forEach(user => {
    // Get the new score; if it didn't change, we can just skip over this one.
    const new_score = update_map[user.userId].score;
    if (user.score === new_score) {
      return;
    }

    // Look for a div that represents this particular user
    const div = divForUserId(board, user.userId);
    if (div === null) {
      return;
    }

    // Grab the score element out and animate it changing
    const score = div.querySelector('.score');
    if (score !== null) {
      const timeline = gsap.timeline({ defaults: { duration: 0.2 }})
        .to(score, { blur: 5, scale: 3, onComplete: () => score.innerText = new_score })
        .to(score, { blur: 0, scale: 1 });

      parent_timeline.add(timeline, 0);
    }
  });
}


// =============================================================================


/* This function will find all of the people that are currently visible in the
 * leaderboard in the overlay that are no longer eligible to be there and
 * animate them leaving the leaderboard. */
function removeIneligibleUsers(board, leaderboard, ineligible_partipants, parent_timeline) {
  // The people that are leaving are the people on the leaderboard that are also
  // currently ineligible to be there. If that is nobody, we can just leave.
  const leaving = [...leaderboard].filter(x => ineligible_partipants.has(x));
  if (leaving.length === 0) {
    return;
  }

  // For all of the people that are leaving, we're going to queue up an
  // animation; we want then to all run sequentially, so set up a timeline with
  // some default values.
  const timeline = gsap.timeline({ defaults: { opacity: 0, x: -100, duration: .65,
                                               ease: "elastic.out(2, 0.4)" }});
  leaving.forEach(userId => {
    const div = divForUserId(board, userId);
    if (div === null) {
      return;
    }

    timeline.to(div, { onComplete: () => board.removeChild(div) });
  });

  parent_timeline.add(timeline);
}

// =============================================================================


/* This function will find all of the people that are currently visible in the
 * leaderboard on the overlay that are still eligible to be there, and alter
 * their visible position on the board so that they animate to where they now
 * belong. */
function rearrangeRemainingUsers(board, leaderboard, current_leaderboard, eligible_partipants, dimensions, parent_timeline) {
  // The list of people that are remaining are all of the people on the
  // leaderboard that are still eligible to be there. If there are none, we can
  // just leave.
  const loiterers = [...eligible_partipants].filter(x => leaderboard.has(x));
  if (loiterers.length === 0) {
    return;
  }

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
    parent_timeline.add(Flip.from(startState, { duration: 1, ease: "elastic.out(1, 0.3)" }))
  }
}


// =============================================================================


/* This function will find all of the people that are eligible to be in the
 * leaderboard display, but which are currently not, and animate them into
 * position.
 *
 * It assumes that the vial space for each item being added has been made by
 * kicking people out of the list and/or rearranging people into a better
 * position. */
function addNewUsers(board, leaderboard, current_leaderboard, eligible_partipants, update_map, dimensions, parent_timeline) {
  // The list of people being added to the leaderboard are the people that are
  // eligible to be there, but which are currently not. If there are none, we
  // can leave.
  const arrivals = [...eligible_partipants].filter(x => leaderboard.has(x) === false);
  if (arrivals.length === 0) {
    return 0;
  }

  // If there is someone arriving into the board but the leaderboard is
  // currently empty, then this is the first addition; we need to animate the
  // placeholder going away so that we can make room.
  if (arrivals.length !== 0 && current_leaderboard.length === 0) {
    const div = divForUserId(board, "-1");
    if (div !== null) {
      const tween = gsap.to(div, { duration: 0.25, scale: 0.15, blur: 5, opacity: 0, onComplete: () => board.removeChild(div) });
      parent_timeline.add(tween);
    }
  }

  // Create divs for all of the people that will be added to the list.
  const animList = arrivals.map(userId => {
    const idx = eligible_partipants.indexOf(userId);
    const gifter = update_map[userId];

    const div = divForGifter(gifter);
    div.style.top = idx * dimensions.height + dimensions.top;

    board.appendChild(div);
    return div;
  });

  parent_timeline.from(animList, { duation: 1, ease: "elastic.out(1, 0.3)", opacity: 0, x: 200, stagger: 0.50 });
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
  current_leaderboard ??= [];

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
  updateExistingUserScores(board, current_leaderboard, update_map, timeline);

  // ====================================================================
  // Step 1: Kick people out of the leaderboard that have lost their spot
  // ====================================================================
  removeIneligibleUsers(board, leaderboard, ineligible_partipants, timeline)

  // =======================================================================
  // Step 2: Rearrange people that will remain in the list to their new spot
  // =======================================================================
  rearrangeRemainingUsers(board, leaderboard, current_leaderboard, eligible_partipants, dimensions, timeline);

  // =======================================================================
  // Step 3: Add incoming new people into the leaderboard at the proper spot
  // =======================================================================
  addNewUsers(board, leaderboard, current_leaderboard, eligible_partipants, update_map, dimensions, timeline);

  // All animation setup is done, so start the animation running.
  timeline.play();

  // Return the new leaderboard; this is just the top portion of the incoming
  // update.
  return updated_data.splice(0, display_size);
}


// =============================================================================

module.exports = {
  resizeGifterHeader,
  updateLeaderboard,
  placeHolderHTML,
};
