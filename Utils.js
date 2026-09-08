const crypto = require("crypto");

function getAppSecretProof(accessToken) {
  const appSecret = process.env.APP_SECRET;
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

module.exports = { getAppSecretProof };