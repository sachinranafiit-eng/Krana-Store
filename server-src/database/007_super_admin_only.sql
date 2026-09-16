-- Only the super_admin role can manage users, roles, settings, and audit logs.
-- Operational roles retain their existing day-to-day permissions.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE name <> 'super_admin')
  AND permission_id IN (
    SELECT id FROM permissions WHERE code IN ('users.manage', 'settings.manage')
  );

UPDATE roles
SET description = 'Store administration (owner-only security controls)'
WHERE name = 'admin';
