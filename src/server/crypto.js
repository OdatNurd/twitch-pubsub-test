// =============================================================================


const crypto = require('crypto');


// =============================================================================


/* When we persist token information into the database, we first encrypt it to
 * ensure that casual inspection doesn't leak anything important. This sets the
 * algorithm that is used for the encryption. */
const algorithm = 'aes-256-ctr';


// =============================================================================


/* Given a piece of text, encrypt it. This will return an encrypted version of
 * the string suitable for passing to the decrypt endpoint. */
function encrypt(text) {
    // Create a new initialization vector for each encryption for extra
    // security; this makes the key harder to guess, but is required in order to
    // decrypt the data.
    const iv = crypto.randomBytes(16);

    // Do the encryption on the data, leaving it in an encrypted buffer.
    const cipher = crypto.createCipheriv(algorithm, process.env.TWITCHLOYALTY_CRYPTO_SECRET, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    // The returned value needs to contain the initialization vector used during
    // the operation as well as the data, so bundle it into an object.
    //
    // We then convert that into a string and encode it as base64 so that it's a
    // single string that's easier on the eyes and easier to store in the
    // database.
    return Buffer.from(JSON.stringify({
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    })).toString('base64');
}


// =============================================================================


/* Given a piece of encrypted text that was returned from the encrypt function,
 * decrypt it and return the original string. */
function decrypt(text) {
    // Decode the incoming text back into base64, and then decode it back into
    // an object that contains the encrypted data and the vector used to create
    // it.
    const hash = JSON.parse(Buffer.from(text, 'base64').toString('utf-8'));
    const iv = Buffer.from(hash.iv, 'hex');

    // Create the object that will do the decrypt using the data from the hash
    const decipher = crypto.createDecipheriv(algorithm, process.env.TWITCHLOYALTY_CRYPTO_SECRET, iv);
    const content = Buffer.from(hash.content, 'hex');

    // Return the decrypted data.
    return Buffer.concat([decipher.update(content), decipher.final()]).toString();
}


// =============================================================================


module.exports = {
  encrypt,
  decrypt,
}