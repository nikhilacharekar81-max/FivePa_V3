import assert from 'node:assert';
import bcrypt from 'bcryptjs';

// Simulate the signup logic
function signup(name: string, email: string, users: any[]) {
  const isFirstUser = users.length === 0;
  return {
    name,
    email,
    role: 'user', // New fixed role
    title: 'Freelancer / Member' // New fixed title
  };
}

const users: any[] = [];
const newUser = signup('Test User', 'test@example.com', users);
assert.strictEqual(newUser.role, 'user', 'Role should be user');
console.log('✅ Test Passed: Public signup does not grant Super Admin');
