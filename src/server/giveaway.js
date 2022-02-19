// =============================================================================

const { sendSocketMessage } = require('./socket');

/* The database record that represents the currently running giveaway, if any.
 *
 * At any given time there can be at most one giveaway running in the channel,
 * although all past giveaways are archived for data reasons. */
let currentGiveaway = undefined;


// =============================================================================


function startGiveaway(req, res) {
  console.log('starting giveaway');
  currentGiveaway = {
    startTime: new Date(),
    endTime: null,
    elapsedTime: 7200000,
    paused: false,
  }

  sendSocketMessage('giveaway-info', currentGiveaway);
  res.json({success: true});
}


// =============================================================================


function pauseGiveaway(req, res) {
  console.log('pausing giveaway');
  currentGiveaway = {
    startTime: new Date(),
    endTime: null,
    elapsedTime: 7200000,
    paused: true,
  }

  sendSocketMessage('giveaway-info', currentGiveaway);
  res.json({success: true});
}


// =============================================================================


function unpauseGiveaway(req, res) {
  console.log('resuming giveaway');
  currentGiveaway = {
    startTime: new Date(),
    endTime: null,
    elapsedTime: 7200000,
    paused: false,
  }

  sendSocketMessage('giveaway-info', currentGiveaway);
  res.json({success: true});
}


// =============================================================================


function cancelGiveaway(req, res) {
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
async function resumeCurrentGiveaway(db, twitch) {
  // console.log('==================================');
  // console.log(new Date());
  // console.log(await db.getModel('giveaways').find({}));
  // console.log('==================================');

  // Order the giveaway entries by their start time and pluck the most recent
  // one started by this user from the list; if there is currently a giveaway
  // running, it would be this one.
  let entry = await db.getModel('giveaways').findOne({ userId: twitch.userInfo.id }, {
    order: ['startTime', 'desc'],
    limit: 1
  });

  // This giveaway could be the current giveaway, but for that to be the case
  // there has to be some amount of time remaining in the duration.
  if (entry === undefined || entry.elapsedTime >= entry.duration) {
    return;
  }

  console.log('A giveaway is in progress; pausing it');
  currentGiveaway = entry;
  currentGiveaway.paused = true;
  sendSocketMessage('giveaway-info', currentGiveaway);

  await db.getModel('giveaways').update({ id: currentGiveaway.id }, currentGiveaway);
}


// =============================================================================


/* This is invoked in response to the user logging out of the overlay; when
 * this happens we need to pause the current giveaway, make sure it's updated
 * in the database, and then reset back to our initial startup state. */
async function suspendCurrentGiveaway(db, twitch) {
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
  bridge.on('twitch-authorize', twitch => resumeCurrentGiveaway(db, twitch));
  bridge.on('twitch-deauthorize', twitch => suspendCurrentGiveaway(db, twitch));

  // Set up the routes that allow the controls in the main panel to manipulate
  // the current giveaway state.
  app.get('/giveaway/start', (req, res) => startGiveaway(req, res));
  app.get('/giveaway/pause', (req, res) => pauseGiveaway(req, res));
  app.get('/giveaway/unpause', (req, res) => unpauseGiveaway(req, res));
  app.get('/giveaway/cancel', (req, res) => cancelGiveaway(req, res));

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
