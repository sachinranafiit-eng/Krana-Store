const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'",'https://checkout.razorpay.com']}}}));
app.use(cors({origin:process.env.CORS_ORIGIN||false}));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}

app.get('/health', (req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));

app.use('/api/v1/cloud',require('./routes/cloud.routes'));
app.use('/api/v1/setup', require('./routes/setup.routes'));
app.use('/api/v1/ops', require('./routes/operations.routes'));
app.use('/api/v1/imports', require('./routes/imports.routes'));
app.use('/api/v1/reports', require('./routes/reports.routes'));
app.use('/api/v1', routes);
const path=require('path');
app.use(express.static(path.resolve(__dirname,'../../dist')));
app.get(['/', '/store'],(req,res)=>res.sendFile(path.resolve(__dirname,'../../dist/index.html')));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
