import {v4 as uuidv4} from 'uuid';
import db from '../db/models/index.js';
import {listOffers,purchaseEsim,getPurchase,getPurchaseQrCode} from '../services/zenditClient.js';

export async function offers(req,res){
  const offers=await listOffers({country:process.env.COUNTRY,_limit:100});
  res.render('offers',{title:'Offers',offers,country:process.env.COUNTRY});
}

export async function createPurchase(req,res){
  const userId=req.session.user.id;
  const user=await db.User.findByPk(userId,{include:db.Esim});
  if(user.esimLimit && user.Esims.length>=user.esimLimit){
    return res.send('Purchase limit reached');
  }
  const tx=uuidv4();
  await db.Esim.create({userId,offerId:req.body.offerId,transactionId:tx,status:'ACCEPTED'});
  await purchaseEsim({offerId:req.body.offerId,transactionId:tx});
  res.redirect('/purchases');
}

export async function listPurchases(req,res){
  const esims=await db.Esim.findAll({where:{userId:req.session.user.id}});
  res.render('purchases',{title:'Purchases',esims});
}

export async function purchaseStatus(req,res){
  const esim=await db.Esim.findByPk(req.params.id);
  const data=await getPurchase(esim.transactionId);
  res.render('status',{title:'Status',purchase:data,txId:esim.transactionId});
}

export async function purchaseQr(req,res){
  const esim=await db.Esim.findByPk(req.params.id);
  const data=await getPurchaseQrCode(esim.transactionId);
  const imgSrc=`data:image/png;base64,${data.imageBase64}`;
  res.render('qrcode',{title:'QR',txId:esim.transactionId,imgSrc});
}
