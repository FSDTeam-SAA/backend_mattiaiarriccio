import 'dotenv/config';
import app from '../app.js';
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js';
import { seedDatabase } from '../services/seed.service.js';

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  await connectToDatabase();
  await seedDatabase();

  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'madiha.aroa@example.com',
        password: 'Password123!'
      })
    });
    const loginPayload = await loginResponse.json();
    assert(loginResponse.ok, 'User login failed');
    assert(loginPayload.data?.accessToken, 'User token missing');
    const userToken = loginPayload.data.accessToken;

    const homeResponse = await fetch(`${baseUrl}/api/v1/home`, {
      headers: {
        Authorization: `Bearer ${userToken}`
      }
    });
    const homePayload = await homeResponse.json();
    assert(homeResponse.ok, 'Home route failed');
    assert(Array.isArray(homePayload.data?.featuredGuides), 'Home payload missing guides');

    const checklistsResponse = await fetch(`${baseUrl}/api/v1/checklists`, {
      headers: {
        Authorization: `Bearer ${userToken}`
      }
    });
    const checklistPayload = await checklistsResponse.json();
    assert(checklistsResponse.ok, 'Checklist route failed');
    assert(Array.isArray(checklistPayload.data), 'Checklist payload missing items');

    const chatResponse = await fetch(`${baseUrl}/api/v1/chat/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        message: 'Give me one short earthquake safety tip.'
      })
    });
    const chatPayload = await chatResponse.json();
    assert(chatResponse.ok, 'Chat route failed');
    assert(chatPayload.data?.assistantMessage?.content, 'AI response missing');

    const adminLoginResponse = await fetch(`${baseUrl}/api/v1/auth/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@wesafe.app',
        password: 'Admin123!'
      })
    });
    const adminLoginPayload = await adminLoginResponse.json();
    assert(adminLoginResponse.ok, 'Admin login failed');
    const adminToken = adminLoginPayload.data.accessToken;

    const adminDashboardResponse = await fetch(`${baseUrl}/api/v1/admin/dashboard`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    const adminDashboardPayload = await adminDashboardResponse.json();
    assert(adminDashboardResponse.ok, 'Admin dashboard failed');
    assert(adminDashboardPayload.data?.summary?.totalUsers >= 1, 'Admin summary missing');

    console.log('Smoke test completed successfully');
  } finally {
    server.close();
    await disconnectFromDatabase();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
