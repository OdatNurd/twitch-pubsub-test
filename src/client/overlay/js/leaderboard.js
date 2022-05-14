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

module.exports = {
  resizeGifterHeader,
  updateLeaderboard,
};
