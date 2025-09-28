'use strict';
module.exports = {
  up: async function(q, S){
  await q.createTable('Users',{id:{allowNull:false,autoIncrement:true,primaryKey:true,type:S.INTEGER},
  username:{type:S.STRING,unique:true},passwordHash:S.STRING,isAdmin:{type:S.BOOLEAN,defaultValue:false},
  esimLimit:S.INTEGER,createdAt:{allowNull:false,type:S.DATE},updatedAt:{allowNull:false,type:S.DATE}});
}
export async function down(q,S){ await q.dropTable('Users'); }
,
  down: async function(q,S){ await q.dropTable('Users'); }

};
