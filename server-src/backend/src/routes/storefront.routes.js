const express = require('express');
const router = express.Router();
const accounts=require('../controllers/customerAccounts.controller');
const controller = require('../controllers/storefront.controller');
const { authenticateCustomer } = require('../middleware/customerAuth.middleware');

router.use('/auth',require('express-rate-limit')({windowMs:15*60*1000,limit:15,standardHeaders:true,legacyHeaders:false}));
// --- Public: catalog browsing & OTP login (no auth) ---
router.get('/config', require('../controllers/shop.controller').config);
router.post('/quote',require('express-rate-limit')({windowMs:60000,limit:120}), require('../controllers/shop.controller').quote);
router.get('/products', controller.listCatalog);
router.get('/products/:id', controller.getCatalogItem);
router.post('/auth/register',accounts.register);
router.post('/auth/login',accounts.login);
router.post('/auth/request-otp', controller.requestOtp);
router.post('/auth/verify-otp', controller.verifyOtp);

// --- Customer-authenticated: cart & orders ---
router.use(authenticateCustomer);
router.get('/account',accounts.me);
router.post('/account/logout',accounts.logout);
router.post('/account/password',accounts.changePassword);
router.put('/cart', require('../controllers/shop.controller').replaceCart);
router.get('/cart', controller.getCart);
router.post('/cart/items', controller.addToCart);
router.put('/cart/items/:itemId', controller.updateCartItem);
router.delete('/cart/items/:itemId', controller.removeCartItem);
router.post('/payment/order', controller.createPaymentOrder);
router.post('/orders', controller.placeOrder);
router.get('/orders', controller.myOrders);
router.get('/orders/:id', controller.myOrderDetail);

module.exports = router;
