// =============================================================================


const { PrismaClient } = require('@prisma/client');

const ksuid = require('ksuid')


// =============================================================================


/* Create and return a unique ID value that can be tagged into objects to
 * identify them.
 *
 * The value is guaranteed to be unique for each call. */
function objId() {
  return ksuid.randomSync().string;
}


// =============================================================================


/* Set up our database access and return back an object that can be used to
/* Try to load an existing token from the database, and if we find one, use it
 * to set up the database. */
function initializeDatabase() {
  return new PrismaClient()
}


// =============================================================================


module.exports = {
  initializeDatabase,
  objId,
}
