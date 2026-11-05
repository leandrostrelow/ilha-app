export const LEAD_STATUSES = ['novo', 'contato', 'encaminhado', 'agendado', 'matriculado', 'arquivado'];
export const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
export function phoneDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return /^55[1-9][0-9][0-9]{8,9}$/.test(digits) ? digits : '';
}
function text(value, max, label) {
  if (value != null && typeof value !== 'string') throw new Error(`Confira ${label}.`);
  const result = String(value || '').normalize('NFC').trim().replace(/[\u0000-\u001f]/g, ' ');
  if (result.length > max) throw new Error(`${label}: use até ${max} caracteres.`);
  return result;
}
function choice(value, options, label, optional = false) {
  if (optional && !value) return '';
  if (!options.includes(value)) throw new Error(`Selecione ${label}.`);
  return value;
}
export function validateLead(body) {
  const nome = text(body.nome, 120, 'o nome');
  if (nome.length < 2) throw new Error('Informe o nome do aluno.');
  const telefone = phoneDigits(body.telefone);
  if (!telefone) throw new Error('Informe um telefone com DDD válido.');
  const idade = body.idade === '' || body.idade == null ? null : Number(body.idade);
  if (idade !== null && (!Number.isInteger(idade) || idade < 1 || idade > 110)) throw new Error('Confira a idade.');
  const publico = choice(body.publico, ['Adulto', 'Criança'], 'adulto ou criança');
  const responsavel = text(body.responsavel, 120, 'o responsável');
  if ((publico === 'Criança' || (idade !== null && idade < 18)) && responsavel.length < 2) throw new Error('Informe o nome do responsável pelo menor.');
  if (!Array.isArray(body.dias_disponiveis) || body.dias_disponiveis.length > 5 || body.dias_disponiveis.some(d => !DAYS.includes(d))) throw new Error('Confira os dias disponíveis.');
  if (body.consent !== true) throw new Error('Autorize o contato para enviar seu interesse.');
  const ja_fez_aula = choice(body.ja_fez_aula, ['Sim', 'Não'], 'se já fez aula');
  const utm = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) utm[key] = text(body.utm?.[key], 100, key);
  return {
    nome, telefone, idade, publico, responsavel,
    genero: choice(body.genero, ['Masculino', 'Feminino', 'Prefiro não informar'], 'o gênero', true),
    dias_disponiveis: [...new Set(body.dias_disponiveis)],
    periodo: choice(body.periodo, ['Manhã', 'Tarde', 'Noite'], 'o período'),
    ja_fez_aula,
    nivel: ja_fez_aula === 'Sim' ? choice(body.nivel, ['Iniciante', 'Intermediário', 'Avançado'], 'o nível', true) : '',
    frequencia: choice(body.frequencia, ['1x: R$250', '2x: R$350'], 'a frequência'),
    objetivo: choice(body.objetivo, ['Lazer', 'Aprender do zero', 'Competir'], 'o objetivo', true),
    como_conheceu: choice(body.como_conheceu, ['Instagram', 'Google', 'Indicação', 'Passando em frente', 'Evento ou torneio', 'WhatsApp', 'Outro'], 'como conheceu o clube'),
    observacoes: text(body.observacoes, 1500, 'as observações'), utm,
  };
}
export function validateLeadUpdate(body) {
  const status = choice(body.status, LEAD_STATUSES, 'a etapa');
  const teacher_id = body.teacher_id || null;
  if (teacher_id !== null && !/^[a-f0-9-]{36}$/i.test(teacher_id)) throw new Error('Professor inválido.');
  const professor_nome = text(body.professor_nome, 120, 'o professor');
  const professor_telefone = body.professor_telefone ? phoneDigits(body.professor_telefone) : '';
  if (body.professor_telefone && !professor_telefone) throw new Error('Confira o WhatsApp do professor.');
  if ((status === 'encaminhado' || body.confirm_forward) && !professor_nome) throw new Error('Informe o professor responsável.');
  const proximo_contato = body.proximo_contato || null;
  if (proximo_contato && (!/^\d{4}-\d{2}-\d{2}$/.test(proximo_contato) || !Number.isFinite(Date.parse(proximo_contato)) || new Date(proximo_contato).toISOString().slice(0,10) !== proximo_contato)) throw new Error('Data de retorno inválida.');
  const aula_em = body.aula_em || null;
  if (aula_em && !Number.isFinite(Date.parse(aula_em))) throw new Error('Data da aula inválida.');
  return { status, teacher_id, professor_nome, professor_telefone, proximo_contato, aula_em,
    anotacoes: text(body.anotacoes, 6000, 'as anotações'), confirm_forward: body.confirm_forward === true };
}
// Spreadsheet-formula injection is neutralized even if the legacy script uses setValues.
export function sheetText(value) { const s = String(value ?? ''); return /^[\s]*[=+@-]/.test(s) ? "'" + s : s; }
export function sheetPayload(lead) {
  const fields = ['nome','telefone','idade','publico','genero','periodo','ja_fez_aula','nivel','frequencia','objetivo','como_conheceu'];
  const result = { action: 'submit', dias_disponiveis: lead.dias_disponiveis };
  for (const field of fields) result[field] = sheetText(lead[field]);
  // The existing Apps Script requires a non-empty gender, even when omitted by the new form.
  result.genero = sheetText(lead.genero || 'Não informado');
  result.objetivo = sheetText(lead.objetivo || 'A combinar');
  result.observacoes = sheetText([lead.responsavel ? 'Responsável: ' + lead.responsavel : '', lead.como_conheceu ? 'Como conheceu: ' + lead.como_conheceu : '', lead.observacoes].filter(Boolean).join(' · '));
  return result;
}
