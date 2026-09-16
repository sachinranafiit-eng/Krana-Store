const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { logAudit, logActivity } = require('../utils/audit');

const list = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.is_active,
            u.last_login_at, u.created_at, r.id AS role_id, r.name AS role_name,
            s.name AS store_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN stores s ON s.id = u.store_id
     ORDER BY u.created_at DESC`
  );
  res.json({ success: true, data: rows });
});

const getOne = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.is_active,
            u.store_id, r.id AS role_id, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw ApiError.notFound('User not found');
  res.json({ success: true, data: rows[0] });
});

const create = asyncHandler(async (req, res) => {
  const { fullName, username, email, phone, password, roleId, storeId } = req.body;
  if (!fullName || !username || !password || !roleId) {
    throw ApiError.badRequest('fullName, username, password and roleId are required');
  }
  if (password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');

  if (req.user.role_name !== 'super_admin' && (await query("SELECT name FROM roles WHERE id=$1", [roleId])).rows[0]?.name === 'super_admin') throw ApiError.forbidden('Only the owner can grant the owner role');
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (full_name, username, email, phone, password_hash, role_id, store_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, full_name, username, email, phone, role_id, store_id, is_active, created_at`,
    [fullName, username, email || null, phone || null, passwordHash, roleId, storeId || null]
  );
  const newUser = rows[0];

  await logAudit({ userId: req.user.id, tableName: 'users', recordId: newUser.id, operation: 'INSERT', newData: newUser });
  await logActivity({ userId: req.user.id, action: 'users.create', entityType: 'user', entityId: newUser.id });

  res.status(201).json({ success: true, data: newUser });
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fullName, email, phone, roleId, storeId, isActive } = req.body;

  if (req.user.role_name !== 'super_admin' && roleId && (await query('SELECT name FROM roles WHERE id=$1',[roleId])).rows[0]?.name === 'super_admin') throw ApiError.forbidden('Only the owner can grant the owner role');
  const existing = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing.rows[0]) throw ApiError.notFound('User not found');

  const { rows } = await query(
    `UPDATE users SET
       full_name = COALESCE($1, full_name),
       email = COALESCE($2, email),
       phone = COALESCE($3, phone),
       role_id = COALESCE($4, role_id),
       store_id = COALESCE($5, store_id),
       is_active = COALESCE($6, is_active)
     WHERE id = $7
     RETURNING id, full_name, username, email, phone, role_id, store_id, is_active`,
    [fullName, email, phone, roleId, storeId, isActive, id]
  );

  await logAudit({ userId: req.user.id, tableName: 'users', recordId: id, operation: 'UPDATE', oldData: { id: existing.rows[0].id, role_id: existing.rows[0].role_id, is_active: existing.rows[0].is_active }, newData: rows[0] });
  await logActivity({ userId: req.user.id, action: 'users.update', entityType: 'user', entityId: id });

  res.json({ success: true, data: rows[0] });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw ApiError.badRequest('newPassword (min 8 chars) is required');
  }
  const hash = await bcrypt.hash(newPassword, 12);
  const result = await query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id', [hash, id]);
  if (!result.rows[0]) throw ApiError.notFound('User not found');

  await query('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
  await logActivity({ userId: req.user.id, action: 'users.password_reset', entityType: 'user', entityId: id });
  res.json({ success: true, message: 'Password reset' });
});

const deactivate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(
    'UPDATE users SET is_active = false WHERE id = $1 RETURNING id, full_name',
    [id]
  );
  if (!result.rows[0]) throw ApiError.notFound('User not found');

  await logAudit({ userId: req.user.id, tableName: 'users', recordId: id, operation: 'UPDATE', newData: { is_active: false } });
  await logActivity({ userId: req.user.id, action: 'users.deactivate', entityType: 'user', entityId: id });

  res.json({ success: true, message: 'User deactivated' });
});

module.exports = { list, getOne, create, update, resetPassword, deactivate };
