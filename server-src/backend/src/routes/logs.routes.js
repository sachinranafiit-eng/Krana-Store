const express = require('express');
const router = express.Router();
const controller = require('../controllers/logs.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/rbac.middleware');

router.use(authenticate, requireSuperAdmin);

router.get('/activity', controller.activity);
router.get('/logins', controller.logins);

module.exports = router;
