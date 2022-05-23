// =============================================================================


const convict = require('convict');
const json5 = require('json5');
const path = require('path');

const { existsSync } = require('fs');

// Tell convict about json5 so that our configuration file can have comments in
// it without the parser taking a dump on our heads.
convict.addParser([
  { extension: 'json', parse: json5.parse }
]);

// The base directory of the project; this is the parent
const baseDir = path.resolve(__dirname, '../..');


// =============================================================================


/* This simple handler verifies that the value provided is non-null and throws
 * if it is. This is used to enforce configuration options that must exist in
 * combination with having their default values be null. */
const required = value => {
  if (value === null) {
    throw new Error('A configuration value for this key must be provided');
  }
};


// =============================================================================


/* This handler is an extension of the above and further verifies that the
 * value is exactly 32 characters long; this is required for the encryption
 * secret. */
const required_len_32 = value => {
  required(value);
  if (value.length !== 32) {
    throw new Error(`This value must be exactly 32 characters long (it is ${value.length}) currently`);
  }
}


// =============================================================================


/* This sets the configuration schema to be used for the overlay. */
const config = convict({
  // When we start up the configuration system, this value is populated with the
  // current base directory of the project, so that it can be accessed
  // throughout the system by anything that has access to the config.
  baseDir: {
    doc: 'The directory that represents the root of the project; set at runtime',
    format: '*',
    default: ''
  },

  // These configuration options relate to the interactions between the bot
  // and Twitch.
  twitch: {
    clientId: {
      doc: 'The Client ID of the application underpinning the overlay server',
      format: required,
      env: 'TWITCHLOYALTY_CLIENT_ID',
      default: null
    },
    clientSecret: {
      doc: 'The Twitch Client Secret for the application underpinning overlay server',
      format: required,
      default: null,
      env: 'TWITCHLOYALTY_CLIENT_SECRET',
      sensitive: true
    },
    callbackURL: {
      doc: 'The configured OAuth callback URL used during authentication of the overlay account',
      format: required,
      default: null,
      env: 'TWITCHLOYALTY_AUTH_CALLBACK'
    },
  },

  // These items relate to the encryption that we use when we store tokens in
  // the database so that they're safe from casual inspection.
  crypto: {
    secret: {
      doc: 'The encryption secret; this must be exactly 32 characters long',
      format: required_len_32,
      default: null,
      env: 'TWITCHLOYALTY_CRYPTO_SECRET',
      sensitive: true
    }
  },


  // These options relate to the configuration of the Twitch event system; in
  // this system we set up for listening for twitch to tell us when specific
  // things happen (such as a new follow or a subscription, etc).
  //
  // These are optional; if notificationUri or signingSecret are not
  // provided, then the server will not be started and no events will be
  // listened for.
  server: {
    webPort: {
      doc: 'The port that the internal web server should listen on',
      format: 'port',
      env: 'TWITCHLOYALTY_WEB_PORT',
      default: 3000
    },
    socketPort: {
      doc: 'The port that the internal websocket server should listen on',
      format: 'port',
      env: 'TWITCHLOYALTY_WEBSOCKET_PORT',
      default: 4000
    },
  },

  // The overlay allows you to set up a channel point redeem for which it will
  // send text to the chat as the authorized user; you could use this to cause
  // the overlay to invoke commands in other bots, for example.
  //
  // These configuration settings control what the reward ID value is and what
  // text to send out when they are redeemed.
  pointRedeem: {
    rewardId: {
      doc: 'The GUID of the channel point redeem to handle',
      format: '*',
      env: 'TWITCHLOYALTY_REWARD_ID',
      default: ''
    },
    chatText: {
      doc: 'The text to send to the chat whenever the channel point reward is redeemed',
      format: '*',
      env: 'TWITCHLOYALTY_REWARD_TEXT',
      default: 'this would work better if this was configured properly'
    }
  },

  // Configuration related to chat; this doesn't control how the overlay
  // connects to chat, but it does control in what circumstances automatic chat
  // responses will be made.
  chat: {
    presence: {
      doc: 'Announce when the bot enters and leaves the channel',
      format: Boolean,
      env: 'TWITCHLOYALTY_CHAT_ANNOUNCE',
      default: true
    },

    announceStart: {
      doc: 'Announce when a giveaway is started',
      format: Boolean,
      env: 'TWITCHLOYALTY_GIVEAWAY_START_ANNOUNCE',
      default: true
    },

    announcePause: {
      doc: 'Announce when a giveaway is paused or resumed',
      format: Boolean,
      env: 'TWITCHLOYALTY_GIVEAWAY_PAUSE_ANNOUNCE',
      default: true
    },

    announceEnd: {
      doc: 'Announce when a giveaway ends',
      format: Boolean,
      env: 'TWITCHLOYALTY_GIVEAWAY_END_ANNOUNCE',
      default: true
    },

    // If announcements are turned on, these represent the messages that will
    // be used to make the announcement.
    text: {
      botEnter: {
        doc: 'The text to send to the chat whenever the bot enters the chat',
        format: '*',
        env: 'TWITCHLOYALTY_CHAT_ANNOUNCE_ENTER',
        default: 'this would work better if this was configured properly'
      },

      botLeave: {
        doc: 'The text to send to the chat whenever the bot leaves the chat',
        format: '*',
        env: 'TWITCHLOYALTY_CHAT_ANNOUNCE_EXIT',
        default: 'this would work better if this was configured properly'
      },

      giveawayStart: {
        doc: 'The text to send to the chat whenever a giveaway starts',
        format: '*',
        env: 'TWITCHLOYALTY_GIVEAWAY_START_TEXT',
        default: 'this would work better if this was configured properly'
      },

      giveawayEnd: {
        doc: 'The text to send to the chat whenever a giveaway ends',
        format: '*',
        env: 'TWITCHLOYALTY_GIVEAWAY_END_TEXT',
        default: 'this would work better if this was configured properly'
      },

      giveawayPause: {
        doc: 'The text to send to the chat whenever a giveaway pauses',
        format: '*',
        env: 'TWITCHLOYALTY_GIVEAWAY_PAUSE_TEXT',
        default: 'this would work better if this was configured properly'
      },

      giveawayResume: {
        doc: 'The text to send to the chat whenever a giveaway resumes',
        format: '*',
        env: 'TWITCHLOYALTY_GIVEAWAY_UNPAUSE_TEXT',
        default: 'this would work better if this was configured properly'
      },
    }
  },

  // When displaying leaderboards in the overlay for the people that have gifted
  // subs and bits, this is the maximum number of people to display in the list,
  // after sorting them based on their contributions.
  leaderboard: {
    bitsLeadersCount: {
      doc: 'The number of gifters to show on the bit leaderboard',
      format: 'nat',
      env: 'TWITCHLOYALTY_LEADERBOARD_BITS',
      default: 3
    },
    subsLeadersCount: {
      doc: 'The number of gifters to show on the sub leaderboard',
      format: 'nat',
      env: 'TWITCHLOYALTY_LEADERBOARD_SUBS',
      default: 3
    }
  }
});


// =============================================================================


/* Load the configuration file into memory and verify that all of the fields are
 * valid. If so, return back the config object that allows code to determine
 * what it's configuration parameters are.
 *
 * This will raise an exception if the configuration file is missing, invalid
 * or has keys set to nonsensical values. */
function loadConfig() {
  // Set the base directory into the configuration object so that it can be
  // accessed everywhere.
  config.set('baseDir', baseDir);

  // If there is a configuration file present, then try to load it; otherwise,
  // the configuration will come solely from the environment and command line
  // arguments instead.
  const configFile = path.resolve(baseDir, 'giveaway_overlay.json');
  if (existsSync(configFile)) {
    config.loadFile(configFile);
  }

  // Validate that the configuration is correct; this will raise an exception
  // if there are any issues with the configuration file.
  config.validate();

  return config;
}


// =============================================================================


module.exports = {
    config: loadConfig()
}