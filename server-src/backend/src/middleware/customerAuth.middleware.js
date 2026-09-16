const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { query } = require('../config/db');

async function authenticateCustomer(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Please log in to continue');

    let payload;
    try {
      payload = jwt.verify(token, process.env.CUSTOMER_JWT_SECRET);
    } catch (e) {
      throw ApiError.unauthorized('Session expired — please log in again');
    }
    if (payload.type !== 'customer') throw ApiError.unauthorized('Invalid session');

    if(payload.auth==='password'){
      if(!payload.sid||!payload.aid)throw ApiError.unauthorized('Invalid customer session');
      const session=(await query('SELECT s.id FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.id=$1 AND s.account_id=$2 AND a.customer_id=$3 AND s.expires_at>now()',[payload.sid,payload.aid,payload.sub])).rows[0];
      if(!session)throw ApiError.unauthorized('Session expired — please sign in again');
    }
    req.customerAuth=payload;
    const { rows } = await query('SELECT * FROM customers WHERE id = $1 AND is_active = true', [payload.sub]);
    if (!rows[0]) throw ApiError.unauthorized('Account not found or deactivated');

    req.customer = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticateCustomer };
