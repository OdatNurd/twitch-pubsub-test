// =============================================================================

const { sendSocketMessage } = require('./socket');

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
  round: false
});


/* The database record that represents the currently running giveaway, if any.
 *
 * At any given time there can be at most one giveaway running in the channel,
 * although all past giveaways are archived for data reasons. */
let currentGiveaway = undefined;

/* When a giveaway timer is running, this is the ID that can be used to cancel
 * it if we no longer want it to be running. */
let giveawayTimerID = undefined;

/* The clock time the last time the countdown event timer ticked; when it's 0
 * it means that the timer has never ticked before. Before we start a timer,
 * this is always set to the current time. */
let lastTickTime = 0;

/* The clock time the last time that the state of a running giveaway was backed
 * up to the database; when its 0 it means that there has never been a giveaway
 * this run. Before we start a timer, this is always set to the current time. */
let lastSyncTime = 0;


// =============================================================================


/* Process one tick of the giveaway timer; this is used to keep the database
 * updated with currently elapsed times on the giveaway as well as to mark when
 * the giveaway is completed. */
async function giveawayTimerTick(db) {
  // Get the time for the current tick.
  const thisTime = Date.now();

  // Figure out the elapsed time since the last timer tick happened; this could
  // be more or less than the actual amount of time that we requested.
  const deltaTime = thisTime - lastTickTime;
  lastTickTime = thisTime;

  // Add the amount of elapsed time for this tick to the elapsed time in the
  // giveaway.
  currentGiveaway.elapsedTime += deltaTime;

  // If the elapsed time has been reached, the giveaway is now ended.
  if (currentGiveaway.elapsedTime >= currentGiveaway.duration) {
    console.log('Giveaway: Giveaway has ended');

    currentGiveaway.endTime = new Date();
    await db.getModel('giveaways').update( { id: currentGiveaway.id }, currentGiveaway);

    // This giveaway is now completed, so we should tell interested parties
    // about it.
    currentGiveaway = undefined;

    sendSocketMessage('giveaway-info', {});
    return
  }

  // Send a status update to anyone interested.
  sendSocketMessage('giveaway-tick', currentGiveaway);

  // Dump the current information to the database.
  if (thisTime - lastSyncTime >= 10000) {
    await db.getModel('giveaways').update( { id: currentGiveaway.id }, currentGiveaway);
    lastSyncTime = thisTime;
  }

  // Figure when the next tick should happen, which is either a second from now
  // OR however much time is left on the timer, whichever is smaller.
  const nextTick = Math.min(1000, currentGiveaway.duration - currentGiveaway.elapsedTime);

  // console.log(`last = ${deltaTime}, next = ${nextTick}`);

  // Schedule a new call
  giveawayTimerID = setTimeout(() => giveawayTimerTick(db), nextTick);
}


// =============================================================================


/* Start a new giveaway, if one is not already running. The request expects a
 * duration in milliseconds and the userID of the user who the giveaway is for.
 *
 * Once this is done, the same handling that would trigger whenever a user is
 * authorized is triggered, which will actually start the giveaway running. */
async function startGiveaway(db, req, res) {
  // Pull the ripcord if somehow this gets called when there's already a
  // giveaway in progress.
  if (currentGiveaway !== undefined) {
    return;
  }

  // Insert into the database a new giveaway for the user provided that is
  // flagged to start at the current time and use the given duration; it starts
  // as non-paused and can in theory be for any user and not necessarily the
  // currently authorized one (if any).
  console.log(`Giveaway: New giveaway for ${req.query.userId} (${humanize(req.query.duration)})`);
  await db.getModel('giveaways').create({
    userId: req.query.userId,
    startTime: new Date(),
    endTime: null,

    duration: req.query.duration,
    elapsedTime: 0,
    paused: false,
  });

  // Lean on the code that knows how to restart a giveaway for the current user
  // and get it to find the entry we just made, set everything up and send off
  // the notice that the giveaway is running.
  resumeCurrentGiveaway(db, req.query.userId, false);

  res.json({success: true});
}


// =============================================================================


/* Pause an existing giveaway, if one is running and not already paused.
 *
 * This will stop the running timer, change the state on the current giveaway,
 * update the database and then let the front end code know the new state. */
async function pauseGiveaway(db, req, res) {
  // Pull the ripcord if somehow this gets called when there's not already a
  // giveaway in progress, or if there is but it's paused already.
  if (currentGiveaway === undefined || currentGiveaway.paused === true) {
    return;
  }

  console.log(`Giveaway: Pausing giveaway (${humanize(currentGiveaway.duration - currentGiveaway.elapsedTime)} remaining)`);

  // If there is currently a timer running, cancel it so that it stops ticking.
  // Even if there's not, this function silently does nothing if the timer ID[
  // you give it is not valid.
  clearTimeout(giveawayTimerID);

  // Set the paused flag on the current giveaway and then update the database
  // to make sure that it knows what the current state is.
  currentGiveaway.paused = true;
  await db.getModel('giveaways').update( { id: currentGiveaway.id }, currentGiveaway);

  // Let everyone know the new state of the giveaway.
  sendSocketMessage('giveaway-info', currentGiveaway);
  res.json({success: true});
}


// =============================================================================


/* Restart a paused giveaway, if one is running and is actually paused.
 *
 * This will change the state on the current giveaway, update the database, let
 * the front end code know the new state and then kick off a new timer. */
async function unpauseGiveaway(db, req, res) {
  // Pull the ripcord if somehow this gets called when there's not already a
  // giveaway in progress, or if there is but it's not currently paused.
  if (currentGiveaway === undefined || currentGiveaway.paused === false) {
    return;
  }

  console.log(`Giveaway: Resuming giveaway (${humanize(currentGiveaway.duration - currentGiveaway.elapsedTime)} remaining)`);

  // Reset the paused flag on the current giveaway and then update the database
  // to make sure that it knows what the current state is.
  currentGiveaway.paused = false;
  await db.getModel('giveaways').update( { id: currentGiveaway.id }, currentGiveaway);

  // Let interested parties know that the state changed.
  sendSocketMessage('giveaway-info', currentGiveaway);

  // Set up the variables that let us know when we last ticked and last synced,
  // then start the timer.
  lastTickTime = lastSyncTime = Date.now();
  giveawayTimerTick(db)

  res.json({success: true});
}


// =============================================================================


function cancelGiveaway(db, req, res) {
  console.log('cancelling giveaway');
  currentGiveaway = undefined

  sendSocketMessage('giveaway-info', {});
  res.json({success: true});
}


// =============================================================================


/* This is invoked in response to a user authenticating themselves with the
 * overlay, and it attempts to resume a previously started giveaway that was
 * not completed the last time the application either terminated or the user
 * logged out.
 *
 * In practice, this will look into the database to find the most recent
 * giveaway entry for the user that just logged in, and if it has some amount
 * of time left in it, it will be used to set up the current giveaway.
 *
 * The giveaway data is updated, but the timer doesn't actually start until the
 * user requests it via the controls in the panel. */
async function resumeCurrentGiveaway(db, userId, autoPause) {
  // console.log('==================================');
  // console.log(new Date());
  // console.log(await db.getModel('giveaways').find({}));
  // console.log('==================================');

  // Order the giveaway entries by their start time and pluck the most recent
  // one started by this user from the list; if there is currently a giveaway
  // running, it would be this one.
  let entry = await db.getModel('giveaways').findOne({ userId }, {
    order: ['startTime', 'desc'],
    limit: 1
  });

  // This giveaway could be the current giveaway, but for that to be the case
  // there has to be some amount of time remaining in the duration.
  if (entry === undefined || entry.elapsedTime >= entry.duration) {
    return;
  }

  // Set up this giveaway as the current one.
  currentGiveaway = entry;

  if (autoPause === true) {
    console.log(`Giveaway: Giveaway is in progress (${humanize(currentGiveaway.duration - currentGiveaway.elapsedTime)} remaining); auto-pausing it`);
    currentGiveaway.paused = true;
    await db.getModel('giveaways').update({ id: currentGiveaway.id }, currentGiveaway);
  }

  // If the current giveaway is not paused, then we need to set up a timer that
  // will actually track the giveaway duration. This will happen if a new
  // giveaway was just created for example.
  if (currentGiveaway.paused !== true) {
    // Set the current time as the last time that the timer ticked, and then
    // kick off the timer.
    lastTickTime = lastSyncTime = Date.now();
    giveawayTimerTick(db)
  }

  sendSocketMessage('giveaway-info', currentGiveaway);
}


// =============================================================================


/* This is invoked in response to the user logging out of the overlay; when
 * this happens we need to pause the current giveaway, make sure it's updated
 * in the database, and then reset back to our initial startup state. */
async function suspendCurrentGiveaway(db) {
  // If there's not currently a giveaway, then we don't need to do anything.
  if (currentGiveaway === undefined) {
    return;
  }

  // Make sure that the current giveaway is updated in the database, so that we
  // have an updated accounting of how much time has elapsed; also pause it for
  // good measure.
  currentGiveaway.paused = true;
  await db.getModel('giveaways').update({ id: currentGiveaway.id }, currentGiveaway);

  // Terminate the current giveaway, and let interested parties know.
  currentGiveaway = undefined;
  sendSocketMessage('giveaway-info', currentGiveaway);
}


// =============================================================================


/* This sets up the giveaway handling for the overlay, which encompasses both
 * figuring out at startup if there is a current giveaway as well as sending out
 * messages regarding giveaway events as they occur. */
function setupGiveawayHandler(db, app, bridge) {
  bridge.on('twitch-authorize', twitch => resumeCurrentGiveaway(db, twitch.userInfo.id, true));
  bridge.on('twitch-deauthorize', twitch => suspendCurrentGiveaway(db));

  // Set up the routes that allow the controls in the main panel to manipulate
  // the current giveaway state.
  app.get('/giveaway/start', (req, res) => startGiveaway(db, req, res));
  app.get('/giveaway/pause', (req, res) => pauseGiveaway(db, req, res));
  app.get('/giveaway/unpause', (req, res) => unpauseGiveaway(db, req, res));
  app.get('/giveaway/cancel', (req, res) => cancelGiveaway(db, req, res));

  // Every time a new socket connects to the server, send it a message to tell
  // it the state of the current giveaway, if any.
  bridge.on('socket-connect', socket => {
    socket.emit('giveaway-info', {
      startTime: currentGiveaway?.startTime,
      endTime: currentGiveaway?.endTime,
      duration: currentGiveaway?.duration,
      elapsedTime: currentGiveaway?.elapsedTime,
      paused: currentGiveaway?.paused,
    });
  });
}


// =============================================================================


module.exports = {
  setupGiveawayHandler,
}
