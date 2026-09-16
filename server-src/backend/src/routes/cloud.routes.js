const router=require('express').Router(),ah=require('../utils/asyncHandler');const {authenticate}=require('../middleware/auth.middleware'),{requirePermission}=require('../middleware/rbac.middleware');const drive=require('../services/drive-backup'),db=require('../config/db');
router.use(authenticate,requirePermission('backups.manage'));
router.get('/status',ah(async(req,res)=>{const last=(await db.query("SELECT value FROM settings WHERE key='cloud_backup_last'")).rows[0]?.value||null;res.json({success:true,data:{configured:drive.ready(),last}});}));
router.post('/backup',require('express-rate-limit')({windowMs:60000,limit:2}),ah(async(req,res)=>{const result=await drive.upload();await db.query("INSERT INTO settings(key,value) VALUES('cloud_backup_last',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[JSON.stringify(result)]);res.json({success:true,data:result});}));
module.exports=router;
