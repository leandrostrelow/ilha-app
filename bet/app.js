(() => {
  'use strict';

  const runtimeConfig = window.PALPITE_ILHA_CONFIG || {};
  const API_URL = `${runtimeConfig.supabaseUrl || ''}/functions/v1/bet-public-api`;
  const STORAGE_PREFIX = 'palpite-ilha:access:';
  const PENDING_REGISTRATION_REQUEST_PREFIX = 'palpite-ilha:pending-registration:';

  const state = {
    slug: (new URLSearchParams(location.search).get('torneio') || '').trim().toLowerCase(),
    data: null,
    config: null,
    access: null,
    activeTab: 'games',
    categoryId: '',
    dayFilter: '',
    captchaWidgetId: null,
    captchaToken: '',
    captchaReady: false,
    savingMatchId: '',
    modalTrigger: null,
    pendingRegistrationRequestId: '',
    refreshing: false,
    sessionError: '',
    serverTime: null,
    serverTimeReceivedAt: 0,
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function storageKey(campaignId) {
    return `${STORAGE_PREFIX}${campaignId || 'unknown'}`;
  }

  function pendingRegistrationStorageKey() {
    return `${PENDING_REGISTRATION_REQUEST_PREFIX}${state.slug}`;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function pendingRegistrationRequestId() {
    if (isUuid(state.pendingRegistrationRequestId)) return state.pendingRegistrationRequestId;
    try {
      const stored = sessionStorage.getItem(pendingRegistrationStorageKey());
      if (isUuid(stored)) {
        state.pendingRegistrationRequestId = stored;
        return stored;
      }
    } catch (_error) {
      // An in-memory UUID still makes retries idempotent when storage is unavailable.
    }
    state.pendingRegistrationRequestId = crypto.randomUUID();
    try {
      sessionStorage.setItem(pendingRegistrationStorageKey(), state.pendingRegistrationRequestId);
    } catch (_error) {
      // Do not persist form fields; only the non-sensitive UUID is eligible for storage.
    }
    return state.pendingRegistrationRequestId;
  }

  function clearPendingRegistrationRequestId() {
    state.pendingRegistrationRequestId = '';
    try { sessionStorage.removeItem(pendingRegistrationStorageKey()); } catch (_error) { /* noop */ }
  }

  function savedAccess(campaignId) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(campaignId)) || 'null');
      if (!value || typeof value.entry_id !== 'string' || typeof value.access_code !== 'string') return null;
      return { entry_id: value.entry_id, access_code: value.access_code };
    } catch (_error) {
      return null;
    }
  }

  function rememberAccess(access) {
    if (!state.data?.campaign?.id || !access?.entry_id || !access?.access_code) return;
    state.access = { entry_id: access.entry_id, access_code: access.access_code };
    try {
      localStorage.setItem(storageKey(state.data.campaign.id), JSON.stringify(state.access));
    } catch (_error) {
      // The session still works even when private browsing blocks localStorage.
    }
  }

  function forgetAccess() {
    if (state.data?.campaign?.id) {
      try { localStorage.removeItem(storageKey(state.data.campaign.id)); } catch (_error) { /* noop */ }
    }
    state.access = null;
    if (state.data) state.data.participant = null;
  }

  async function api(path = '', options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(20000),
      ...options,
      headers: {
        apikey: runtimeConfig.publishableKey || '',
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await response.json(); } catch (_error) { /* handled below */ }
    if (!response.ok || body?.ok === false) {
      const error = new Error(String(body?.error || 'Não foi possível concluir agora.').replaceAll('Palpite Ilha', 'Ilha Bet'));
      error.code = body?.code || `http_${response.status}`;
      error.status = response.status;
      const retryAfterSeconds = Number(response.headers.get('Retry-After') || body?.retry_after_seconds);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) error.retryAfterSeconds = retryAfterSeconds;
      throw error;
    }
    const serverTime = Date.parse(body?.data?.server_now || '');
    if (Number.isFinite(serverTime)) {
      state.serverTime = serverTime;
      state.serverTimeReceivedAt = performance.now();
    }
    return body;
  }

  function post(action, payload = {}) {
    return api('', {
      method: 'POST',
      body: JSON.stringify({ action, tournament_slug: state.slug, ...payload }),
    });
  }

  function showNotice(title, message, isError = false) {
    const notice = $('pageNotice');
    notice.hidden = false;
    notice.classList.toggle('is-error', isError);
    notice.querySelector('strong').textContent = title;
    notice.querySelector('p').textContent = message;
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function displayCampaignTitle(value) {
    return String(value || '').replace(/^Palpite Ilha\b/i, 'Ilha Bet') || 'Ilha Bet';
  }

  function dateLabel(value) {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
  }

  function dateTimeLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(date).replace('.', '');
  }

  function phaseLabel(value) {
    const key = String(value || '').toUpperCase();
    if (['F', 'FINAL'].includes(key)) return 'Final';
    if (['SF', 'SEMIFINAL', 'SEMI_FINAL'].includes(key)) return 'Semifinal';
    if (['QF', 'QUARTERFINAL', 'QUARTAS'].includes(key)) return 'Quartas';
    if (['R16', 'OITAVAS'].includes(key)) return 'Oitavas';
    if (['R32', 'DEZESSEIS_AVOS'].includes(key)) return '1ª rodada';
    return key ? key.replaceAll('_', ' ') : 'Jogo';
  }

  function statusLabel(campaign) {
    if (!campaign) return 'Indisponível';
    if (campaign.status === 'OPEN' && campaign.accepting_predictions) return 'Palpites abertos';
    if (campaign.status === 'OPEN') return 'Fora da janela de participação';
    if (campaign.status === 'LOCKED') return 'Palpites encerrados';
    if (campaign.status === 'FINISHED') return 'Desafio finalizado';
    return 'Em preparação';
  }

  function matchSchedule(match) {
    const parts = [];
    if (match.match_date) parts.push(dateLabel(match.match_date));
    if (match.match_time) parts.push(match.match_time);
    if (match.court_name) parts.push(match.court_name);
    return parts.join(' · ') || 'Horário a definir';
  }

  function matchDayLabel(value) {
    if (!value) return 'Dia a definir';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    const label = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short', day: '2-digit', month: '2-digit',
    }).format(date).replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function matchSortOrder(match, fallback = 0) {
    const rawOrder = match.sort_order;
    const order = rawOrder === null || rawOrder === undefined || rawOrder === '' ? Number.NaN : Number(rawOrder);
    return Number.isFinite(order) ? order : 100000 + fallback;
  }

  function sortAgendaMatches(matches) {
    return matches.map((match, index) => ({ match, index })).sort((left, right) => {
      const order = matchSortOrder(left.match, left.index) - matchSortOrder(right.match, right.index);
      if (order) return order;
      const leftTime = left.match.match_time || '99:99';
      const rightTime = right.match.match_time || '99:99';
      return leftTime.localeCompare(rightTime) || Number(left.match.match_no || 0) - Number(right.match.match_no || 0);
    }).map((item) => item.match);
  }

  function ownPickMap() {
    return new Map((state.data?.participant?.predictions || []).map((pick) => [pick.match_id, pick.winner_athlete_id]));
  }

  function renderHeader() {
    const { campaign } = state.data;
    $('heroTitle').firstChild.nodeValue = displayCampaignTitle(campaign.title);
    $('rulesText').textContent = campaign.rules_text || 'Escolha um atleta por jogo. Cada acerto soma os pontos definidos para a fase. O ranking usa somente os resultados oficiais lançados pela organização.';
    $('initialPoints').textContent = campaign.initial_round_points;
    $('semifinalPoints').textContent = campaign.semifinal_points;
    $('finalPoints').textContent = campaign.final_points;
    $('prizeCard').hidden = !campaign.prize;
    $('prizeText').textContent = campaign.prize || '';
  }

  function renderCategoryFilter() {
    const select = $('categoryFilter');
    const previous = state.categoryId;
    const categoryIdsWithMatches = new Set(state.data.matches.map((match) => match.category_id));
    const availableCategories = state.data.categories.filter((category) => categoryIdsWithMatches.has(category.id));
    select.innerHTML = '<option value="">Todas as classes</option>' + availableCategories.map((category) =>
      `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
    if (availableCategories.some((category) => category.id === previous)) select.value = previous;
    else state.categoryId = '';
  }

  function predictionDeadlineReached(match) {
    const cutoff = Date.parse(match.prediction_closes_at || '');
    const now = state.serverTime === null ? Date.now()
      : state.serverTime + performance.now() - state.serverTimeReceivedAt;
    return Number.isFinite(cutoff) && now >= cutoff;
  }

  function renderMatchCard(match, pickMap, categoryName) {
    const selected = pickMap.get(match.id) || '';
    const isSaving = state.savingMatchId === match.id;
    const deadlineReached = predictionDeadlineReached(match);
    const locked = Boolean(match.locked || deadlineReached || isSaving);
    const settled = Boolean(match.winner_athlete_id);
    const choice = (side) => {
      const isSelected = selected === side.id;
      const isWinner = settled && match.winner_athlete_id === side.id;
      const isLoser = settled && selected === side.id && !isWinner;
      const classes = ['player-choice', isSelected ? 'selected' : '', isWinner ? 'winner' : '', isLoser ? 'loser' : ''].filter(Boolean).join(' ');
      const label = isWinner ? 'Venceu' : isSelected ? 'Seu palpite' : locked ? '' : 'Escolher';
      return `<button class="${classes}" type="button" data-pick data-match-id="${escapeHtml(match.id)}" data-athlete-id="${escapeHtml(side.id)}" ${locked ? 'disabled' : ''} aria-pressed="${isSelected}"><strong>${escapeHtml(side.name)}</strong><small>${escapeHtml(label)}</small></button>`;
    };
    const stateLabel = isSaving
      ? 'Salvando…'
      : settled
        ? `Resultado: ${escapeHtml(match.score || 'confirmado')}`
        : match.lock_reason === 'UPCOMING' && match.prediction_opens_at
          ? `Abre ${dateTimeLabel(match.prediction_opens_at)}`
          : match.locked || deadlineReached
            ? 'Palpite encerrado'
            : selected ? 'Palpite salvo' : 'Aberto';
    return `<article class="match-card">
      <div class="match-meta"><span><strong>${escapeHtml(categoryName)}</strong><small>${escapeHtml(phaseLabel(match.phase))} · jogo ${escapeHtml(match.match_no || '')}</small></span><span class="points-badge">vale ${escapeHtml(match.points)} pt${Number(match.points) === 1 ? '' : 's'}</span></div>
      ${choice(match.side1)}${choice(match.side2)}
      <div class="match-foot"><span>${escapeHtml(matchSchedule(match))}</span><strong class="${locked ? 'locked-badge' : selected ? 'saved-badge' : ''}">${stateLabel}</strong></div>
    </article>`;
  }

  function renderGames() {
    const pickMap = ownPickMap();
    const visible = state.data.matches.filter((match) => !state.categoryId || match.category_id === state.categoryId);
    const days = [...new Set(visible.map((match) => match.match_date).filter(Boolean))].sort();
    if (!days.includes(state.dayFilter)) state.dayFilter = days[0] || '';
    $('gamesDayTabs').innerHTML = days.map((day) => {
      const count = visible.filter((match) => match.match_date === day).length;
      const active = day === state.dayFilter;
      return `<button class="games-day-tab${active ? ' active' : ''}" type="button" role="tab" data-bet-day="${escapeHtml(day)}" aria-selected="${active}"><span>${escapeHtml(matchDayLabel(day))}</span><small>${count} ${count === 1 ? 'jogo' : 'jogos'}</small></button>`;
    }).join('');
    if (!visible.length) {
      $('gamesList').innerHTML = '<div class="empty-state"><strong>Nenhum jogo agendado aqui.</strong>Assim que a organização colocar os confrontos na agenda, eles aparecem automaticamente.</div>';
      return;
    }
    const categoryNames = new Map(state.data.categories.map((category) => [category.id, category.name]));
    const selectedDayMatches = visible.filter((match) => match.match_date === state.dayFilter);
    const courts = [...new Set(selectedDayMatches.map((match) => match.court_name || 'Sem quadra'))]
      .sort((left, right) => left.localeCompare(right, 'pt-BR', { numeric: true }));
    $('gamesList').innerHTML = `<div class="courts-grid">${courts.map((court) => {
      const matches = sortAgendaMatches(selectedDayMatches.filter((match) => (match.court_name || 'Sem quadra') === court));
      const cards = matches.map((match) => renderMatchCard(match, pickMap, categoryNames.get(match.category_id) || 'Classe')).join('');
      return `<section class="court-group"><div class="court-heading"><div><span>Ordem da agenda</span><h3>${escapeHtml(court)}</h3></div><strong>${matches.length} ${matches.length === 1 ? 'jogo' : 'jogos'}</strong></div><div class="court-match-list">${cards}</div></section>`;
    }).join('')}</div>`;
  }

  function renderMine() {
    const participant = state.data.participant;
    const accessEmpty = $('accessEmpty');
    const accessDetails = $('accessDetails');
    $('joinReminder').hidden = Boolean(participant) || !state.data.campaign.accepting_predictions;
    $('leaveDeviceButton').hidden = !participant;
    accessEmpty.hidden = Boolean(participant);
    accessDetails.hidden = !participant;
    $('historySummary').hidden = !participant;
    $('historyHeading').hidden = !participant;
    if (!participant) {
      $('historySummary').innerHTML = '';
      $('participantGreeting').textContent = 'Entre para ver e alterar suas escolhas.';
      $('myPickCount').textContent = '0';
      $('myPicksList').innerHTML = '<div class="empty-state"><strong>Entre para consultar seu histórico.</strong><p>Use o e-mail e o código do seu cadastro para ver todos os palpites.</p><button class="primary-button" type="button" data-open-registration>Acessar meus palpites</button></div>';
      return;
    }
    const picks = ownPickMap();
    $('participantGreeting').textContent = `${participant.name}, acompanhe aqui tudo que você escolheu.`;
    $('savedAccessCode').textContent = state.access?.access_code || '••••••••••';
    $('myPickCount').textContent = String(picks.size);
    const predictions = [...(participant.predictions || [])].sort((a, b) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || String(a.match_id).localeCompare(String(b.match_id)));
    const summary = { total: predictions.length, points: 0, correct: 0, missed: 0, pending: 0, unavailable: 0 };
    for (const pick of predictions) {
      const match = pick.match || state.data.matches.find((item) => item.id === pick.match_id);
      const validSide = [match?.side1?.id, match?.side2?.id].includes(pick.winner_athlete_id);
      if (!match || match.status === 'CANCELLED' || !validSide) { summary.unavailable++; continue; }
      if (['FINISHED', 'WALKOVER'].includes(match.status) && match.winner_athlete_id) {
        if (match.winner_athlete_id === pick.winner_athlete_id) { summary.correct++; summary.points += Number(match.points) || 0; }
        else summary.missed++;
      } else summary.pending++;
    }
    $('historySummary').innerHTML = [
      ['Palpites', summary.total], ['Pontos', summary.points], ['Acertos', summary.correct],
      ['Erros', summary.missed], ['Aguardando', summary.pending], ['Sem apuração', summary.unavailable],
    ].map(([label, value]) => `<div class="summary-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    if (!predictions.length) {
      $('myPicksList').innerHTML = '<div class="empty-state"><strong>Seu cartão ainda está vazio.</strong>Abra a aba Jogos e escolha seus favoritos.</div>';
      return;
    }
    $('myPicksList').innerHTML = predictions.map((pick) => {
      const match = pick.match || state.data.matches.find((item) => item.id === pick.match_id);
      const athleteId = pick.winner_athlete_id;
      const side = [match?.side1, match?.side2].find((item) => item?.id === athleteId);
      const name = pick.winner_name || side?.name || 'Atleta escolhido';
      const settled = match && ['FINISHED', 'WALKOVER'].includes(match.status) && match.winner_athlete_id;
      const correct = settled && side ? match.winner_athlete_id === athleteId : null;
      const outcome = !match ? 'Jogo indisponível para consulta'
        : match.status === 'CANCELLED' ? 'Cancelado · sem pontuação'
        : !side ? 'Confronto alterado · sem pontuação'
        : correct === true ? `+${match.points} ponto${Number(match.points) === 1 ? '' : 's'}`
        : correct === false ? 'Não pontuou' : match.locked ? 'Aguardando resultado' : 'Ainda pode alterar';
      const category = state.data.categories.find((item) => item.id === match?.category_id)?.name || '';
      const details = match ? [category, phaseLabel(match.phase), matchSchedule(match)].filter(Boolean).join(' · ') : 'Seu palpite continua salvo';
      const opponents = match ? `${match.side1.name} × ${match.side2.name}` : '';
      return `<article class="my-pick"><div><small>Seu palpite</small><strong>${escapeHtml(name)}</strong><small>${escapeHtml(opponents)}</small><small>${escapeHtml(details)}</small>${settled && match.score ? `<small>Placar: ${escapeHtml(match.score)}</small>` : ''}${pick.updated_at ? `<small>Salvo em ${escapeHtml(dateTimeLabel(pick.updated_at))}</small>` : ''}</div><span>${escapeHtml(outcome)}</span></article>`;
    }).join('');
  }

  function renderRanking() {
    const rows = state.data.ranking || [];
    if (!rows.length) {
      $('rankingList').innerHTML = '<div class="ranking-empty">O ranking aparece assim que a primeira pessoa participar.</div>';
      return;
    }
    $('rankingList').innerHTML = rows.map((row) => `<article class="ranking-row ${row.position <= 3 ? 'top' : ''}">
      <span class="ranking-position">${escapeHtml(row.position)}º</span>
      <div class="ranking-name"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.predictions)} ${Number(row.predictions) === 1 ? 'palpite' : 'palpites'}</small></div>
      <div class="ranking-metrics">
      <span class="ranking-stat score">Pontos<b>${escapeHtml(row.score)}</b></span>
      <span class="ranking-stat">Acertos<b>${escapeHtml(row.correct)}</b></span>
      <span class="ranking-stat">Apurados<b>${escapeHtml(row.settled)}</b></span>
      </div>
    </article>`).join('');
  }

  function render() {
    if (!state.data?.available) return;
    renderHeader();
    renderCategoryFilter();
    renderGames();
    renderMine();
    renderRanking();
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      const active = panel.dataset.panel === state.activeTab;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === state.activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function switchTab(tab) {
    state.activeTab = tab;
    render();
    $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector(`[data-tab="${tab}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  function setAccessMode(mode) {
    const register = mode === 'register';
    $('registerForm').hidden = !register;
    $('resumeForm').hidden = register;
    document.querySelectorAll('[data-access-mode]').forEach((button) => {
      const active = button.dataset.accessMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('formError').hidden = true;
    resetCaptcha();
  }

  function openRegistration(mode = 'register') {
    state.modalTrigger = document.activeElement;
    setAccessMode(mode);
    $('registrationModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setBackgroundInert(true);
    ensureCaptcha().catch(() => {
      $('captchaStatus').textContent = 'Não foi possível carregar a proteção. Verifique a conexão.';
    });
    setTimeout(() => (mode === 'register' ? $('registerName') : $('resumeEmail')).focus(), 60);
  }

  function closeRegistration() {
    $('registrationModal').hidden = true;
    document.body.style.overflow = '';
    setBackgroundInert(false);
    $('formError').hidden = true;
    if (state.modalTrigger && typeof state.modalTrigger.focus === 'function') state.modalTrigger.focus();
  }

  function setBackgroundInert(value) {
    document.querySelectorAll('.site-header, main, footer').forEach((element) => { element.inert = value; });
  }

  function activeModal() {
    return [$('accessCodeModal'), $('registrationModal')].find((modal) => modal && !modal.hidden) || null;
  }

  function trapModalFocus(event) {
    if (event.key !== 'Tab') return;
    const modal = activeModal();
    if (!modal) return;
    const items = Array.from(modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function captchaScript() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-palpite-turnstile]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.palpiteTurnstile = 'true';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function ensureCaptcha() {
    if (state.captchaReady || !state.config?.captcha?.site_key) return;
    await captchaScript();
    state.captchaWidgetId = window.turnstile.render('#captchaWidget', {
      sitekey: state.config.captcha.site_key,
      action: state.config.captcha.action || 'palpite_ilha',
      theme: 'light',
      callback(token) {
        state.captchaToken = token;
        $('captchaStatus').textContent = 'Proteção confirmada.';
      },
      'expired-callback'() {
        state.captchaToken = '';
        $('captchaStatus').textContent = 'Confirme novamente para continuar.';
      },
      'error-callback'() {
        state.captchaToken = '';
        $('captchaStatus').textContent = 'Não foi possível confirmar. Tente novamente.';
      },
    });
    state.captchaReady = true;
    $('captchaStatus').textContent = 'Confirme a proteção para continuar.';
  }

  function resetCaptcha() {
    state.captchaToken = '';
    if (state.captchaReady && window.turnstile && state.captchaWidgetId !== null) {
      try { window.turnstile.reset(state.captchaWidgetId); } catch (_error) { /* noop */ }
    }
  }

  function setFormError(error) {
    $('formError').textContent = error?.message || 'Não foi possível concluir agora.';
    $('formError').hidden = false;
  }

  function setFormBusy(form, busy) {
    form.querySelectorAll('button, input').forEach((element) => { element.disabled = busy; });
  }

  async function register(event) {
    event.preventDefault();
    const form = event.currentTarget;
    $('formError').hidden = true;
    if (!state.captchaToken) return setFormError(new Error('Confirme a proteção anti-robô para continuar.'));
    setFormBusy(form, true);
    try {
      const response = await post('register', {
        request_id: pendingRegistrationRequestId(),
        full_name: $('registerName').value,
        phone: $('registerPhone').value,
        email: $('registerEmail').value,
        consent: $('registerConsent').checked,
        captcha_token: state.captchaToken,
      });
      state.data = response.data;
      rememberAccess(response.access);
      clearPendingRegistrationRequestId();
      closeRegistration();
      $('newAccessCode').textContent = response.access.access_code;
      $('newAccessEmailStatus').textContent = response.email_delivery && response.email_delivery.status === 'SENT'
        ? 'Também enviamos uma cópia para o e-mail informado. Assim você recupera o acesso em outro celular.'
        : 'Ele já ficou salvo neste aparelho. Guarde ou tire uma captura para conseguir entrar em outro celular.';
      $('accessCodeModal').hidden = false;
      document.body.style.overflow = 'hidden';
      setBackgroundInert(true);
      render();
      setTimeout(() => $('copyNewAccessCodeButton').focus(), 50);
    } catch (error) {
      if (error?.code === 'request_conflict') clearPendingRegistrationRequestId();
      setFormError(error);
      resetCaptcha();
    } finally {
      setFormBusy(form, false);
    }
  }

  async function resume(event) {
    event.preventDefault();
    const form = event.currentTarget;
    $('formError').hidden = true;
    if (!state.captchaToken) return setFormError(new Error('Confirme a proteção anti-robô para continuar.'));
    setFormBusy(form, true);
    try {
      const response = await post('resume', {
        email: $('resumeEmail').value,
        access_code: $('resumeCode').value,
        captcha_token: state.captchaToken,
      });
      state.data = response.data;
      rememberAccess(response.access);
      closeRegistration();
      state.activeTab = 'mine';
      render();
      showToast('Seus palpites foram carregados.');
    } catch (error) {
      setFormError(error);
      resetCaptcha();
    } finally {
      setFormBusy(form, false);
    }
  }

  async function savePick(matchId, athleteId) {
    const match = state.data?.matches?.find((item) => item.id === matchId);
    if (match && (match.locked || predictionDeadlineReached(match))) {
      renderGames();
      showToast('O prazo para palpitar neste jogo encerrou ou a partida já começou.');
      return;
    }
    if (!state.data?.participant || !state.access) {
      openRegistration('register');
      return;
    }
    if (state.savingMatchId || state.refreshing) return;
    state.savingMatchId = matchId;
    renderGames();
    try {
      const response = await post('predict', {
        ...state.access,
        match_id: matchId,
        winner_athlete_id: athleteId,
        request_id: crypto.randomUUID(),
      });
      state.data = response.data;
      showToast('Palpite salvo. Boa sorte!');
    } catch (error) {
      if (['invalid_access', 'entry_blocked'].includes(error.code)) forgetAccess();
      showToast(error.message);
    } finally {
      state.savingMatchId = '';
      render();
    }
  }

  async function restoreSession() {
    state.access = savedAccess(state.data.campaign.id);
    if (!state.access) return;
    try {
      const response = await post('state', state.access);
      state.data = response.data;
      state.sessionError = '';
    } catch (error) {
      if (['invalid_access', 'entry_blocked'].includes(error.code)) {
        forgetAccess();
        state.sessionError = error.message;
      } else {
        state.sessionError = 'Não foi possível carregar seus palpites. Seu código salvo não foi removido. Toque em Atualizar para tentar novamente.';
      }
    }
  }

  async function refreshSnapshot() {
    if (state.refreshing || state.savingMatchId) return;
    state.refreshing = true;
    const access = state.access;
    $('pullRefreshStatus').hidden = false;
    $('pullRefreshStatus').textContent = 'Atualizando…';
    try {
      const response = state.access ? await post('state', state.access) : await api(`?torneio=${encodeURIComponent(state.slug)}`);
      if (state.access !== access) return;
      if (!response.data?.available) throw new Error('O desafio está temporariamente indisponível.');
      state.data = response.data;
      state.sessionError = '';
      $('pageNotice').hidden = true;
      render();
      showToast('Palpites e resultados atualizados.');
    } catch (error) {
      if (['invalid_access', 'entry_blocked'].includes(error.code)) { forgetAccess(); render(); }
      showNotice('Não foi possível atualizar', error.message || 'Tente novamente. Seus palpites continuam salvos.', true);
    } finally {
      state.refreshing = false;
      $('pullRefreshStatus').hidden = true;
    }
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      showToast('Código copiado.');
    } catch (_error) {
      showToast('Segure sobre o código para copiar.');
    }
  }

  function whatsappNumber(value) {
    const phone = String(value || '').replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) return '55' + phone;
    if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) return phone;
    return '';
  }

  function requestLostAccess() {
    $('formError').hidden = true;
    const email = $('resumeEmail').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return setFormError(new Error('Informe primeiro o e-mail usado no cadastro.'));
    }
    const phone = whatsappNumber(state.data?.tournament?.whatsapp);
    if (!phone) return setFormError(new Error('O WhatsApp da organização não está disponível agora.'));
    const tournamentName = state.data?.tournament?.name || 'torneio';
    const message = [
      'Olá! Perdi meu código de acesso do Ilha Bet. 🎾',
      '',
      'Torneio: ' + tournamentName,
      'E-mail do cadastro: ' + email,
      '',
      'Pode me ajudar a recuperar o acesso?'
    ].join('\n');
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button, a');
      if (!target) return;
      if (target.matches('[data-tab]')) switchTab(target.dataset.tab);
      if (target.matches('[data-open-registration]')) openRegistration('register');
      if (target.matches('[data-access-mode]')) setAccessMode(target.dataset.accessMode);
      if (target.matches('[data-bet-day]')) { state.dayFilter = target.dataset.betDay; renderGames(); }
      if (target.matches('[data-pick]')) savePick(target.dataset.matchId, target.dataset.athleteId);
    });
    $('openAccessButton').addEventListener('click', () => state.data?.participant ? switchTab('mine') : openRegistration('resume'));
    $('closeRegistrationButton').addEventListener('click', closeRegistration);
    $('registrationModal').addEventListener('click', (event) => { if (event.target === $('registrationModal')) closeRegistration(); });
    $('registerForm').addEventListener('submit', register);
    $('resumeForm').addEventListener('submit', resume);
    $('lostAccessButton').addEventListener('click', requestLostAccess);
    let pullStart = null;
    let pullDistance = 0;
    const clearPull = () => {
      pullStart = null;
      pullDistance = 0;
      if (!state.refreshing) $('pullRefreshStatus').hidden = true;
    };
    document.addEventListener('touchstart', (event) => {
      clearPull();
      if (window.scrollY > 0 || event.touches.length !== 1 || state.refreshing || !state.data ||
          event.target.closest('input, textarea, select, button, a, .tabs, .modal-backdrop')) return;
      pullStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    document.addEventListener('touchmove', (event) => {
      if (!pullStart) return;
      if (event.touches.length !== 1) { clearPull(); return; }
      const dx = Math.abs(event.touches[0].clientX - pullStart.x);
      const dy = event.touches[0].clientY - pullStart.y;
      if (dy < 0 || dx > 35 || window.scrollY > 0) { clearPull(); return; }
      pullDistance = dy;
      if (dy > 15) {
        if (event.cancelable) event.preventDefault();
        $('pullRefreshStatus').hidden = false;
        $('pullRefreshStatus').textContent = dy >= 85 ? 'Solte para atualizar' : 'Puxe para atualizar';
      }
    }, { passive: false });
    document.addEventListener('touchend', () => {
      const shouldRefresh = pullStart && pullDistance >= 85;
      clearPull();
      if (shouldRefresh) refreshSnapshot();
    }, { passive: true });
    document.addEventListener('touchcancel', clearPull, { passive: true });
    $('categoryFilter').addEventListener('change', (event) => { state.categoryId = event.target.value; renderGames(); });
    $('leaveDeviceButton').addEventListener('click', () => { forgetAccess(); render(); showToast('Acesso removido somente deste aparelho.'); });
    $('copyAccessCodeButton').addEventListener('click', () => copyText(state.access?.access_code || ''));
    $('copyNewAccessCodeButton').addEventListener('click', () => copyText($('newAccessCode').textContent));
    $('finishRegistrationButton').addEventListener('click', () => {
      $('accessCodeModal').hidden = true;
      document.body.style.overflow = '';
      setBackgroundInert(false);
      state.activeTab = 'games';
      render();
    });
    $('registerPhone').addEventListener('input', (event) => {
      const value = event.target.value.replace(/\D/g, '').slice(0, 11);
      event.target.value = value.length > 10
        ? value.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3')
        : value.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
    });
    $('resumeCode').addEventListener('input', (event) => {
      const value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      event.target.value = value.length > 4 ? `${value.slice(0, 4)}-${value.slice(4)}` : value;
    });
    document.addEventListener('keydown', (event) => {
      trapModalFocus(event);
      const activeTab = event.target.closest && event.target.closest('[data-tab]');
      if (activeTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        const tabs = Array.from(document.querySelectorAll('[data-tab]'));
        let index = tabs.indexOf(activeTab);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = tabs.length - 1;
        else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[index].focus();
        switchTab(tabs[index].dataset.tab);
      }
      if (event.key === 'Escape' && !$('registrationModal').hidden) closeRegistration();
    });
  }

  async function init() {
    bindEvents();
    // Close visible choices at the deadline even when the page stays open.
    // The database independently enforces the same cutoff on every save.
    setInterval(() => {
      if (document.hidden || !state.data?.matches) return;
      if (state.data.matches.some((match) => !match.locked && predictionDeadlineReached(match))) {
        state.data.matches.forEach((match) => {
          if (predictionDeadlineReached(match)) { match.locked = true; match.lock_reason = 'CLOSED'; }
        });
        renderGames();
      }
    }, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.data?.available) refreshSnapshot();
    });
    try {
      const [config, snapshot] = await Promise.all([
        api('?config=1'),
        api(`?torneio=${encodeURIComponent(state.slug)}`),
      ]);
      state.config = config;
      state.data = snapshot.data;
      if (!state.data?.available) {
        showNotice('Ilha Bet em preparação', 'A organização ainda não abriu um desafio para este torneio. Volte em breve.', true);
        return;
      }
      state.slug = String(state.data.tournament?.slug || state.slug).trim().toLowerCase();
      await restoreSession();
      $('pageNotice').hidden = !state.sessionError;
      if (state.sessionError) showNotice('Seus palpites ainda não carregaram', state.sessionError, true);
      $('workspace').hidden = false;
      render();
    } catch (error) {
      showNotice('Não conseguimos carregar agora', error.message || 'Atualize a página em alguns instantes.', true);
    }
  }

  init();
})();
