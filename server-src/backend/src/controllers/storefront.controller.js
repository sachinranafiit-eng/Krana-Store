const jwt = require('jsonwebtoken');
const { query, withTransaction, memory } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const otpService = require('../services/otp.service');
const notificationService = require('../services/notification.service');
const paymentProvider = require('../providers/payment.provider');
const op = require('../services/operations');

async function getSetting(key, fallback = null) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

// ---------------------------------------------------------------------
// CATALOG (public, no auth)
// ---------------------------------------------------------------------
const listCatalog = asyncHandler(async (req, res) => {
  const storeEnabled = await getSetting('online_store_enabled', false);
  if (!storeEnabled) throw ApiError.notFound('Online store is currently unavailable');

  const { search, categoryId, page = 1, pageSize = 30 } = req.query;
  const conditions = ['p.is_online_visible = true', 'p.is_active = true'];
  const params = [];
  let idx = 1;
  if (search) { conditions.push(`p.name ILIKE $${idx}`); params.push(`%${search}%`); idx++; }
  if (categoryId) { conditions.push(`p.category_id = $${idx}`); params.push(categoryId); idx++; }

  const limit = Math.min(Number(pageSize) || 30, 100);
  const offset = (Math.max(Number(page), 1) - 1) * limit;
  params.push(limit, offset);

  const catalogSql = memory
    ? `SELECT p.id, p.name, p.local_name, p.online_description, p.online_images, p.image_url, p.sale_price,
            p.tax_inclusive, p.category_id, p.mrp, p.unit_id, u.short_code AS unit, p.gst_rate, c.name AS category_name,
            0 AS available_qty
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.name
     LIMIT $${idx} OFFSET $${idx + 1}`
    : `SELECT p.id, p.name, p.local_name, p.online_description,
            CASE WHEN p.online_images IS NULL OR p.online_images = '[]'::jsonb
                 THEN CASE WHEN p.image_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p.image_url) END
                 ELSE p.online_images END AS online_images, p.sale_price,
            p.tax_inclusive, p.category_id, p.mrp, p.unit_id, u.short_code AS unit, p.gst_rate, c.name AS category_name,
            COALESCE((SELECT SUM(s.current_qty) FROM stock s LEFT JOIN product_batches b ON b.id=s.batch_id WHERE (b.expiry_date IS NULL OR b.expiry_date>=CURRENT_DATE) AND s.product_id = p.id AND s.store_id=(SELECT id FROM stores WHERE is_active=true ORDER BY id LIMIT 1)), 0) AS available_qty
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.name
     LIMIT $${idx} OFFSET $${idx + 1}`;
  let { rows } = await query(catalogSql, params);
  if (memory && rows.length) {
    const ids = rows.map(r => r.id);
    const stocks = (await query('SELECT product_id,SUM(current_qty) AS available_qty FROM stock WHERE product_id IN (' + ids.map((_, i) => '$' + (i + 1)).join(',') + ') GROUP BY product_id', ids)).rows;
    const byId = Object.fromEntries(stocks.map(r => [r.product_id, r.available_qty]));
    rows = rows.map(r => ({ ...r, available_qty: byId[r.id] || 0, online_images: Array.isArray(r.online_images) && r.online_images.length ? r.online_images : (r.image_url ? [r.image_url] : []) }));
  }
  res.json({ success: true, data: rows, page: Number(page), pageSize: limit });
});

const getCatalogItem = asyncHandler(async (req, res) => {
 if(!await getSetting('online_store_enabled',false))throw ApiError.notFound('Online store is closed');
  const itemSql = memory
    ? `SELECT p.id, p.name, p.local_name, p.online_description, p.online_images, p.image_url, p.sale_price,
            p.tax_inclusive, p.category_id, p.mrp, p.unit_id, u.short_code AS unit, p.gst_rate,
            0 AS available_qty
     FROM products p LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = $1 AND p.is_online_visible = true AND p.is_active = true`
    : `SELECT p.id, p.name, p.local_name, p.online_description,
            CASE WHEN p.online_images IS NULL OR p.online_images = '[]'::jsonb
                 THEN CASE WHEN p.image_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p.image_url) END
                 ELSE p.online_images END AS online_images, p.sale_price,
            p.tax_inclusive, p.category_id, p.mrp, p.unit_id, u.short_code AS unit, p.gst_rate,
            COALESCE((SELECT SUM(s.current_qty) FROM stock s LEFT JOIN product_batches b ON b.id=s.batch_id WHERE (b.expiry_date IS NULL OR b.expiry_date>=CURRENT_DATE) AND s.product_id = p.id AND s.store_id=(SELECT id FROM stores WHERE is_active=true ORDER BY id LIMIT 1)), 0) AS available_qty
     FROM products p LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = $1 AND p.is_online_visible = true AND p.is_active = true`;
  let { rows } = await query(itemSql, [req.params.id]);
  if (memory && rows[0]) {
    const stock = (await query('SELECT COALESCE(SUM(current_qty),0) AS available_qty FROM stock WHERE product_id=$1',[req.params.id])).rows[0];
    rows[0] = { ...rows[0], available_qty: stock?.available_qty || 0, online_images: Array.isArray(rows[0].online_images) && rows[0].online_images.length ? rows[0].online_images : (rows[0].image_url ? [rows[0].image_url] : []) };
  }
  if (!rows[0]) throw ApiError.notFound('Product not found or not available online');
  res.json({ success: true, data: rows[0] });
});

