// =============================================================================


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


// =============================================================================


/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
async function initializeDatabase() {
  // Connect to our database file on disk; this will create the file
  // automagically if it doesn't already exist.
  const db = trilogy.connect('database.db');

  // Make sure that we register our models with the database so that it knows
  // how to perform queries.
  await Promise.all([
    db.model('tokens', TokenSchema),
  ]);

  return db;
}


// =============================================================================


module.exports = {
  initializeDatabase
}