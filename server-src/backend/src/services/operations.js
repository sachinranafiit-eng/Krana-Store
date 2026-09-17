const D=require('decimal.js');
const {withTransaction,memory}=require('../config/db');
const E=require('../utils/ApiError');
const can=(u,p)=>u.role_name==='super_admin'||u.permissions.includes(p);
function number(x,name,min=0,max=1e9){if(x===null||x===''||!Number.isFinite(Number(x))||Number(x)<min||Number(x)>max)throw E.badRequest(`Invalid ${name}`);return Number(x);}
function money(x){return new D(x||0).toDecimalPlaces(2,D.ROUND_HALF_UP).toNumber();}
function line(qty,rate,gst,inclusive=true,discount=0){
 const q=number(qty,'quantity',.001,1e6);if(new D(q).decimalPlaces()>3)throw E.badRequest('Quantity supports up to 3 decimals');
 const r=number(rate,'rate');const g=number(gst,'GST rate',0,100);const d=number(discount,'discount',0,100);
 const amount=new D(q).mul(r).mul(new D(1).minus(new D(d).div(100)));
 const taxable=money(inclusive?amount.div(new D(1).plus(new D(g).div(100))):amount);
 const total=money(inclusive?amount:new D(taxable).mul(new D(1).plus(new D(g).div(100))));
 return {quantity:q,rate:r,gst_rate:g,discount_pct:d,taxable_amount:taxable,total_amount:total,tax:money(new D(total).minus(taxable))};
}
const sum=(a,k)=>money(a.reduce((s,x)=>s.plus(x[k]||0),new D(0)));
async function audit(c,u,action,type,id,details={}){await c.query('INSERT INTO user_activity_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',[u.id,action,type,String(id),JSON.stringify(details)]);await c.query('INSERT INTO audit_logs(user_id,table_name,record_id,operation,new_data) VALUES($1,$2,$3,$4,$5)',[u.id,type,String(id),'INSERT',JSON.stringify(details)]);}
async function context(c,u,date){const store=(await c.query('SELECT * FROM stores WHERE id=$1 AND is_active=true',[u.store_id||1])).rows[0];if(!store)throw E.badRequest('Active store required');const fy=(await c.query('SELECT id FROM financial_years WHERE $1::date BETWEEN start_date AND end_date AND is_closed=false',[date||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})])).rows[0];if(!fy)throw E.badRequest('No open financial year for this date');return {store,fy};}
async function movement(c,u,p,qty,type,ref,id,batch=null,store=u.store_id||1,notes=null){
 if(qty<0){
  const stockSql=memory
   ? (batch==null?'SELECT * FROM stock WHERE store_id=$1 AND product_id=$2 AND batch_id IS NULL FOR UPDATE':'SELECT * FROM stock WHERE store_id=$1 AND product_id=$2 AND batch_id=$3 FOR UPDATE')
   : 'SELECT * FROM stock WHERE store_id=$1 AND product_id=$2 AND batch_id IS NOT DISTINCT FROM $3 FOR UPDATE';
  const stock=(await c.query(stockSql,batch==null?[store,p]:[store,p,batch])).rows[0];
  if(!stock||Number(stock.current_qty)<-qty)throw E.conflict('Insufficient stock. Refresh the stock balance.');
 }
 await c.query('INSERT INTO stock_movements(store_id,product_id,batch_id,movement_type,qty_in,qty_out,reference_type,reference_id,created_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[store,p,batch,type,qty>0?qty:0,qty<0?-qty:0,ref,String(id),u.id,notes]);
 // PostgreSQL applies this balance through the stock_from_ledger trigger from
 // 003_operations.sql. The hosted pg-mem runtime intentionally skips that
 // PostgreSQL-only trigger, so keep its stock aggregate in sync explicitly.
 if(memory){
  const stockSql=batch==null?'SELECT id FROM stock WHERE store_id=$1 AND product_id=$2 AND batch_id IS NULL FOR UPDATE':'SELECT id FROM stock WHERE store_id=$1 AND product_id=$2 AND batch_id=$3 FOR UPDATE';
  const existing=(await c.query(stockSql,batch==null?[store,p]:[store,p,batch])).rows[0];
  if(existing) await c.query('UPDATE stock SET current_qty=current_qty+$1,updated_at=now() WHERE id=$2',[qty,existing.id]);
  else await c.query('INSERT INTO stock(store_id,product_id,batch_id,current_qty) VALUES($1,$2,$3,$4)',[store,p,batch,qty]);
 }
}
async function consume(c,u,p,quantity,type,ref,id){let left=quantity;const stockSql=memory
 ? 'SELECT s.*,b.expiry_date FROM stock s LEFT JOIN product_batches b ON b.id=s.batch_id WHERE s.store_id=$1 AND s.product_id=$2 AND s.current_qty>0 ORDER BY s.id'
 : 'SELECT s.*,b.expiry_date FROM stock s LEFT JOIN product_batches b ON b.id=s.batch_id WHERE s.store_id=$1 AND s.product_id=$2 AND s.current_qty>0 AND (b.expiry_date IS NULL OR b.expiry_date>=CURRENT_DATE) ORDER BY b.expiry_date ASC NULLS LAST,s.id FOR UPDATE OF s';
 const stocks=(await c.query(stockSql,[u.store_id||1,p])).rows; if(stocks.reduce((s,x)=>s+Number(x.current_qty),0)<left)throw E.conflict('Insufficient unexpired stock');const allocations=[];for(const s of stocks){const take=Math.min(left,Number(s.current_qty));if(take<=0)break;await movement(c,u,p,-take,type,ref,id,s.batch_id);allocations.push({batch:s.batch_id,quantity:take});left=Number(new D(left).minus(take));}return allocations;}
async function balance(c,type,id){
 const customer=type==='customer'; const party=(await c.query(`SELECT * FROM ${customer?'customers':'suppliers'} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!party)throw E.notFound('Party not found');
 const invoices=(await c.query(customer?"SELECT COALESCE(SUM(total_amount),0) v FROM sales WHERE customer_id=$1 AND status='completed' AND invoice_type NOT IN('quotation','estimate')":"SELECT COALESCE(SUM(total_amount),0) v FROM purchases WHERE supplier_id=$1",[id])).rows[0].v;
 const returns=(await c.query(customer?'SELECT COALESCE(SUM(r.amount),0) v FROM sales_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=$1':'SELECT COALESCE(SUM(r.amount),0) v FROM purchase_returns r JOIN purchases p ON p.id=r.purchase_id WHERE p.supplier_id=$1',[id])).rows[0].v;
 const paid=(await c.query('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE party_type=$1 AND party_id=$2',[type,id])).rows[0].v;
 return {party,outstanding:money(new D(party.opening_balance).plus(invoices).minus(returns).minus(paid))};
}
async function taxrow(c,type,id,item,inter,date){const cgst=inter?0:money(new D(item.tax).div(2)),sgst=inter?0:money(new D(item.tax).minus(cgst));await c.query('INSERT INTO gst_transactions(transaction_type,reference_id,hsn_code,taxable_amount,cgst_amount,sgst_amount,igst_amount,gst_rate,transaction_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date,CURRENT_DATE))',[type,id,item.hsn_code,item.taxable_amount,cgst,sgst,inter?item.tax:0,item.gst_rate,date]);return {cgst,sgst,igst:inter?item.tax:0};}
async function sale(u,b){return withTransaction(async c=>{
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>200)throw E.badRequest('Add 1–200 items');
 if(!b.requestKey||typeof b.requestKey!=='string'||b.requestKey.length>100)throw E.badRequest('Request key required');
 const old=(await c.query('SELECT * FROM sales WHERE request_key=$1',[b.requestKey])).rows[0];if(old)return old;
 const {store,fy}=await context(c,u); const mode=b.paymentMode||'cash';if(!['cash','upi','card','credit','bank','split'].includes(mode))throw E.badRequest('Invalid payment method');
 const customer=b.customerId?await balance(c,'customer',number(b.customerId,'customer ID',1)):null;
 if(mode==='credit'&&!customer)throw E.badRequest('Choose a customer for credit');
 const items=[];
 for(const i of [...b.items].sort((a,b)=>a.productId-b.productId)){const p=(await c.query('SELECT * FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[i.productId])).rows[0];if(!p)throw E.notFound('Product unavailable');if(i.discountPct>0&&!can(u,'sales.discount'))throw E.forbidden('Discount permission required');if(i.rate!==undefined&&Number(i.rate)!==Number(p.sale_price)&&!can(u,'pricing.change_selling_price'))throw E.forbidden('Price override permission required');const r=i.rate??p.sale_price;if(Number(r)>Number(p.mrp))throw E.badRequest(`${p.name}: selling price exceeds MRP`);items.push({...line(i.quantity,r,p.gst_rate,p.tax_inclusive,i.discountPct||0),product:p,hsn_code:p.hsn_code});}
 const total=sum(items,'total_amount');const quotation=b.invoiceType==='quotation';
 let payments=quotation?[]:b.payments||((mode==='credit')?[]:[{mode,amount:total}]);if(!Array.isArray(payments)||payments.length>4)throw E.badRequest('Invalid payments');let paid=0;for(const p of payments){if(!['cash','upi','card','bank'].includes(p.mode))throw E.badRequest('Invalid payment mode');paid=money(new D(paid).plus(number(p.amount,'payment amount',0)));}if(paid>total)throw E.badRequest('Payment exceeds invoice total');if(!quotation&&paid<total&&!customer)throw E.badRequest('Customer required for unpaid balance');if(!quotation&&customer&&total>paid&&customer.outstanding+total-paid>Number(customer.party.credit_limit))throw E.badRequest('Customer credit limit exceeded');
 const seq=(await c.query("SELECT nextval('invoice_seq') n")).rows[0].n;const prefix=(await c.query("SELECT value FROM settings WHERE key='invoice_prefix'")).rows[0]?.value||'INV';
 const result=(await c.query('INSERT INTO sales(store_id,financial_year_id,customer_id,invoice_number,invoice_type,subtotal,total_amount,payment_mode,cashier_id,request_key,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[store.id,fy.id,customer?.party.id,`${quotation?'QT':prefix}-${String(seq).padStart(6,'0')}`,quotation?'quotation':'gst',sum(items,'taxable_amount'),total,paid<total?'credit':mode,u.id,b.requestKey,b.notes])).rows[0];
 let cgst=0,sgst=0,igst=0;
 for(const i of items){const allocations=quotation?[{batch:null,quantity:i.quantity}]:await consume(c,u,i.product.id,i.quantity,'sale','sale',result.id);let allocatedTaxable=0,allocatedTotal=0;for(const [allocationIndex,a] of allocations.entries()){const proportion=new D(a.quantity).div(i.quantity);await c.query('INSERT INTO sale_items(sale_id,product_id,batch_id,quantity,rate,discount_pct,gst_rate,cost_price_snapshot,taxable_amount,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[result.id,i.product.id,a.batch,a.quantity,i.rate,i.discount_pct,i.gst_rate,i.product.cost_price,allocationIndex===allocations.length-1?money(i.taxable_amount-allocatedTaxable):money(new D(i.taxable_amount).mul(proportion)),allocationIndex===allocations.length-1?money(i.total_amount-allocatedTotal):money(new D(i.total_amount).mul(proportion))]);allocatedTaxable=money(allocatedTaxable+money(new D(i.taxable_amount).mul(proportion)));allocatedTotal=money(allocatedTotal+money(new D(i.total_amount).mul(proportion)));}if(!quotation){const t=await taxrow(c,'sale',result.id,i,!!(customer?.party.state_code&&customer.party.state_code!==store.state_code));cgst=money(cgst+t.cgst);sgst=money(sgst+t.sgst);igst=money(igst+t.igst);}}
 await c.query('UPDATE sales SET cgst_amount=$1,sgst_amount=$2,igst_amount=$3 WHERE id=$4',[cgst,sgst,igst,result.id]);
 for(const p of payments)await c.query('INSERT INTO sale_tenders(sale_id,mode,amount) VALUES($1,$2,$3)',[result.id,p.mode,p.amount]);
 if(customer)for(const p of payments)if(p.amount>0)await c.query("INSERT INTO payments(party_type,party_id,reference_type,reference_id,amount,mode,created_by,store_id) VALUES('customer',$1,'sale',$2,$3,$4,$5,$6)",[customer.party.id,result.id,p.amount,p.mode,u.id,store.id]);
 if(b.heldId)await c.query('DELETE FROM held_carts WHERE id=$1 AND store_id=$2',[b.heldId,store.id]);await audit(c,u,'sales.create','sales',result.id,{total,quotation});return {...result,cgst_amount:cgst,sgst_amount:sgst,igst_amount:igst};
 });}
async function purchase(u,b){return withTransaction(async c=>{
 if(!b.requestKey)throw E.badRequest('Request key required');const old=(await c.query('SELECT * FROM purchases WHERE request_key=$1',[b.requestKey])).rows[0];if(old)return old;
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>200)throw E.badRequest('Add 1–200 items');const {store,fy}=await context(c,u,b.purchaseDate);const supplier=await balance(c,'supplier',b.supplierId);const items=[];
 for(const i of [...b.items].sort((a,b)=>a.productId-b.productId)){const p=(await c.query('SELECT * FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[i.productId])).rows[0];if(!p)throw E.notFound('Product not found');items.push({...line(i.quantity,i.rate,i.gstRate??p.gst_rate,false,i.discountPct||0),hsn_code:p.hsn_code,product:p,free:number(i.freeQuantity||0,'free quantity'),batchNumber:i.batchNumber,expiryDate:i.expiryDate});}
 const total=sum(items,'total_amount');const paid=number(b.paidAmount||0,'paid amount',0,total);if(!['cash','upi','bank','card'].includes(b.paymentMode||'bank'))throw E.badRequest('Invalid payment method');const n=(await c.query("SELECT nextval('purchase_seq') n")).rows[0].n;
 const p=(await c.query('INSERT INTO purchases(store_id,financial_year_id,supplier_id,invoice_number,supplier_invoice_no,purchase_date,taxable_amount,total_amount,payment_status,created_by,request_key) VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7,$8,$9,$10,$11) RETURNING *',[store.id,fy.id,b.supplierId,`PUR-${String(n).padStart(6,'0')}`,b.supplierInvoiceNo,b.purchaseDate,sum(items,'taxable_amount'),total,paid===total?'paid':paid>0?'partial':'unpaid',u.id,b.requestKey])).rows[0];let cgst=0,sgst=0,igst=0;
 for(const i of items){let batch=null;if(i.batchNumber||i.expiryDate)batch=(await c.query('INSERT INTO product_batches(product_id,batch_number,expiry_date,cost_price) VALUES($1,$2,$3,$4) RETURNING id',[i.product.id,i.batchNumber,i.expiryDate||null,i.rate])).rows[0].id;const stock=(await c.query('SELECT COALESCE(SUM(current_qty),0) n FROM stock WHERE product_id=$1',[i.product.id])).rows[0].n;const qty=new D(i.quantity).plus(i.free);const avg=new D(stock).mul(i.product.cost_price).plus(i.taxable_amount).div(new D(stock).plus(qty));await c.query('UPDATE products SET cost_price=$1 WHERE id=$2',[money(avg),i.product.id]);await c.query('INSERT INTO purchase_items(purchase_id,product_id,batch_id,quantity,free_quantity,purchase_rate,discount_pct,gst_rate,taxable_amount,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,i.product.id,batch,i.quantity,i.free,i.rate,i.discount_pct,i.gst_rate,i.taxable_amount,i.total_amount]);await movement(c,u,i.product.id,qty.toNumber(),'purchase','purchase',p.id,batch);const t=await taxrow(c,'purchase',p.id,i,!!(supplier.party.state_code&&supplier.party.state_code!==store.state_code),b.purchaseDate);cgst=money(cgst+t.cgst);sgst=money(sgst+t.sgst);igst=money(igst+t.igst);}
 await c.query('UPDATE purchases SET cgst_amount=$1,sgst_amount=$2,igst_amount=$3 WHERE id=$4',[cgst,sgst,igst,p.id]);if(paid>0)await c.query("INSERT INTO payments(party_type,party_id,reference_type,reference_id,amount,mode,created_by,store_id) VALUES('supplier',$1,'purchase',$2,$3,$4,$5,$6)",[b.supplierId,p.id,paid,b.paymentMode||'bank',u.id,store.id]);if(b.purchaseOrderId)await c.query("UPDATE purchase_orders SET status='received' WHERE id=$1 AND store_id=$2",[b.purchaseOrderId,store.id]);await audit(c,u,'purchases.create','purchases',p.id,{total});return p;
 });}
module.exports={can,number,money,line,sum,audit,context,movement,consume,balance,taxrow,sale,purchase};
