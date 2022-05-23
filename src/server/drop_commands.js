// =============================================================================


const { sendSocketMessage } = require('./socket');


// =============================================================================


/* This command triggers the drop game running in the overlay, providing the
 * name of the user doing the drop, optionally also the ID of the emote that was
 * used.
 *
 * The overlay will use this to enable the game if it's not currently running,
 * generate a new dropper, and launch it. */
function drop_cmd(cmd, userInfo) {
  // Parse the raw message to get things like the emotes out.
  const rawParts = cmd.rawMsg.parseEmotes();

  // If there are at least two parts to the message and the second
  // one is an emote and it's name is the second word from the
  // message, then the emote to use is the ID of that emote.
  const emoteId = (rawParts.length >= 2 && rawParts[1].type === 'emote' && rawParts[1].name === cmd.words[0]) ? rawParts[1].id : undefined;

  console.log(`drop-game-drop { name: ${userInfo.displayName}, emoteId: ${emoteId} }`);
  sendSocketMessage('dropgame', 'drop-game-drop', {
    name: userInfo.displayName,
    emoteId
  });
}


// =============================================================================


/* This command sends a message to the dropper overlay asking it to cut the
 * chute of the active dropper for the user that invokes the command. */
function cut_cmd(cmd, userInfo) {
  console.log(`drop-game-cut { name: ${userInfo.displayName} }`);

  sendSocketMessage('dropgame', 'drop-game-cut', userInfo.displayName);
}


// =============================================================================


/* This command sends a message to the dropper overlay asking it to get rid of
 * the dropper for the named user, if it happens to be sitting on the target.
 * This allows such a user to do another drop, trying to better their score, at
 * the risk of scoring lower. */
function abdicate_cmd(cmd, userInfo) {
  console.log(`drop-game-abdicate { name: ${userInfo.displayName} }`);

  sendSocketMessage('dropgame', 'drop-game-abdicate', userInfo.displayName);
}


// =============================================================================


/* This is invoked with the information on the result of a drop, which could be
 * a land on the target, a miss, etc. */
function receive_drop_result(result, chatSay) {
  console.log(`Drop result: ${JSON.stringify(result, null, 2)}`);

  let resultMsg = '';

  // When someone is a winner, display a message in the chat that indicates
  // what their score is. This should only happen when someone actively gets
  // a higher score; landing on the target when there's someone there
  // already but their score is higher than yours should have no reaction
  // whatsoever.
  if (result.winner === true) {
    resultMsg = `${result.name} just scored a ${result.score.toFixed(2)} and took the lead`;
  } else {
    // In here, this is representing someone who's not on the target. For
    // our purposes here this only displays a message if the reason the
    // dropper left the target was a manual operation; it doesn't trigger
    // for people that hit the target but got a lower score.
    if (result.voluntary === true) {
      resultMsg = `${result.name} has graciously abdicated their position on the leaderboard.`;
    }
  }

  if (resultMsg !== '') {
    chatSay(resultMsg);
  }
}


// =============================================================================


/* This sets up our drop game functionality by listening for an incoming socket
 * connection from the drop overlay and connecting up the appropriate handler
 * to be able to do something with the result. */
function setupDropGame(bridge, chatSay) {
  bridge.on('socket-connect', connection => {
    if (connection.role === 'dropgame') {
      console.log('Setting up event listener for drop game results');
      connection.socket.on('drop-game-drop-result', data => receive_drop_result(data, chatSay));
    }
  });
}


// =============================================================================


module.exports = {
  drop_cmd,
  cut_cmd,
  abdicate_cmd,
  setupDropGame,
}