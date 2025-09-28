import {Router} from 'express';
import * as c from '../controllers/adminController.js';
import {ensureAdmin} from '../middleware/auth.js';

const r=Router();
r.get('/users',ensureAdmin,c.listUsers);
r.post('/users/new',ensureAdmin,c.newUser);

export default r;
