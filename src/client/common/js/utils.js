// =============================================================================


/* Given a giveaway object, return back how much time is remaining in that
 * giveaway. The return value will be some number (which may be <= 0) that
 * says how much longer this will run.
 *
 * If there's no giveaway info provided, undefined is returned. */
function remainingDuration(giveaway) {
  if (giveaway !== undefined && Object.keys(giveaway).length !== 0) {
    return giveaway.duration - giveaway.elapsedTime;
  }

  return undefined;
}


// =============================================================================


/* Returns an indication on wether there's currently a giveaway in progress or
 * not. A giveaway is in progress if we know about one, it has any time left
 * and it's not cancelled.
 *
 * If we don't know about a giveaway, or we do but it has expired or been
 * cancelled, then by definition a giveaway is not running.
 *
 * A giveaway can be running and still be paused; this will return true in that
 * case. */
function giveawayRunning(giveaway) {
  // A giveaway can't be running if we don't know about it, it's been cancelled,
  // or it's not cancelled but it does has no time remaining.
  if (giveaway === undefined || Object.keys(giveaway).length === 0 || giveaway.cancelled === true || remainingDuration(giveaway) <= 0) {
    return false;
  }

  // If we get here, there's a giveaway running
  return true;
}


// =============================================================================


module.exports = {
  giveawayRunning,
  remainingDuration,
}