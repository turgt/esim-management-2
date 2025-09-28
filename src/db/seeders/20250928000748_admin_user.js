'use strict';
module.exports = {
  up: async function(q,S){
  const hash=await bcrypt.hash('admin123',10);
  await q.bulkInsert('Users',[{username:'admin',passwordHash:hash,isAdmin:true,createdAt:new Date(),updatedAt:new Date()}]);
}
export async function down(q,S){ await q.bulkDelete('Users',{username:'admin'}); }
,
  down: async function(q,S){ await q.bulkDelete('Users',{username:'admin'}); }

};
