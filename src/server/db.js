// =============================================================================


const { config } = require('./config');

const path = require('path');
const trilogy = require('trilogy');


// =============================================================================


/* The schema for storing incoming tokens in the database. This is based on the
 * AccessToken class that's available in Twurple, and the field names here
 * mirror the ones used there. */
const TokenSchema = {
  id: 'increments',

  accessToken: { type: String, nullable: false },
  refreshToken: { type: String, nullable: true },
  scopes: { type: Array, defaultsTo: [] },
  obtainmentTimestamp: { type: Number, defaultsTo: 0 },
  expiresIn: { type: Number, defaultsTo: 0, nullable: true },
};

/* The schema for tracking giveaways; each entry in the database represents a
 * specific giveaway, tracking when that giveaway started and when it ended. */
const GiveawaySchema = {
  id: 'increments',

  // The time at which the giveaway starts and when it eventually ended. Both of
  // these are stored as dates, which in the databas end up being represented as
  // ISO strings.
  //
  // The start time is populated right away when the giveaway starts, but the
  // end time is not populated until the giveaway has ended.
  startTime: { type: Date, nullable: false },
  endTime: { type: Date, nullable: true },

  // How long this giveaway is expected to run, in milliseconds. The indication
  // that the giveaway is running is that this is a larger number than the
  // elapsed time.
  duration: { type: Number, nullable: false},

  // The total accrued elapsed time of this giveaway; this is updated whenerver
  // the giveaway pauses and on an autosave interval, in case the task exits
  // unexpectedly while a giveaway is in progress.
  elapsedTime: { type: Number, defaultsTo: 0, nullable: false},

  // Is the current giveaway paused? This is set to yes if the giveaway is
  // paused while it's running, and it's also forced to be turned on if there's
  // a giveaway in progress when the application starts.
  paused: { type: Boolean, defaultsTo: false, nullable: false},
}


/* The schema for storing incoming data that is used in the overlay, which
 * includes bits that were thrown and subscriptions that were gifted. Channel
 * point redeems are not persisted because they're not interesting for the
 * overlay.
 *
 * This will only store bits that aren't anonymous and subscriptions that are
 * gifted; regular subscriptions or anonymous bits aren't eligible for prizes
 * in the giveaway.
 *
 * In all cases the tally for bits and subs from a specific user are incremented
 * as data arrives; for a string of gift subs this requires multiple operations
 * because Twitch delivers sub notifications one at a time. */
const GifterSchema = {
  id: 'increments',

  // The giveaway that this particular gifter is a member of; the same user can
  // be in several different giveaways, though only one giveaway can be running
  // at any given time.
  giveawayId: { type: Number, unique: true, nullable: false },

  // The identifier for the user that this record represents; the display and
  // user name can be looked up via this value; it never changes, unlike the
  // others.
  userId: { type: String, unique: true, nullable: false },

  // The number of bits and gift subscriptions that this user has given during
  // the current giveaway.
  bits: { type: Number, defaultsTo: 0, nullable: false },
  subs: { type: Number, defaultsTo: 0, nullable: false },
};


// =============================================================================


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function initializeDatabase() {
  // Get the configured database filename.
  const baseDir = config.get('baseDir');
  const dbFile = path.resolve(baseDir, config.get('database.filename'));

  // Connect to our database file on disk; this will create the file
  // automagically if it doesn't already exist.
  const db = trilogy.connect(dbFile);

  // Make sure that we register our models with the database so that it knows
  // how to perform queries.
  await Promise.all([
    db.model('tokens', TokenSchema),
    db.model('giveaways', GiveawaySchema),
    db.model('gifters', GifterSchema),
  ]);

  return db;
}


// =============================================================================


module.exports = {
  initializeDatabase
}