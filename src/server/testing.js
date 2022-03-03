// =============================================================================


const { handlePubSubSubscription, handlePubSubBits } = require('./giveaway');


// =============================================================================


function setupEventTesting(app) {
  // This simple test route allows the test panel to generate a fake
  // subscription message so that we can more easily do testing.
  app.post('/test/subs', async (req, res) => {
    handlePubSubSubscription(req.body);
    res.json({success: true});
  });

  // This simple test route allows the test panel to generate a fake bits
  // message so that we can more easily do testing.
  app.post('/test/bits', async (req, res) => {
    handlePubSubBits(req.body);
    res.json({success: true});
  });
}


// =============================================================================


module.exports = {
    setupEventTesting,
}