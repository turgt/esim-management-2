'use strict';
module.exports = {
  up: async function(q,S){
  await q.createTable('Esims',{id:{allowNull:false,autoIncrement:true,primaryKey:true,type:S.INTEGER},
  userId:{type:S.INTEGER,references:{model:'Users',key:'id'}},offerId:S.STRING,transactionId:S.STRING,status:S.STRING,
  createdAt:{allowNull:false,type:S.DATE},updatedAt:{allowNull:false,type:S.DATE}});
}
export async function down(q,S){ await q.dropTable('Esims'); }
,
  down: async function(q,S){ await q.dropTable('Esims'); }

};
