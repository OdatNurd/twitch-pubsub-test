// =============================================================================


const { handleSubscription, handleBits } = require('./handler');


// =============================================================================


function setupEventTesting(app) {
  // This simple test route allows the test panel to generate a fake bits
  // message so that we can more easily do testing.
  app.post('/test/bits', async (req, res) => {
    handleBits(req.body);
    res.json({success: true});
  })

  // This simple test route allows the test panel to generate a fake
  // subscription message so that we can more easily do testing.
  app.post('/test/subs', async (req, res) => {
    handleSubscription(req.body);
    res.json({success: true});
  })
}


// =============================================================================


module.exports = {
    setupEventTesting,
}