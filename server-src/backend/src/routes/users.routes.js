const express = require('express');
const router = express.Router();
const controller = require('../controllers/users.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/rbac.middleware');

router.use(authenticate, requireSuperAdmin);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/reset-password', controller.resetPassword);
router.post('/:id/deactivate', controller.deactivate);

module.exports = router;
