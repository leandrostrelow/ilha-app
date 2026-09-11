(function () {
  'use strict';

  const moduleState = {
    context: null,
    data: null,
    initialized: false,
    loading: false,
    participantQuery: '',
  };

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function session() {
    return moduleState.context && moduleState.context.getSession ? moduleState.context.getSession() : null;
  }

  function notify(message) {
    if (moduleState.context && moduleState.context.notify) moduleState.context.notify(message);
  }

  function setStatus(message, error) {
    const element = byId('betAdminStatus');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('error', Boolean(error));
  }

  function apiUrl() {
    return String(moduleState.context && moduleState.context.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/bet-admin-api';
  }

  async function request(options) {
    options = options || {};
    const currentSession = session();
    if (!currentSession || !currentSession.access_token || currentSession.access_token === 'demo') {
      throw new Error('Entre com uma conta administrativa real para usar o Ilha Bet.');
    }
    if (!moduleState.context || !moduleState.context.supabaseUrl || !moduleState.context.publishableKey) {
      throw new Error('A configuração do Ilha Bet está indisponível. Atualize a página.');
    }
    const query = options.tournamentId ? '?tournament_id=' + encodeURIComponent(options.tournamentId) : '';
    let response;
    try {
      response = await fetch(apiUrl() + query, {
        method: options.method || 'GET',
        headers: {
          apikey: moduleState.context.publishableKey,
          Authorization: 'Bearer ' + currentSession.access_token,
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
    } catch (_error) {
      throw new Error('Não foi possível conectar ao Ilha Bet. Verifique sua internet e tente novamente.');
    }
    let payload = null;
    try { payload = await response.json(); } catch (_error) {}
    if (!response.ok || !payload || payload.ok === false) {
      const fallback = response.status === 401
        ? 'Sua sessão expirou. Entre novamente.'
        : response.status === 403
          ? 'Você não tem permissão para administrar o Ilha Bet.'
          : 'Não foi possível carregar o Ilha Bet.';
      const error = new Error(payload && payload.error || fallback);
      error.code = payload && payload.code || 'request_failed';
      throw error;
    }
    if (!payload.data || typeof payload.data !== 'object') {
      throw new Error('O Ilha Bet respondeu sem os dados esperados. Atualize e tente novamente.');
    }
    return payload;
  }

  function localDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function isoDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function phoneLabel(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    if (local.length === 11) return local.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (local.length === 10) return local.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return digits;
  }

  function publicUrl() {
    const slug = moduleState.data && moduleState.data.tournament && moduleState.data.tournament.slug;
    return slug ? location.origin + '/bet?torneio=' + encodeURIComponent(slug) : '';
  }

  function campaignDefaults() {
    const tournament = moduleState.data && moduleState.data.tournament;
    return {
      title: tournament ? 'Ilha Bet · ' + tournament.name : 'Ilha Bet',
      status: 'DRAFT',
      published: false,
      opens_at: '',
      closes_at: '',
      initial_round_points: 1,
      semifinal_points: 2,
      final_points: 3,
      rules_text: 'Cada palpite correto vale pontos. Fases iniciais valem 1 ponto, semifinais valem 2 e finais valem 3. Em caso de empate, vence quem tiver mais partidas apuradas e, depois, quem entrou primeiro.',
      prize_enabled: false,
      prize_description: 'Uma camisa oficial do Ilha Tênis',
      authorization_reference: ''
    };
  }

  function renderTournamentPicker() {
    const picker = byId('betTournamentPicker');
    if (!picker || !moduleState.data) return;
    const selected = moduleState.data.tournament && moduleState.data.tournament.id || '';
    picker.innerHTML = (moduleState.data.tournaments || []).map(function (tournament) {
      return '<option value="' + escapeHtml(tournament.id) + '"' + (tournament.id === selected ? ' selected' : '') + '>' + escapeHtml(tournament.name) + '</option>';
    }).join('');
    picker.disabled = moduleState.loading || !picker.options.length;
  }

  function renderSummary() {
    const summary = moduleState.data && moduleState.data.summary || {};
    const values = {
      betMetricParticipants: summary.active_participants == null ? summary.participants || 0 : summary.active_participants,
      betMetricPredictions: summary.predictions || 0,
      betMetricSettled: (summary.settled_matches || 0) + '/' + (summary.available_matches || 0),
      betMetricStatus: moduleState.data && moduleState.data.campaign ? String(moduleState.data.campaign.status || 'DRAFT') : 'NÃO CRIADO'
    };
    Object.keys(values).forEach(function (id) { if (byId(id)) byId(id).textContent = values[id]; });
  }

  function renderForm() {
    if (!moduleState.data) return;
    const campaign = Object.assign(campaignDefaults(), moduleState.data.campaign || {});
    const campaignStatus = String(campaign.status || 'DRAFT').toUpperCase();
    const values = {
      betCampaignTitle: String(campaign.title || '').replace(/^Palpite Ilha\b/i, 'Ilha Bet'),
      betCampaignStatus: campaign.status,
      betCampaignOpensAt: localDateTime(campaign.opens_at),
      betCampaignClosesAt: localDateTime(campaign.closes_at),
      betInitialPoints: campaign.initial_round_points,
      betSemifinalPoints: campaign.semifinal_points,
      betFinalPoints: campaign.final_points,
      betCampaignRules: campaign.rules_text,
      betPrizeDescription: campaign.prize_description || '',
      betPrizeAuthorization: campaign.authorization_reference || ''
    };
    Object.keys(values).forEach(function (id) { if (byId(id)) byId(id).value = values[id] == null ? '' : values[id]; });
    byId('betCampaignPublished').checked = Boolean(campaign.published);
    byId('betPrizeEnabled').checked = Boolean(campaign.prize_enabled);
    byId('betPrizeFields').hidden = !campaign.prize_enabled;
    const frozenPoints = Number(moduleState.data.summary && moduleState.data.summary.participants || 0) > 0;
    ['betInitialPoints', 'betSemifinalPoints', 'betFinalPoints'].forEach(function (id) { byId(id).disabled = frozenPoints; });
    byId('betPointsHint').textContent = frozenPoints ? 'A pontuação ficou travada porque já há participantes.' : 'Pode ser ajustada até o primeiro cadastro.';
    const finished = campaignStatus === 'FINISHED';
    const canFinalize = Boolean(moduleState.data.campaign && moduleState.data.tournament) && campaignStatus === 'LOCKED';
    byId('betSaveCampaignBtn').disabled = moduleState.loading || finished || !moduleState.data.tournament;
    byId('betFinalizeCampaignBtn').hidden = !canFinalize;
    byId('betFinalizeCampaignBtn').disabled = moduleState.loading || !canFinalize;
    byId('betReopenCampaignBtn').hidden = !finished;
    byId('betReopenCampaignBtn').disabled = moduleState.loading || !finished;
    byId('betAdminReloadBtn').disabled = moduleState.loading;
    const link = publicUrl();
    byId('betPublicLink').value = link;
    byId('betOpenPublicBtn').disabled = !link;
    byId('betCopyPublicBtn').disabled = !link;
  }

  function renderParticipants() {
    const target = byId('betParticipantsList');
    if (!target || !moduleState.data) return;
    const query = moduleState.participantQuery.toLocaleLowerCase('pt-BR');
    const participants = (moduleState.data.participants || []).filter(function (entry) {
      if (!query) return true;
      return [entry.full_name, entry.email, entry.phone].some(function (value) {
        return String(value || '').toLocaleLowerCase('pt-BR').includes(query);
      });
    });
    const winner = moduleState.data.winner;
    byId('betWinnerCard').hidden = !winner;
    if (winner) byId('betWinnerName').textContent = winner.full_name + ' · ' + winner.score + ' pontos';
    if (!participants.length) {
      target.innerHTML = '<div class="bet-admin-empty">' + (query ? 'Nenhum participante encontrado.' : 'Ainda não há participantes neste desafio.') + '</div>';
      return;
    }
    const campaignFinished = String(moduleState.data.campaign && moduleState.data.campaign.status || '').toUpperCase() === 'FINISHED';
    const actionsDisabled = moduleState.loading || campaignFinished;
    target.innerHTML = participants.map(function (entry) {
      const active = entry.status === 'ACTIVE';
      return '<article class="bet-admin-participant ' + (active ? '' : 'blocked') + '">' +
        '<span class="bet-admin-rank">' + escapeHtml(entry.position || '—') + '</span>' +
        '<div class="bet-admin-person"><strong>' + escapeHtml(entry.full_name) + '</strong><span>' + escapeHtml(entry.public_name) + ' · ' + escapeHtml(active ? 'Ativo' : 'Bloqueado') + '</span></div>' +
        '<div class="bet-admin-person bet-admin-contact"><strong>' + escapeHtml(phoneLabel(entry.phone)) + '</strong><span>' + escapeHtml(entry.email) + '</span></div>' +
        '<div class="bet-admin-score bet-admin-points-score"><span>Pontos</span><strong>' + escapeHtml(entry.score) + '</strong></div>' +
        '<div class="bet-admin-score"><span>Acertos</span><strong>' + escapeHtml(entry.correct) + '</strong></div>' +
        '<div class="bet-admin-score"><span>Palpites</span><strong>' + escapeHtml(entry.predictions) + '</strong></div>' +
        '<div class="bet-admin-entry-actions"><button type="button" data-bet-status="' + escapeHtml(active ? 'BLOCKED' : 'ACTIVE') + '" data-entry-id="' + escapeHtml(entry.id) + '"' + (actionsDisabled ? ' disabled' : '') + '>' + (active ? 'Pausar' : 'Ativar') + '</button><button class="danger" type="button" data-bet-delete data-entry-id="' + escapeHtml(entry.id) + '" data-entry-name="' + escapeHtml(entry.full_name) + '"' + (actionsDisabled ? ' disabled' : '') + '>Excluir</button></div>' +
      '</article>';
    }).join('');
  }

  function render() {
    renderTournamentPicker();
    renderSummary();
    renderForm();
    renderParticipants();
  }

  async function load(tournamentId, quiet) {
    if (moduleState.loading) return;
    moduleState.loading = true;
    if (!quiet) setStatus('Carregando torneio, participantes e ranking…', false);
    render();
    try {
      const payload = await request({ tournamentId: tournamentId || '' });
      moduleState.data = payload.data;
      render();
      setStatus('Dados atualizados agora.', false);
    } catch (error) {
      setStatus(error.message, true);
      if (!quiet) notify(error.message);
    } finally {
      moduleState.loading = false;
      render();
    }
  }

  async function mutate(action, extra, confirmText) {
    if (moduleState.loading) return;
    const tournament = moduleState.data && moduleState.data.tournament;
    if (!tournament) return notify('Selecione um torneio.');
    const campaign = moduleState.data && moduleState.data.campaign;
    const status = String(campaign && campaign.status || '').toUpperCase();
    if (action === 'finalizeCampaign' && status !== 'LOCKED') {
      return notify('Salve o status “Palpites encerrados” antes de finalizar.');
    }
    if (action === 'reopenCampaign' && status !== 'FINISHED') {
      return notify('Somente um desafio finalizado pode ser reaberto.');
    }
    if (status === 'FINISHED' && ['saveCampaign', 'setEntryStatus', 'deleteEntry'].includes(action)) {
      return notify('Reabra o desafio antes de fazer esta alteração.');
    }
    if (confirmText && !window.confirm(confirmText)) return;
    moduleState.loading = true;
    setStatus('Salvando alteração…', false);
    render();
    try {
      const payload = await request({
        method: 'POST',
        body: Object.assign({ action: action, tournament_id: tournament.id }, extra || {})
      });
      moduleState.data = payload.data;
      render();
      setStatus('Alteração salva com segurança.', false);
      notify('Ilha Bet atualizado.');
    } catch (error) {
      setStatus(error.message, true);
      notify(error.message);
    } finally {
      moduleState.loading = false;
      render();
    }
  }

  function formPayload() {
    return {
      title: byId('betCampaignTitle').value,
      status: byId('betCampaignStatus').value,
      published: byId('betCampaignPublished').checked,
      opens_at: isoDateTime(byId('betCampaignOpensAt').value),
      closes_at: isoDateTime(byId('betCampaignClosesAt').value),
      initial_round_points: Number(byId('betInitialPoints').value || 1),
      semifinal_points: Number(byId('betSemifinalPoints').value || 2),
      final_points: Number(byId('betFinalPoints').value || 3),
      rules_text: byId('betCampaignRules').value,
      prize_enabled: byId('betPrizeEnabled').checked,
      prize_description: byId('betPrizeDescription').value,
      authorization_reference: byId('betPrizeAuthorization').value
    };
  }

  function bind() {
    if (moduleState.initialized) return;
    moduleState.initialized = true;
    byId('betTournamentPicker').addEventListener('change', function () { load(this.value, false); });
    byId('betAdminReloadBtn').addEventListener('click', function () { load(byId('betTournamentPicker').value, false); });
    byId('betCampaignForm').addEventListener('submit', function (event) {
      event.preventDefault();
      mutate('saveCampaign', formPayload());
    });
    byId('betPrizeEnabled').addEventListener('change', function () { byId('betPrizeFields').hidden = !this.checked; });
    byId('betParticipantSearch').addEventListener('input', function () { moduleState.participantQuery = this.value.trim(); renderParticipants(); });
    byId('betParticipantsList').addEventListener('click', function (event) {
      const statusButton = event.target.closest('[data-bet-status]');
      const deleteButton = event.target.closest('[data-bet-delete]');
      if (statusButton) {
        mutate('setEntryStatus', { entry_id: statusButton.dataset.entryId, status: statusButton.dataset.betStatus });
      }
      if (deleteButton) {
        mutate('deleteEntry', { entry_id: deleteButton.dataset.entryId }, 'Excluir ' + deleteButton.dataset.entryName + ' e todos os palpites dessa pessoa? Esta ação fica registrada no histórico.');
      }
    });
    byId('betFinalizeCampaignBtn').addEventListener('click', function () {
      mutate('finalizeCampaign', {}, 'Finalizar o desafio e confirmar automaticamente o primeiro colocado atual?');
    });
    byId('betReopenCampaignBtn').addEventListener('click', function () {
      mutate('reopenCampaign', {}, 'Reabrir o desafio e remover a confirmação do vencedor?');
    });
    byId('betOpenPublicBtn').addEventListener('click', function () { if (publicUrl()) window.open(publicUrl(), '_blank', 'noopener'); });
    byId('betCopyPublicBtn').addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(publicUrl()); notify('Link do Ilha Bet copiado.'); }
      catch (_error) { notify('Não foi possível copiar. Selecione o link no campo.'); }
    });
  }

  window.IlhaBetAdmin = {
    open: function (context) {
      moduleState.context = context;
      bind();
      load(moduleState.data && moduleState.data.tournament && moduleState.data.tournament.id || '', false);
    },
    render: render,
    refresh: function () { return load(byId('betTournamentPicker') && byId('betTournamentPicker').value || '', true); }
  };
})();
