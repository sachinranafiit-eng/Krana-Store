const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/roles', require('./roles.routes'));
router.use('/categories', require('./categories.routes'));
router.use('/brands', require('./brands.routes'));
router.use('/units', require('./units.routes'));
router.use('/products', require('./products.routes'));
router.use('/customers', require('./customers.routes'));
router.use('/suppliers', require('./suppliers.routes'));
router.use('/logs', require('./logs.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/storefront', require('./storefront.routes'));
router.use('/online-orders', require('./onlineOrders.routes'));

module.exports = router;
