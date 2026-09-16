const fs = require('fs');
const path = require('path');
require('dotenv').config({path:path.resolve(__dirname,'../../../.env')});
const root=path.resolve(__dirname,'../../..');
const embedded=process.env.DB_MODE!=='postgres';
let engine;
if(embedded){
 const {PGlite}=require('@electric-sql/pglite');
 const {pg_trgm}=require('@electric-sql/pglite/contrib/pg_trgm');
 engine=new PGlite(process.env.DATA_DIR||path.join(root,'data','db'),{extensions:{pg_trgm}});
}else{
 const {Pool}=require('pg');
 engine=new Pool({options:'-c timezone=Asia/Kolkata',connectionString:process.env.DATABASE_URL,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
}
const clean=p=>(p||[]).map(x=>x===undefined?null:x);
const wrap=c=>({exec:sql=>embedded?c.exec(sql):c.query(sql),query:(sql,params)=>c.query(sql,clean(params))});
async function query(sql,params){return engine.query(sql,clean(params));}
async function withTransaction(fn){
 if(embedded)return engine.transaction(c=>fn(wrap(c)));
 const c=await engine.connect();try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function exec(sql){return embedded?engine.exec(sql):engine.query(sql);}
async function init(){
 await query("SET TIME ZONE 'Asia/Kolkata'");
 const exists=(await query("SELECT to_regclass('public.users') AS t")).rows[0].t;
 if(!exists){for(const file of ['schema.sql','seed.sql','002_communications_and_store_schema.sql','002_communications_and_store_seed.sql'])await exec(fs.readFileSync(path.join(root,'database',file),'utf8'));}
 await exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
 for(const file of ['003_operations.sql','004_bulk.sql','005_customer_accounts.sql','006_online_payments_alerts.sql'])if(!(await query('SELECT name FROM app_migrations WHERE name=$1',[file])).rows.length){await withTransaction(async c=>{const sql=fs.readFileSync(path.join(root,'database',file),'utf8'); if(embedded){ // execute a multi-statement migration on the transaction connection
 await c.exec(sql);
 }else await c.query(sql);await c.query('INSERT INTO app_migrations(name) VALUES($1)',[file]);});}
}
async function close(){return embedded?engine.close():engine.end();}
async function dump(){if(!embedded)throw new Error('Use pg_dump for server PostgreSQL');return Buffer.from(await (await engine.dumpDataDir()).arrayBuffer());}
module.exports={query,withTransaction,init,close,dump,embedded,pool:{query,end:close},runSqlFile:async p=>{await exec(fs.readFileSync(path.resolve(__dirname,p),'utf8'));await close();}};
