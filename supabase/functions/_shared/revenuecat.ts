// PRO check on the server: the app's word is not enough to create a share. The RevenueCat app user id is the Supabase
// user id (the app logs in to RevenueCat with it, see app/src/account/account.ts).
//
// Secret: REVENUECAT_SECRET_KEY (a v1 secret key, sk_..., from the RevenueCat project).
//
// TEMP(field-test): PRO_CHECK=off makes every signed-in account count as PRO, so local test builds (the app's
// REPRIZE_FIELD_TEST_UNLOCK) can share without a purchase. Set it only on the development project (reprize-dev); the
// production project must never have it.
const PRO_ENTITLEMENT = 'pro';

export type ProCheck = 'pro' | 'free' | 'unavailable';

export async function proStatus(userId: string): Promise<ProCheck> {
  if (Deno.env.get('PRO_CHECK') === 'off') return 'pro';
  const key = Deno.env.get('REVENUECAT_SECRET_KEY') || '';
  if (key === '') return 'unavailable';
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    console.error('revenuecat', response.status);
    return 'unavailable';
  }
  const body = await response.json();
  const entitlements = (body.subscriber && body.subscriber.entitlements) || {};
  const pro = entitlements[PRO_ENTITLEMENT];
  if (pro === undefined || pro === null) return 'free';
  // null expiry: lifetime. Grace periods show as a later expiry, so the date alone decides.
  if (pro.expires_date === null) return 'pro';
  return Date.parse(pro.expires_date) > Date.now() ? 'pro' : 'free';
}
