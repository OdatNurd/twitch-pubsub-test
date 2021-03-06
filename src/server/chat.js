// =============================================================================


const { config } = require('./config');

const { ChatClient } = require('@twurple/chat');
const { CommandParser } = require('./cmd_parser.js');
const { drop_cmd, cut_cmd, abdicate_cmd } = require('./drop_commands.js');


// =============================================================================


/* When the chat system has been set up, these specify the chat client object
 * (which is a Twurple ChatClient instance) and the channel that the chat is
 * sending to (which is the name of the authorized user.
 *
 * Whenever we set up a chat client we need to listen for some events; if the
 * authorization is dropped, we have to leave the chat, and for that we need
 * to remove the listeners, and for that we need to track which ones we added;
 * that's what listeners is for. */
let chat = {
  client: undefined,
  channel: undefined,
  listeners: undefined,
};


/* A global command parser object that can parse any incoming chat message and
 * see if it's a command, and if so what properties it has. */
const cmdParser = new CommandParser();


/* This maps the list of commands that we know how to respond to in chat to the
 * handler functions that know how to invoke them. */
const cmd_map = {
  '!drop': drop_cmd,
  '!cut': cut_cmd,
  '!abdicate': abdicate_cmd,
};


// =============================================================================


/* This will do the work necessary to connect the back end system to the Twitch
 * channel of the currently authorized user. We set up a couple of simple event
 * listeners here to allow us to monitor the system. */
async function enterTwitchChat(twitch) {
  // If we've already set up Twitch chat or haven't set up Twitch access, we
  // can't proceed.
  if (chat.client !== undefined || twitch.authProvider === undefined) {
    return chat;
  }

  // Set up the name of the channel we're going to be sending to, which is the
  // username of the authorized user.
  chat.channel = twitch.userInfo.name;

  // Create a chat client using the global authorization provider.
  chat.client = new ChatClient({
    authProvider: twitch.authProvider,
    channels: [chat.channel],
    botLevel: "known",   // "none", "known" or "verified"

    // When this is true, the code assumes that the bot account is a mod and
    // uses a different rate limiter. If the bot is not ACTUALLY a mod and you
    // do this, you may end up getting it throttled, which is Not Good (tm).
    isAlwaysMod: true,
  })

  // Set up the listeners for chat events that we're interested in handling;
  // these are captured into a list so we can destroy them later.
  chat.listeners = [
    chat.client.onMessage((channel, user, message, rawMsg) => {
      console.log(`${channel}:<${user}> ${message}`);

      // Parse the message to see if it looks like it might be a command.
      const details = cmdParser.parse(message, channel, rawMsg);
      if (details.name === '') {
        return;
      }

      // console.log(details);
      const handler = cmd_map[details.name];
      if (handler === undefined) {
        console.log(`* ignoring unknown command '${details.name}`);
        return;
      }

      handler(details, rawMsg.userInfo)
    }),

    // Display a notification when the chat connects,.
    chat.client.onConnect(() => {
      console.log('Twitch chat connection established');
    }),

    // Display a notification when the chat disconnects.
    chat.client.onDisconnect((_manually, _reason) => {
      console.log('Twitch chat has been disconnected');
    }),

    // Handle a situation in which authentication of the bot failed; this would
    // happen if the bot user redacts our ability to talk to chat from within
    // Twitch without disconnecting in the app, for example.
    chat.client.onAuthenticationFailure(message => {
      console.log(`Twitch chat Authentication failed: ${message}`);
    }),

    // As a part of the connection mechanism, we also need to tell the server
    // what name we're known by. Once that happens, this event triggers.
    chat.client.onRegister(() => {
      console.log(`Registered with Twitch chat as ${chat.client.currentNick}`);
      if (config.get('chat.presence') === true) {
        chatSay(config.get("chat.text.botEnter"))
      }
    }),

    // Handle cases where sending messages fails due to being rate limited or
    // other reasons.
    chat.client.onMessageFailed((channel, reason) => console.log(`${channel}: message send failed: ${reason}`)),
    chat.client.onMessageRatelimit((channel, message) => console.log(`${channel}: rate limit hit; did not send: ${message}`)),
  ]

  // We're done, so indicate that we're connecting to twitch.
  console.log(`Connecting to Twitch chat and joining channel ${chat.channel}`);
  await chat.client.connect();
}


// =============================================================================


/* This will tear down (if it was set up) the Twitch chat functionality; once
 * this is called, it will no longer be possible to send messages to chat until
 * the chat connection is manually re-established. */
async function leaveTwitchChat() {
  // If we're not in the chat right now, we can leave without doing anything/
  if (chat.client === undefined || chat.listeners === undefined) {
    return;
  }

  if (config.get('chat.presence') === true) {
    await chatDo(config.get("chat.text.botLeave"));
  }


  // Actively leave the chat, and then remove all of of the listeners that are
  // associated with it so that we can remove the instance; otherwise they will
  // hold onto it's reference.
  chat.client.quit();
  for (const listener in chat.listeners) {
    chat.client.removeListener(listener);
  }

  // Clobber away the values that tell us that we're connected to the chat.
  chat.listeners = undefined;
  chat.client = undefined;
  chat.channel = undefined;
}


// =============================================================================


/* Transmit a normal chat message to the chat as the currently authorized user;
 * if there is no user currently authorized, then this will do nothing.
 *
 * The message can optionally be a reply to another message; to do that you need
 * to pass the ID of the message you're replying to so that Twitch can associate
 * the reply with the source message. */
async function chatSay(text, replyTo) {
  if (chat.client === undefined) {
    return;
  }

  console.log(`${chat.channel}:<${chat.channel}> ${text}`);
  return chat.client.say(chat.channel, text, {replyTo: replyTo});
}


// =============================================================================


/* Transmit an action message to the chat as the currently authorized user; if
 * there is no user currently authorized, then this will do nothing. */
async function chatDo(action) {
  if (chat.client === undefined) {
    return;
  }

  console.log(`${chat.channel}:*${chat.channel} ${action}`);
  return chat.client.action(chat.channel, action);
}


// =============================================================================


/* Transmit an announcement to the chat with the given text as the currently
 * authorized user; if there is no user currently authorized, then this will
 * do nothing. */
async function chatAnnounce(text) {
  if (chat.client === undefined) {
    return;
  }

  // For reasons that are currently mysterious and unknown, the announce  API
  // endpoint here doesn't actually do anything (including throwing an error).
  // The same thing does not happen in ObotNurd, which CAN make  announcements,
  // so I'm not sure what the deal is. For the time being,  this will use the
  // action command instead, which is more visible and distinct from normal chat
  // messages.
  console.log(`ANNOUNCE:*${chat.channel}* ${text}`);
  // return chat.client.announce(chat.channel, text);
  return chat.client.action(chat.channel, text);
}


// =============================================================================


/* This sets up our Twitch chat functionality by listening for events that are
 * broadcast from the Twitch subsystem over the provided event bridge, reacting
 * to a user being authorized or unauthorized by either entering or leaving
 * the chat, as appropriate. */
function setupTwitchChat(bridge) {
  bridge.on('twitch-authorize', twitch => enterTwitchChat(twitch));
  bridge.on('twitch-deauthorize', twitch => leaveTwitchChat(twitch));
}


// =============================================================================


module.exports = {
  setupTwitchChat,
  chatSay,
  chatDo,
  chatAnnounce
}