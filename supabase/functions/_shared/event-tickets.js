export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let len = 9; len <= 10; len++) {
    const sum = value.slice(0, len).split('').reduce((n, d, i) => n + Number(d) * (len + 1 - i), 0);
    if ((sum * 10) % 11 % 10 !== Number(value[len])) return false;
  }
  return true;
}
export function validateEventCheckout(body) {
  const name = String(body.buyer?.name || '').trim();
  const email = String(body.buyer?.email || '').trim().toLowerCase();
  const phone = String(body.buyer?.phone || '').replace(/\D/g, '');
  const cpf = String(body.buyer?.cpf || '').replace(/\D/g, '');
  if (name.length < 3 || name.length > 120) throw new Error('Informe o nome completo do comprador.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) throw new Error('Informe um e-mail válido.');
  if (!/^\d{10,13}$/.test(phone)) throw new Error('Informe um telefone com DDD.');
  if (!validCpf(cpf)) throw new Error('Confira o CPF do comprador.');
  if (!UUID.test(body.request_id || '') || !/^[a-f0-9]{64}$/.test(body.access_token || '')) throw new Error('Reabra a seleção de ingressos.');
  if (body.accepted !== true) throw new Error('Confirme a leitura das informações do evento.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new Error('Selecione seus ingressos.');
  const seen = new Set();
  const items = body.items.map(item => {
    if (!UUID.test(item.ticket_type_id || '') || seen.has(item.ticket_type_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new Error('Revise a quantidade de ingressos.');
    seen.add(item.ticket_type_id);
    return { ticket_type_id:item.ticket_type_id, quantity:item.quantity };
  }).sort((a,b) => a.ticket_type_id.localeCompare(b.ticket_type_id));
  const quantity = items.reduce((n,item) => n + item.quantity, 0);
  if (quantity > 20 || !Array.isArray(body.attendees) || body.attendees.length !== quantity) throw new Error('Informe todos os participantes.');
  const attendees = body.attendees.map(person => {
    const name = String(person.name || '').trim();
    if (!seen.has(person.ticket_type_id) || name.length < 2 || name.length > 120) throw new Error('Revise os nomes dos participantes.');
    const age = person.age;
    if (age !== undefined && age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) throw new Error('Informe uma idade válida na data do evento.');
    return { ticket_type_id:person.ticket_type_id, name, ...(age === undefined || age === null ? {} : { age }) };
  });
  for (const item of items) if (attendees.filter(p => p.ticket_type_id === item.ticket_type_id).length !== item.quantity) throw new Error('Os participantes não correspondem aos ingressos.');
  return { buyer:{ name,email,phone,cpf },items,attendees };
}
export function safeEventOrder(order) {
  const { id,event_id,status,total_cents,quantity,buyer_name,buyer_email,buyer_phone,created_at,paid_at,pix_expires_at,provider_status } = order;
  const pending = ['CREATED','PENDING'].includes(status);
  return { id,event_id,status,total_cents,quantity,buyer_name,buyer_email,buyer_phone,created_at,paid_at,provider_status,pix_expires_at,
    pix_payload:pending ? order.pix_payload : null,pix_image:pending ? order.pix_image : null };
}
