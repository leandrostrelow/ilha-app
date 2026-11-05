// Informational page only: no checkout, customer data, or payment requests.
const invite = [
  '🎃 HALLOWEEN NO ILHA — PRÉ-LISTA ABERTA!',
  '',
  '📅 Sexta, 30/10/2026 · 18h30 às 00h30',
  '📍 Ilha Tênis — Colatina',
  '🎸 Leony Diall + banda, Rafa Assis e DJ',
  '🍔 Buffet, chopp e bebidas',
  '👻 Ambiente decorado! Venha fantasiado!',
  '',
  'Conheça a festa: https://app.ilhatenis.com/halloween-prelista',
  '',
  'Bora? Coloque seu nome na pré-lista! Nas crianças, informe a idade. 👇',
  '1.',
  '2.',
  '3.',
  '',
  'Pré-lista de interesse; participação a confirmar com a organização.',
].join('\n');

document.querySelectorAll('.share-link').forEach((link) => {
  link.href = `https://wa.me/?text=${encodeURIComponent(invite)}`;
});
