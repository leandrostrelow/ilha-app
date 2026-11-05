(() => {
  'use strict';
  const form = document.getElementById('leadForm');
  const errorBox = document.getElementById('formError');
  const button = document.getElementById('submitBtn');
  let requestId = crypto.randomUUID();
  let lastFingerprint = '';
  // Keep the token (not personal data) through reloads after uncertain network delivery.
  try { requestId = sessionStorage.getItem('ilha:aulas:request') || requestId; lastFingerprint = sessionStorage.getItem('ilha:aulas:fingerprint') || ''; sessionStorage.setItem('ilha:aulas:request', requestId); } catch { /* private mode */ }
  function conditions() {
    const minor = form.elements.publico.value === 'Criança' || (Number(form.elements.idade.value) > 0 && Number(form.elements.idade.value) < 18);
    document.getElementById('responsavelSection').hidden = !minor;
    form.elements.responsavel.required = minor;
    document.getElementById('nivelSection').hidden = form.elements.ja_fez_aula.value !== 'Sim';
  }
  form.addEventListener('change', conditions);
  form.elements.idade.addEventListener('input', conditions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    errorBox.hidden = true;
    const values = new FormData(form);
    const phone = String(values.get('telefone') || '').replace(/\D/g, '');
    if (!/^(?:55)?[1-9][0-9][0-9]{8,9}$/.test(phone)) { errorBox.textContent = 'Confira o WhatsApp e inclua o DDD.'; errorBox.hidden = false; form.elements.telefone.focus(); return; }
    const payload = Object.fromEntries(values);
    payload.dias_disponiveis = values.getAll('dias_disponiveis');
    payload.consent = form.elements.consent.checked;
    payload.nivel = payload.ja_fez_aula === 'Sim' ? payload.nivel : '';
    payload.utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign'].map(key => [key, new URLSearchParams(location.search).get(key)?.slice(0,100) || '']));
    const serialized = JSON.stringify(payload);
    button.disabled = true; button.textContent = 'Enviando seu interesse…';
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId+':'+serialized));
    const fingerprint = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    // A changed form is a new request, while a retry of the same form is idempotent.
    if (lastFingerprint && lastFingerprint !== fingerprint) {
      requestId = crypto.randomUUID();
      const changedDigest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId+':'+serialized));
      lastFingerprint = Array.from(new Uint8Array(changedDigest),b=>b.toString(16).padStart(2,'0')).join('');
    } else lastFingerprint = fingerprint;
    try { sessionStorage.setItem('ilha:aulas:request', requestId); sessionStorage.setItem('ilha:aulas:fingerprint', lastFingerprint); } catch { /* private mode */ }
    try {
      const response = await fetch('https://lkqtgptebkgfwguykxhv.supabase.co/functions/v1/lesson-leads-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_zcX8te5g99p0bA12xy_E-A_MTyNpJNx' },
        body: JSON.stringify({ ...payload, action: 'submit', request_id: requestId }), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Não foi possível enviar agora.');
      try { sessionStorage.removeItem('ilha:aulas:request'); sessionStorage.removeItem('ilha:aulas:fingerprint'); } catch { /* private mode */ }
      form.hidden = true; document.getElementById('formHeading').hidden = true;
      const success = document.getElementById('formSuccess'); success.hidden = false; success.focus();
      success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      errorBox.textContent = error.name === 'TimeoutError' || error instanceof TypeError
        ? 'A conexão não confirmou o envio. Tente de novo: o mesmo cadastro não será duplicado.' : error.message;
      errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } finally { button.disabled = false; button.textContent = 'Quero jogar no Ilha ↗'; }
  });
  conditions();
})();
