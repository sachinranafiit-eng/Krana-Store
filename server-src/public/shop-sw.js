// Never cache customer details, API responses, stock, or orders.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&new URL(event.request.url).pathname==='/store')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Store offline</title><body style="font:18px system-ui;text-align:center;padding:50px;color:#19592e"><h1>You are offline</h1><p>Connect to the internet to view current stock and place your order.</p><a href="/store">Try again</a>',{headers:{'Content-Type':'text/html;charset=utf-8'}})));});
