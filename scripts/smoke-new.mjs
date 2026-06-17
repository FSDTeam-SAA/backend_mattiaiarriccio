// Temporary smoke test for the newly added endpoints. Safe to delete.
const BASE = 'http://localhost:5001/api/v1';
const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const req = async (path, { method = 'GET', token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const login = async (email, password, path = '/auth/login') => {
  const { json } = await req(path, { method: 'POST', body: { email, password } });
  const d = json?.data || {};
  return d.accessToken || d.token || d.session?.token;
};

(async () => {
  const adminToken = await login('admin@wesafe.app', 'Admin123!', '/auth/admin/login');
  log('admin login', !!adminToken, adminToken ? 'got token' : JSON.stringify('no token'));
  const userToken = await login('madiha.aroa@example.com', 'Password123!');
  log('user login', !!userToken);

  // --- Admin: ad-config ---
  let r = await req('/admin/settings/ad-config', { token: adminToken });
  log('admin GET ad-config', r.status === 200, `status ${r.status}`);
  r = await req('/admin/settings/ad-config', {
    method: 'PATCH', token: adminToken,
    body: { adsEnabled: true, adConfig: { format: 'banner+native', placements: ['home', 'checklists'], nativeFrequency: 4 },
            admUnitIds: { android: { banner: 'ca-app-pub-test/and-b', native: 'ca-app-pub-test/and-n' }, ios: { banner: 'ca-app-pub-test/ios-b', native: '' } } }
  });
  log('admin PATCH ad-config', r.status === 200, `status ${r.status}`);

  // --- Admin: coupon create + list ---
  r = await req('/admin/coupons', { method: 'POST', token: adminToken, body: { type: 'premium_grant', durationDays: 30, maxRedemptions: 100 } });
  const couponCode = r.json?.data?.code;
  log('admin create coupon (auto-code)', r.status === 200 && !!couponCode, `code=${couponCode} status ${r.status}`);
  r = await req('/admin/coupons?page=1&limit=10', { token: adminToken });
  log('admin list coupons', r.status === 200 && Array.isArray(r.json?.data), `count=${r.json?.data?.length}`);

  // --- Admin: users list ---
  r = await req('/admin/users?page=1&limit=10', { token: adminToken });
  const someUser = r.json?.data?.find((u) => u.role === 'user');
  log('admin list users', r.status === 200 && Array.isArray(r.json?.data), `count=${r.json?.data?.length}`);

  // --- Admin: emergency response create ---
  r = await req('/admin/emergency-responses', { method: 'POST', token: adminToken,
    body: { title: 'Kitchen Fire', category: 'fire', triggerKeywords: ['fire', 'smoke'], responseTemplate: 'Get out, stay low, call emergency services.', language: 'en', order: 1, active: true } });
  const emergencyId = r.json?.data?.id;
  log('admin create emergency-response', r.status === 201 || r.status === 200, `status ${r.status}`);

  // --- Admin: notifications + materials oversight ---
  r = await req('/admin/notifications?page=1&limit=5', { token: adminToken });
  log('admin list notifications', r.status === 200, `status ${r.status}`);
  r = await req('/admin/materials?page=1&limit=5', { token: adminToken });
  log('admin list materials', r.status === 200, `status ${r.status}`);

  // --- User: entitlements ---
  r = await req('/me/entitlements', { token: userToken });
  log('user GET entitlements', r.status === 200 && r.json?.data?.tier, `tier=${r.json?.data?.tier} adFree=${r.json?.data?.adFree} limits=${JSON.stringify(r.json?.data?.limits)}`);

  // --- User: ad-config ---
  r = await req('/ad-config?platform=android', { token: userToken });
  log('user GET ad-config', r.status === 200, `showAds=${r.json?.data?.showAds} format=${r.json?.data?.format}`);

  // --- User: device token register ---
  r = await req('/me/device-tokens', { method: 'POST', token: userToken, body: { token: 'smoke-fcm-token-1', platform: 'android' } });
  log('user register device token', r.status === 200, `status ${r.status}`);

  // --- User: redeem coupon -> should become premium ---
  if (couponCode) {
    r = await req('/coupons/redeem', { method: 'POST', token: userToken, body: { code: couponCode } });
    log('user redeem coupon', r.status === 200 && r.json?.data?.entitlement?.tier === 'premium', `tier=${r.json?.data?.entitlement?.tier} status ${r.status}`);
    // entitlements should now reflect premium + adFree
    r = await req('/me/entitlements', { token: userToken });
    log('entitlements premium after redeem', r.json?.data?.tier === 'premium' && r.json?.data?.adFree === true, `tier=${r.json?.data?.tier} adFree=${r.json?.data?.adFree}`);
    // ad-config should now hide ads for premium
    r = await req('/ad-config', { token: userToken });
    log('ad-config showAds=false for premium', r.json?.data?.showAds === false, `showAds=${r.json?.data?.showAds}`);
  }

  // --- User: materials create + list + mark-inspected ---
  r = await req('/materials', { method: 'POST', token: userToken,
    body: { name: 'Fire Extinguisher', category: 'safety', expirationDate: '2027-01-31', inspection: { intervalDays: 90 }, reminderRules: [{ offsetDays: 7, channel: 'local' }, { offsetDays: 1, channel: 'push' }] } });
  const materialId = r.json?.data?.id;
  log('user create material', (r.status === 201 || r.status === 200) && !!materialId, `id=${materialId} status ${r.status}`);
  r = await req('/materials', { token: userToken });
  log('user list materials', r.status === 200 && Array.isArray(r.json?.data), `count=${r.json?.data?.length}`);
  if (materialId) {
    r = await req(`/materials/${materialId}/mark-inspected`, { method: 'POST', token: userToken });
    log('user mark-inspected', r.status === 200, `nextInspectionAt=${r.json?.data?.inspection?.nextInspectionAt}`);
  }

  // --- User: emergency-responses list + chat override ---
  r = await req('/emergency-responses?language=en', { token: userToken });
  log('user list emergency-responses', r.status === 200 && Array.isArray(r.json?.data), `count=${r.json?.data?.length}`);
  r = await req('/chat/messages', { method: 'POST', token: userToken, body: { message: 'there is a fire in my kitchen' } });
  log('chat emergency override', (r.status === 200 || r.status === 201) && r.json?.data?.emergencyOverride === true, `override=${r.json?.data?.emergencyOverride} status ${r.status}`);

  // --- Admin: cleanup coupon + emergency (best-effort) ---
  if (emergencyId) await req(`/admin/emergency-responses/${emergencyId}`, { method: 'DELETE', token: adminToken });

  // --- Revoke premium so the seeded user is reset ---
  if (someUser) await req(`/admin/users/${someUser.id}/revoke-premium`, { method: 'POST', token: adminToken });

  const passed = results.filter((x) => x.ok).length;
  console.log(`\n==== ${passed}/${results.length} checks passed ====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('SMOKE_CRASH', e); process.exit(2); });
