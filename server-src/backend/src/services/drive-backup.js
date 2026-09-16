const db=require('../config/db');
const {execFile}=require('child_process');
const {promisify}=require('util');
const run=promisify(execFile);
const ready=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN&&process.env.GOOGLE_DRIVE_FOLDER_ID);
let active=false;
async function createBackup(){
 if(db.embedded)return {bytes:await db.dump(),extension:'tar.gz',mime:'application/gzip'};
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required for PostgreSQL backup');
 const u=new URL(process.env.DATABASE_URL);
 const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGSSLMODE:u.searchParams.get('sslmode')||'prefer'};
 const {stdout}=await run('pg_dump',['--format=custom','--no-owner','--no-acl'],{env,encoding:'buffer',maxBuffer:256*1024*1024,timeout:180000});
 return {bytes:stdout,extension:'dump',mime:'application/octet-stream'};
}
async function upload(){
 if(!ready())throw Error('Add Google OAuth client ID, client secret, refresh token and backup folder ID to the server environment');
 if(active)throw Error('A Google Drive backup is already running');active=true;
 try{
 const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});const auth=await t.json();if(!t.ok||!auth.access_token)throw Error('Google authorization failed. Reconnect the server OAuth credentials.');
 const backup=await createBackup(),name='kirana-database-'+new Date().toISOString().replaceAll(':','-')+'.'+backup.extension;
 const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size',{method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json','X-Upload-Content-Type':backup.mime,'X-Upload-Content-Length':String(backup.bytes.length)},body:JSON.stringify({name,parents:[process.env.GOOGLE_DRIVE_FOLDER_ID]}),signal:AbortSignal.timeout(30000)});
 if(!init.ok)throw Error('Google Drive could not create the backup. Check folder access and available storage.');
 const location=init.headers.get('location');if(!location||new URL(location).protocol!=='https:'||!['www.googleapis.com','content.googleapis.com'].includes(new URL(location).hostname))throw Error('Invalid Google upload session');
 const response=await fetch(location,{method:'PUT',headers:{'Content-Type':backup.mime,'Content-Length':String(backup.bytes.length)},body:backup.bytes,signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Google Drive backup upload failed');const result=await response.json();
 return {id:result.id,name:result.name,url:result.webViewLink||null,size:backup.bytes.length,completedAt:new Date().toISOString()};
 }finally{active=false;}
}
module.exports={ready,upload,createBackup};
