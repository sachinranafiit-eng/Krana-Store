const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const db=require('../config/db');
const ah=require('../utils/asyncHandler');
const E=require('../utils/ApiError');
const validPassword=p=>typeof p==='string'&&p.length>=10&&Buffer.byteLength(p,'utf8')<=72;
function username(value){if(typeof value!=='string')throw E.badRequest('Username is required');const v=value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(v))throw E.badRequest('Username needs 3–40 letters, numbers, dots, dashes or underscores');return v;}
async function session(c,account,customer){
 const sid=crypto.randomUUID();await c.query("DELETE FROM customer_sessions WHERE account_id=$1 AND expires_at<=now()",[account.id]);
 await c.query("INSERT INTO customer_sessions(id,account_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[sid,account.id]);
 const token=jwt.sign({sub:customer.id,type:'customer',auth:'password',aid:account.id,sid},process.env.CUSTOMER_JWT_SECRET,{expiresIn:'7d'});
 return {token,customer:{id:customer.id,name:customer.name,mobile:customer.mobile,username:account.username}};
}
exports.register=ah(async(req,res)=>{
 const b=req.body,u=username(b.username);
 if(!validPassword(b.password))throw E.badRequest('Use a password of at least 10 characters and at most 72 UTF-8 bytes');
 if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>150)throw E.badRequest('Your name is required (maximum 150 characters)');
 if(typeof b.mobile!=='string'||!/^\d{10}$/.test(b.mobile))throw E.badRequest('Enter a 10-digit contact mobile number');
 const hash=await bcrypt.hash(b.password,12);
 const result=await db.withTransaction(async c=>{
 // A phone number supplied without verification must never identify an existing customer.
 if (!db.memory) await c.query('LOCK TABLE customer_accounts IN SHARE ROW EXCLUSIVE MODE');
 if((await c.query('SELECT id FROM customer_accounts WHERE username=$1',[u])).rows.length)throw E.conflict('That username is already taken. Choose another username or sign in.');
 const customer=(await c.query('INSERT INTO customers(name,mobile,is_online_registered,online_last_login_at,opt_in_marketing) VALUES($1,$2,true,now(),false) RETURNING id,name,mobile',[b.name.trim(),b.mobile])).rows[0];
 const account=(await c.query('INSERT INTO customer_accounts(customer_id,username,password_hash) VALUES($1,$2,$3) RETURNING id,username',[customer.id,u,hash])).rows[0];
 return session(c,account,customer);
 });res.status(201).json({success:true,data:result});
});
exports.login=ah(async(req,res)=>{
 const u=username(req.body.username),password=req.body.password;
 if(typeof password!=='string'||Buffer.byteLength(password,'utf8')>72)throw E.unauthorized('Incorrect username or password');
 const result=await db.withTransaction(async c=>{
 const a=(await c.query('SELECT a.*,c.name,c.mobile,c.is_active FROM customer_accounts a JOIN customers c ON c.id=a.customer_id WHERE a.username=$1 FOR UPDATE OF a',[u])).rows[0];
 // Compare a valid dummy bcrypt hash for unknown accounts to avoid the fast unknown-user path.
 const hash=a?.password_hash||'$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
 const ok=await bcrypt.compare(password,hash);if(!a||!ok||!a.is_active)throw E.unauthorized('Incorrect username or password');
 await c.query('UPDATE customers SET online_last_login_at=now() WHERE id=$1',[a.customer_id]);
 return session(c,a,{id:a.customer_id,name:a.name,mobile:a.mobile});
 });res.json({success:true,data:result});
});
exports.me=ah(async(req,res)=>{const a=(await db.query('SELECT username FROM customer_accounts WHERE customer_id=$1',[req.customer.id])).rows[0];res.json({success:true,data:{name:req.customer.name,mobile:req.customer.mobile,username:a?.username||null,canChangePassword:req.customerAuth.auth==='password'}});});
exports.logout=ah(async(req,res)=>{if(req.customerAuth.auth==='password')await db.query('DELETE FROM customer_sessions WHERE id=$1 AND account_id=$2',[req.customerAuth.sid,req.customerAuth.aid]);res.json({success:true,data:{signedOut:true}});});
exports.changePassword=ah(async(req,res)=>{
 if(req.customerAuth.auth!=='password')throw E.forbidden('Sign in with your password to change it');
 const {currentPassword,newPassword}=req.body;if(typeof currentPassword!=='string'||Buffer.byteLength(currentPassword,'utf8')>72||!validPassword(newPassword))throw E.badRequest('Enter your current password and a new password of 10–72 bytes');
 await db.withTransaction(async c=>{const a=(await c.query('SELECT * FROM customer_accounts WHERE id=$1 AND customer_id=$2 FOR UPDATE',[req.customerAuth.aid,req.customer.id])).rows[0];if(!a||!await bcrypt.compare(currentPassword,a.password_hash))throw E.unauthorized('Current password is incorrect');await c.query('UPDATE customer_accounts SET password_hash=$1,password_changed_at=now() WHERE id=$2',[await bcrypt.hash(newPassword,12),a.id]);await c.query('DELETE FROM customer_sessions WHERE account_id=$1',[a.id]);});res.json({success:true,data:{changed:true}});
});
