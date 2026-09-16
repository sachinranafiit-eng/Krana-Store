const http=require('http');
// The old demo URL is a redirect only: it never opens or writes a second database.
module.exports=function startLegacyStoreLink(targetPort,host){
 if(process.env.NODE_ENV==='production'||targetPort!==4173||process.env.STORE_REDIRECT_PORT==='0')return null;
 const port=Number(process.env.STORE_REDIRECT_PORT||4174);if(port===targetPort)return null;
 const server=http.createServer((req,res)=>{res.writeHead(302,{Location:`http://127.0.0.1:${targetPort}/store`,'Cache-Control':'no-store'});res.end();});
 server.on('error',e=>console.warn('Legacy shop redirect unavailable:',e.code));server.listen(port,host);return server;
};
