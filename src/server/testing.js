// =============================================================================


const { handlePubSubSubscription, handlePubSubBits } = require('./giveaway');


// =============================================================================


// super hack; this doesn't take care to un-route things when the user deauths,
// if they ever do
function setupEventTesting(db, app, bridge) {
  bridge.on('twitch-authorize', twitch => {
    // This simple test route allows the test panel to generate a fake
    // subscription message so that we can more easily do testing.
    app.post('/test/subs', async (req, res) => {
      handlePubSubSubscription(db, twitch, req.body);
      res.json({success: true});
    });

    // This simple test route allows the test panel to generate a fake bits
    // message so that we can more easily do testing.
    app.post('/test/bits', async (req, res) => {
      handlePubSubBits(db, twitch, req.body);
      res.json({success: true});
    });
  });

}


// =============================================================================


module.exports = {
    setupEventTesting,
}