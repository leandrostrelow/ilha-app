// Local presentation fixture only. Never bypass production CAPTCHA or payments.
if (typeof window !== 'undefined' && location.hostname === '127.0.0.1') {
  const originalFetch = window.fetch.bind(window);
  window.turnstile = { render: (_selector, options) => { queueMicrotask(() => options.callback('LOCAL-FIXTURE-NOT-A-REAL-CAPTCHA')); return 1; }, reset: () => {} };
  window.fetch = async (url, options = {}) => {
    if (String(url).includes('/rpc/tournament_public_snapshot')) return originalFetch('/test/fixtures/pickleball-snapshot.json');
    if (String(url).includes('/functions/v1/tournament-register')) {
      if (!options.body) return Response.json({ captcha_site_key: 'LOCAL-FIXTURE' });
      const payload = JSON.parse(options.body);
      if (payload.action === 'package_checkout') {
        window.__lastPackagePayload = payload;
        const amount=payload.athletes.reduce((sum,p)=>sum+[0,50,80,90,100][payload.entries.filter((e)=>e.members.includes(p.key)).length],0);
        window.__mockPayment = { family_checkout: true, tracking_token: 'local-only-test', registration_group: {total_amount:amount},
          registrations: payload.entries.map((entry) => ({category_id:entry.category_id,public_name:entry.members.map((k)=>payload.athletes.find((a)=>a.key===k).full_name).join(' / '),status:'PENDING',payment_status:'PENDING'})),
          payment: { status:'PENDING',amount,pix_payload:'PIX-LOCAL-FIXTURE-NO-REAL-PAYMENT',expires_at:new Date(Date.now()+7200000).toISOString() } };
      }
      return Response.json(window.__mockPayment || {});
    }
    if (String(url).includes('supabase.co')) throw new Error('Unexpected external request blocked by local test fixture');
    return originalFetch(url, options);
  };
}
