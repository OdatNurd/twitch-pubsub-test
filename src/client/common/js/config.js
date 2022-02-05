// =============================================================================


/* Make a request to the back end to ask it for the configuration that we need
 * to proceed.
 *
 * The return value is the configuration object, which might be empty if there
 * was some error in fetching the configuration. */
async function getConfig() {
  try {
    const response = await window.fetch('/config', { method: 'get' });

    if (response.success !== false) {
      return response.json();
    }
  }
  catch(e) {
    console.log(`Unable to fetch config: ${e}`)
  }

  return { };
}


// =============================================================================


module.exports = getConfig;