// ---------------------------------------------------------------------
// AUTH (OTP-based — no separate password to manage)
// ---------------------------------------------------------------------
const requestOtp = asyncHandler(async (req, res) => {
  const { mobile } = req.body;
  const shopName = await getSetting('online_store_name', 'the store');
  const result = await otpService.requestOtp({ mobile, shopName });
  res.json({ success: true, message: 'OTP sent', data: result });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { mobile, otp, name } = req.body;
  await otpService.verifyOtp({ mobile, otp });

  // Find or create the customer record — same `customers` table used
  // by in-shop POS, so purchase history is unified across channels.
  // pg-mem (used by the hosted demo when DB_MODE=pgmem) cannot resolve the
  // correlated NOT EXISTS predicate against the table alias. Keep the
  // production query efficient, while using two simple queries for the demo
  // database so OTP login works there too.
  let customer;
  if (memory) {
    customer = (await query('SELECT * FROM customers WHERE mobile = $1 ORDER BY id LIMIT 1', [mobile])).rows[0];
    if (customer) {
      const account = (await query('SELECT id FROM customer_accounts WHERE customer_id = $1 LIMIT 1', [customer.id])).rows[0];
      if (account) customer = undefined;
    }
  } else {
    customer = (await query('SELECT c.* FROM customers c WHERE c.mobile = $1 AND NOT EXISTS (SELECT 1 FROM customer_accounts a WHERE a.customer_id=c.id) ORDER BY c.id LIMIT 1', [mobile])).rows[0];
  }
  if (!customer) {
    const created = await query(
      `INSERT INTO customers (name, mobile, is_online_registered, online_last_login_at)
       VALUES ($1,$2,true,now()) RETURNING *`,
      [name || `Customer ${mobile}`, mobile]
    );
    customer = created.rows[0];
  } else {
    await query(
      'UPDATE customers SET is_online_registered = true, online_last_login_at = now() WHERE id = $1',
      [customer.id]
    );
  }

  const token = jwt.sign({ sub: customer.id, type: 'customer' }, process.env.CUSTOMER_JWT_SECRET, {
    expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '30d',
  });

  res.json({ success: true, data: { token, customer: { id: customer.id, name: customer.name, mobile: customer.mobile } } });
});

// ---------------------------------------------------------------------
// CART (requires customer auth)
// ---------------------------------------------------------------------
const getCart = asyncHandler(async (req, res) => {
  const cart = await ensureCart(req.customer.id);
  const items = (await query(
    `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.sale_price, p.gst_rate, p.tax_inclusive, p.mrp, u.short_code AS unit,
            (ci.quantity * p.sale_price) AS line_total
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE ci.cart_id = $1 ORDER BY ci.added_at`,
    [cart.id]
  )).rows;
  for(const i of items)i.line_total=require('../services/operations').line(i.quantity,i.sale_price,i.gst_rate,i.tax_inclusive).total_amount;
 const subtotal = require('../services/operations').sum(items,'line_total');
  res.json({ success: true, data: { cartId: cart.id, items, subtotal } });
});

async function ensureCart(customerId) {
  return getOrCreateCart({ query }, customerId);
}

// Some older hosted databases have the carts table without the UNIQUE
// constraint used by ON CONFLICT(customer_id). Avoid relying on that
// constraint so checkout works across upgraded databases as well.
async function getOrCreateCart(client, customerId) {
  const existing = await client.query('SELECT * FROM carts WHERE customer_id = $1', [customerId]);
  if (existing.rows[0]) return existing.rows[0];
  try {
    const created = await client.query('INSERT INTO carts (customer_id) VALUES ($1) RETURNING *', [customerId]);
    return created.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const retry = await client.query('SELECT * FROM carts WHERE customer_id = $1', [customerId]);
      if (retry.rows[0]) return retry.rows[0];
    }
    throw err;
  }
}

