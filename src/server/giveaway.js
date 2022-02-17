// =============================================================================


/* The database record that represents the currently running giveaway, if any.
 *
 * At any given time there can be at most one giveaway running in the channel,
 * although all past giveaways are archived for data reasons. */
let currentGiveaway = undefined;


// =============================================================================


/* This sets up the giveaway handling for the overlay, which encompasses both
 * figuring out at startup if there is a current giveaway as well as sending out
 * messages regarding giveaway events as they occur. */
async function setupGiveawayHandler(db, bridge) {
  console.log('==================================');
  console.log(new Date());
  console.log(await db.getModel('giveaways').find({}));
  console.log('==================================');

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
  })

  // Order the giveaway entries by their start time and pluck the most recent
  // one from the list; if there is currently a giveaway running, it would be
  // this one.
  let entry = await db.getModel('giveaways').findOne({}, {
    order: ['startTime', 'desc'],
    limit: 1
  });

  // In order to know if this giveaway is still valid we need to know if there
  // is any of the duration left or not.
  if (entry !== undefined && entry.elapsedTime < entry.duration) {
    console.log('A giveaway is in progress; pausing it');
    currentGiveaway = entry;
    currentGiveaway.paused = true;
    console.log(currentGiveaway);
    await db.getModel('giveaways').update({ id: currentGiveaway.id }, currentGiveaway);
  }
}


// =============================================================================


module.exports = {
  setupGiveawayHandler,
}