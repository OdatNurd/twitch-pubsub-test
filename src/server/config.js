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
    throw new Error('This value must be exactly 32 characters long');
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

  database: {
    filename: {
      doc: 'The name of the file that the database should be stored in',
      format: '*',
      env: 'TWITCHLOYALTY_DATABASE',
      default: 'database.db'
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