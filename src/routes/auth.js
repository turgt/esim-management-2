import {Router} from 'express';
import * as c from '../controllers/authController.js';

const r=Router();
r.get('/login',c.showLogin);
r.post('/login',c.login);
r.get('/logout',c.logout);

export default r;
