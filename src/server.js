import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import esimRoutes from './routes/esim.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(morgan('dev'));
app.use('/public',express.static(path.join(__dirname,'..','public')));

const PgSession = pgSession(session);
app.use(session({
  store:new PgSession({conString:process.env.DATABASE_URL, createTableIfMissing: true}),
  secret:process.env.SESSION_SECRET||'keyboardcat',
  resave:false,
  saveUninitialized:false
}));

app.use((req,res,next)=>{res.locals.user=req.session.user;next();});

app.use('/auth',authRoutes);
app.use('/admin',adminRoutes);
app.use('/',esimRoutes);

app.get('/',(req,res)=>res.redirect('/offers'));
app.get('/healthz',(req,res)=>res.send('ok'));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Server running on '+PORT));
