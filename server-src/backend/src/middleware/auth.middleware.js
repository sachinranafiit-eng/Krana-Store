const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { query } = require('../config/db');

/**
 * Verifies the JWT access token and attaches the authenticated user
 * (with role name + permission codes) to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing access token');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (e) {
      throw ApiError.unauthorized('Invalid or expired access token');
    }

    const { rows } = await query(
      `SELECT u.id, u.full_name, u.username, u.email, u.is_active,
              u.store_id, r.id AS role_id, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      throw ApiError.unauthorized('User not found or deactivated');
    }

    // super_admin bypasses granular permission checks entirely.
    let permissions = [];
    if (user.role_name !== 'super_admin') {
      const permResult = await query(
        `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1`,
        [user.role_id]
      );
      permissions = permResult.rows.map((r) => r.code);
    }

    const session = (await query('SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now()', [payload.sid, user.id])).rows[0];
    if (!session) throw ApiError.unauthorized('Session expired');
    req.user = { ...user, permissions, sessionId: payload.sid };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
