require('dotenv').config();
const express = require('express');
const pool = require('./config/database');

const app = express();
app.use(express.json());

app.get('/health', (req,res)=>res.json({status:'ok'}));

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/esims', require('./routes/esims'));
app.use('/admin', require('./routes/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Server running on port ${PORT}`));