const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  require('../services/operations').number(quantity,'quantity',0.001,1000000);
  if (!productId || !quantity || Number(quantity) <= 0) {
    throw ApiError.badRequest('productId and a positive quantity are required');
  }
  const product = (await query(
    'SELECT id FROM products WHERE id = $1 AND is_online_visible = true AND is_active = true', [productId]
  )).rows[0];
  if (!product) throw ApiError.notFound('Product not available online');

  const cart = await ensureCart(req.customer.id);
  await query(
    `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1,$2,$3)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
    [cart.id, productId, quantity]
  );
  res.status(201).json({ success: true, message: 'Added to cart' });
});

const updateCartItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;
  require('../services/operations').number(quantity,'quantity',0,1000000);
  const cart = await ensureCart(req.customer.id);

  if (Number(quantity) <= 0) {
    await query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [itemId, cart.id]);
    return res.json({ success: true, message: 'Item removed' });
  }
  const result = await query(
    'UPDATE cart_items SET quantity = $1 WHERE id = $2 AND cart_id = $3 RETURNING *',
    [quantity, itemId, cart.id]
  );
  if (!result.rows[0]) throw ApiError.notFound('Cart item not found');
  res.json({ success: true, data: result.rows[0] });
});

const removeCartItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const cart = await ensureCart(req.customer.id);
  await query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [itemId, cart.id]);
  res.json({ success: true, message: 'Item removed' });
});

// ---------------------------------------------------------------------
// CHECKOUT — transactional: validates stock, deducts it immediately
// (via the same stock_movements ledger used by POS), creates the order,
// empties the cart, and sends a WhatsApp/SMS confirmation.
// ---------------------------------------------------------------------
const placeOrder = asyncHandler(async(req,res)=>{
  const b=req.body;
  if(!await getSetting('online_store_enabled',false))throw ApiError.badRequest('Online store is closed');
  if(!['pickup','delivery'].includes(b.deliveryType)||!['cod','online'].includes(b.paymentMode))throw ApiError.badRequest('Select pickup/delivery and a valid payment method');
  if(b.paymentMode==='online'&&!paymentProvider.verifySignature({orderId:b.gatewayOrderId,paymentId:b.paymentReference,signature:b.gatewaySignature}))throw ApiError.badRequest('Online payment could not be verified');
  if(b.deliveryType==='delivery'){
 const a=b.deliveryAddress||{};if(typeof a.line1!=='string'||!a.line1.trim()||a.line1.length>500||typeof a.city!=='string'||!a.city.trim()||a.city.length>100||!/^\d{6}$/.test(a.pincode||''))throw ApiError.badRequest('Address, city and 6-digit pincode required');
 const cfg=await require('./shop.controller').configData();if(cfg.pincodes.length&&!cfg.pincodes.includes(a.pincode))throw ApiError.badRequest('Delivery is not available to this pincode. Choose store pickup.');
 }
  const charge=b.deliveryType==='delivery'?Number(await getSetting('online_store_delivery_charge',0)):0;
  const min=Number(await getSetting('online_store_min_order_amount',0));
  const order=await withTransaction(async c=>{
    const cart=(await c.query('SELECT * FROM carts WHERE customer_id=$1 FOR UPDATE',[req.customer.id])).rows[0];if(!cart)throw ApiError.badRequest('Cart is empty');
    const items=(await c.query('SELECT ci.*,p.name,p.sale_price,p.gst_rate,p.tax_inclusive,p.is_active,p.is_online_visible FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=$1 ORDER BY p.id',[cart.id])).rows;
    if(!items.length)throw ApiError.badRequest('Cart is empty');const lines=items.map(i=>{if(!i.is_active||!i.is_online_visible)throw ApiError.badRequest('An item is no longer available');return {...i,...op.line(i.quantity,i.sale_price,i.gst_rate,i.tax_inclusive)};});
    const total=op.money(op.sum(lines,'total_amount')+charge);if(op.sum(lines,'total_amount')<min)throw ApiError.badRequest('Minimum order is Rs.'+min);
    const store=(await c.query('SELECT id FROM stores WHERE is_active=true ORDER BY id LIMIT 1')).rows[0];if(!store)throw ApiError.badRequest('Store unavailable');
    const r=(await c.query('INSERT INTO online_orders(order_number,store_id,customer_id,delivery_type,delivery_address,payment_mode,payment_status,subtotal,gst_amount,delivery_charge,total_amount,customer_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',['ONL-'+require('crypto').randomUUID().slice(0,12),store.id,req.customer.id,b.deliveryType,b.deliveryAddress?JSON.stringify(b.deliveryAddress):JSON.stringify({}),b.paymentMode,b.paymentMode==='online'?'paid':'pending',op.sum(lines,'taxable_amount'),op.sum(lines,'tax'),charge,total,b.notes])).rows[0];
    for(const i of lines){await op.consume(c,{id:null,store_id:store.id},i.product_id,Number(i.quantity),'sale','online_order',r.id);await c.query('INSERT INTO online_order_items(order_id,product_id,quantity,rate,gst_rate,taxable_amount,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,i.product_id,i.quantity,i.rate,i.gst_rate,i.taxable_amount,i.total_amount]);}
    await c.query("INSERT INTO order_status_history(order_id,status,notes) VALUES($1,'pending','Order placed')",[r.id]);await c.query('DELETE FROM cart_items WHERE cart_id=$1',[cart.id]);return r;
  });
  try { await query('INSERT INTO store_alerts(store_id,alert_type,title,message,payload) VALUES($1,$2,$3,$4,$5)',[order.store_id,'new_online_order','New online order',`${order.order_number} · Rs.${order.total_amount} · ${req.customer.name}`,JSON.stringify({orderId:order.id,orderNumber:order.order_number,total:order.total_amount})]); } catch (err) { console.error('Online order alert unavailable:', err.message); }
  const variables={name:req.customer.name,orderNumber:order.order_number,amount:Number(order.total_amount).toFixed(2),deliveryType:order.delivery_type,paymentMode:order.payment_mode,trackingUrl:''};
  notificationService.sendTemplatedMessage({channel:'both',to:req.customer.mobile,templateCode:'order_confirmed',variables,partyType:'customer',partyId:req.customer.id}).catch(()=>{});
  query('SELECT id,phone FROM users WHERE store_id=$1 AND is_active=true AND phone IS NOT NULL',[order.store_id]).then(({rows})=>Promise.all(rows.map(u=>notificationService.sendTemplatedMessage({channel:'both',to:u.phone,templateCode:'new_online_order',variables:{orderNumber:order.order_number,amount:Number(order.total_amount).toFixed(2),name:req.customer.name,paymentMode:order.payment_mode},partyType:'user',partyId:u.id})))).catch(()=>{});
  res.status(201).json({success:true,data:order});
});

const createPaymentOrder = asyncHandler(async (req, res) => {
  if (!paymentProvider.configured()) throw ApiError.badRequest('Online payments are not configured. Add Razorpay keys in the server environment.');
  const b=req.body;
  if (!['pickup','delivery'].includes(b.deliveryType)) throw ApiError.badRequest('Select pickup or delivery');
  const cart=(await query('SELECT * FROM carts WHERE customer_id=$1',[req.customer.id])).rows[0];
  if(!cart)throw ApiError.badRequest('Cart is empty');
  const items=(await query('SELECT ci.quantity,p.sale_price,p.gst_rate,p.tax_inclusive,p.is_active,p.is_online_visible FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=$1',[cart.id])).rows;
  if(!items.length)throw ApiError.badRequest('Cart is empty');
  const lines=items.map(i=>{if(!i.is_active||!i.is_online_visible)throw ApiError.badRequest('An item is no longer available');return op.line(i.quantity,i.sale_price,i.gst_rate,i.tax_inclusive);});
  const subtotal=op.sum(lines,'total_amount'),charge=b.deliveryType==='delivery'?Number(await getSetting('online_store_delivery_charge',0)):0,total=op.money(subtotal+charge),minimum=Number(await getSetting('online_store_min_order_amount',0));
  if(subtotal<minimum)throw ApiError.badRequest('Minimum order is Rs.'+minimum);
  const gatewayOrder=await paymentProvider.createOrder({amount:total,receipt:'cart-'+req.customer.id+'-'+Date.now()});
  res.json({success:true,data:{gateway:'razorpay',keyId:process.env.RAZORPAY_KEY_ID,orderId:gatewayOrder.id,amount:gatewayOrder.amount,currency:gatewayOrder.currency,total}});
});

const myOrders = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM online_orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [req.customer.id]
  );
  res.json({ success: true, data: rows });
});

const myOrderDetail = asyncHandler(async (req, res) => {
  const order = (await query(
    'SELECT * FROM online_orders WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id]
  )).rows[0];
  if (!order) throw ApiError.notFound('Order not found');
  const items = (await query(
    `SELECT oi.*, p.name FROM online_order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`,
    [order.id]
  )).rows;
  const history = (await query(
    'SELECT status, notes, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at', [order.id]
  )).rows;
  res.json({ success: true, data: { ...order, items, history } });
});

module.exports = {
  listCatalog, getCatalogItem, requestOtp, verifyOtp,
  getCart, addToCart, updateCartItem, removeCartItem,
  placeOrder, createPaymentOrder, myOrders, myOrderDetail,
};
