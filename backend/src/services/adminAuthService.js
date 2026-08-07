const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Separate from crypto.js's AES key on purpose — a signing secret and an encryption
// key are different concerns and shouldn't be the same value.
const JWT_SECRET = process.env.JWT_SECRET || 'jarvis-admin-jwt-secret-2026';
const TOKEN_TTL = '12h';

const SEED_USERNAME = process.env.ADMIN_SEED_USERNAME || 'BOS';
const SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'hadiya2020';

/** Runs once at boot — only creates the seed admin if no SUPERADMIN exists yet, so it never overwrites a password already changed in the DB. */
async function seedDefaultAdmin() {
  const exists = await User.findOne({ role: 'SUPERADMIN' });
  if (exists) return;

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  await User.create({ username: SEED_USERNAME, passwordHash, name: 'Super Admin', role: 'SUPERADMIN' });
  console.log(`🔐 Default admin seeded (username: ${SEED_USERNAME})`);
}

async function login(username, password) {
  if (!username || !password) {
    return { success: false, error: 'Login va parol kiritilishi shart' };
  }

  const user = await User.findOne({ username, role: 'SUPERADMIN' });
  // Same error for "no such user" and "wrong password" — never reveal which one it was.
  if (!user || !user.passwordHash) {
    return { success: false, error: "Login yoki parol noto'g'ri" };
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return { success: false, error: "Login yoki parol noto'g'ri" };
  }

  const token = jwt.sign(
    { sub: user._id.toString(), username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  return { success: true, token, username: user.username };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { seedDefaultAdmin, login, verifyToken };
