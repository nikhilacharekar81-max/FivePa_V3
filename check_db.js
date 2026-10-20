import { postgresStore } from './server/db/postgresStore.js';
(async () => {
  const users = await postgresStore.listUsers();
  console.log('Users count:', users.length);
})();
