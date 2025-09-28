import db from '../db/models/index.js';
import bcrypt from 'bcrypt';

export async function listUsers(req,res){
  const users=await db.User.findAll();
  res.render('users',{title:'Users',users});
}

export async function newUser(req,res){
  const {username,password,esimLimit}=req.body;
  const hash=await bcrypt.hash(password,10);
  await db.User.create({username,passwordHash:hash,esimLimit:esimLimit||null});
  res.redirect('/admin/users');
}
