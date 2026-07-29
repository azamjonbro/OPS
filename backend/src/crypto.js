const CryptoJS = require('crypto-js');

const SECRET_KEY = process.env.ENCRYPTION_SECRET || 'antigravity-super-secret-key-2026';

function encrypt(plainText) {
  if (!plainText) return '';
  return CryptoJS.AES.encrypt(plainText, SECRET_KEY).toString();
}

function decrypt(cipherText) {
  if (!cipherText) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return cipherText;
  }
}

function encryptJson(data) {
  return encrypt(JSON.stringify(data || {}));
}

function decryptJson(cipherText) {
  const jsonStr = decrypt(cipherText);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return {};
  }
}

module.exports = {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson
};
