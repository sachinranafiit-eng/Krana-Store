const E=require('../utils/ApiError');
const op=require('./operations');
const crypto=require('crypto');
const text=(r,k,max=255)=>{const v=String(r[k]??'').trim();if(v.length>max)throw E.badRequest(`${k} is too long (maximum ${max})`);return v;};
async function start(c,u,kind,rows,key){
 if(!key)return null;
 if(typeof key!=='string'||key.length>100)throw E.badRequest('Invalid import request key');
 const hash=crypto.createHash('sha256').update(JSON.stringify({kind,rows,store:u.store_id})).digest('hex');
 await c.query('INSERT INTO bulk_import_batches(request_key,user_id,kind,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,request_key) DO NOTHING',[key,u.id,kind,hash]);
 const b=(await c.query('SELECT * FROM bulk_import_batches WHERE request_key=$1 AND user_id=$2 FOR UPDATE',[key,u.id])).rows[0];
 if(b.payload_hash!==hash)throw E.conflict('This submission key was already used. Start a new import.');return b;
}
async function finish(c,b,result){if(b)await c.query('UPDATE bulk_import_batches SET result=$1 WHERE id=$2',[JSON.stringify(result),b.id]);return result;}
async function commit(c,u,kind,rows){
 // Serialize bulk party creation so duplicate checks stay valid across simultaneous imports.
 if(kind==='customers'||kind==='suppliers')await c.query(`LOCK TABLE ${kind} IN SHARE ROW EXCLUSIVE MODE`);
 for(let n=0;n<rows.length;n++)try{
 const r=rows[n];if(!r||typeof r!=='object')throw E.badRequest('Invalid row');
 if(kind==='stock'){
 const sku=text(r,'sku',50),qty=op.number(r.quantity,'quantity',-1e6,1e6),reason=text(r,'reason');
 if(!qty||Math.abs(qty*1000-Math.round(qty*1000))>1e-6||!reason)throw E.badRequest('Non-zero quantity (up to 3 decimals) and reason required');
 const p=(await c.query('SELECT id FROM products WHERE sku=$1 AND is_active=true FOR UPDATE',[sku])).rows[0];if(!p)throw E.badRequest('Unknown active SKU: '+sku);
 let batch=null;const bn=text(r,'batchNumber',50),expiry=text(r,'expiryDate',10);
 if(expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(Date.parse(expiry))||new Date(expiry).toISOString().slice(0,10)!==expiry))throw E.badRequest('Expiry must be a valid YYYY-MM-DD date');
 if(expiry&&!bn)throw E.badRequest('Batch number required with expiry date');
 if(bn){const matches=(await c.query('SELECT id,expiry_date::text FROM product_batches WHERE product_id=$1 AND batch_number=$2',[p.id,bn])).rows;if(matches.length>1)throw E.badRequest('Batch name is ambiguous; use the individual stock editor');if(matches[0]){batch=matches[0].id;if(expiry&&matches[0].expiry_date!==expiry)throw E.badRequest('Expiry differs from the existing batch');}else{if(qty<0)throw E.badRequest('Cannot remove from an unknown batch');batch=(await c.query('INSERT INTO product_batches(product_id,batch_number,expiry_date) VALUES($1,$2,$3) RETURNING id',[p.id,bn,expiry||null])).rows[0].id;}}
 await op.movement(c,u,p.id,qty,'adjustment','bulk_stock',crypto.randomUUID(),batch,u.store_id||1,reason);
 }else{
 const customer=kind==='customers',name=text(r,customer?'name':'companyName',150),mobile=text(r,'mobile',20),email=text(r,'email',150),address=text(r,'address',2000),gstin=text(r,'gstin',15).toUpperCase(),state=text(r,'stateCode',2);
 if(!name)throw E.badRequest('Name required');if(mobile&&!/^\+?[0-9]{7,15}$/.test(mobile))throw E.badRequest('Mobile must contain 7–15 digits, optionally starting with +');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw E.badRequest('Invalid email');if(gstin&&!/^[0-9A-Z]{15}$/.test(gstin))throw E.badRequest('GSTIN must have 15 letters/digits');if(state&&!/^\d{2}$/.test(state))throw E.badRequest('State code must have 2 digits');
 const column=customer?'name':'company_name';const duplicate=(await c.query(`SELECT id FROM ${kind} WHERE (NULLIF($1,'') IS NOT NULL AND mobile=$1) OR (lower(${column})=lower($2) AND lower(COALESCE(address,''))=lower($3)) LIMIT 1`,[mobile,name,address])).rows[0];if(duplicate)throw E.badRequest('Customer/supplier already exists (mobile or name/address)');
 const balance=op.number(r.openingBalance||0,'opening balance');
 if(customer)await c.query('INSERT INTO customers(name,mobile,email,address,gstin,state_code,credit_limit,opening_balance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[name,mobile||null,email||null,address||null,gstin||null,state||null,op.number(r.creditLimit||0,'credit limit'),balance]);
 else{const days=op.number(r.creditPeriodDays||0,'credit days',0,3650);if(!Number.isInteger(days))throw E.badRequest('Credit days must be a whole number');await c.query('INSERT INTO suppliers(company_name,contact_person,mobile,email,address,gstin,state_code,credit_period_days,opening_balance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[name,text(r,'contactPerson',100)||null,mobile||null,email||null,address||null,gstin||null,state||null,days,balance]);}
 }
 }catch(e){if(e.statusCode)e.message=`Row ${n+1}: ${e.message}`;throw e;}
 await op.audit(c,u,'imports.'+kind,kind,'bulk',{count:rows.length});return {count:rows.length,kind};
}
module.exports={start,finish,commit};
