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
    captchaWidgetId: null,
    captchaToken: '',
    captchaReady: false,
    savingMatchId: '',
    modalTrigger: null,
    pendingRegistrationRequestId: '',
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

  function ownPickMap() {
    return new Map((state.data?.participant?.predictions || []).map((pick) => [pick.match_id, pick.winner_athlete_id]));
  }

  function renderHeader() {
    const { tournament, campaign } = state.data;
    $('tournamentName').textContent = tournament.name;
    $('campaignStatus').textContent = statusLabel(campaign);
    const windowParts = [];
    if (campaign.closes_at) windowParts.push(`Até ${dateTimeLabel(campaign.closes_at)}`);
    else if (tournament.ends_on) windowParts.push(`Torneio até ${dateLabel(tournament.ends_on)}`);
    const matchCount = state.data.matches.length;
    windowParts.push(`${matchCount} ${matchCount === 1 ? 'jogo disponível' : 'jogos disponíveis'}`);
    $('campaignWindow').textContent = windowParts.join(' · ');
    $('heroTitle').firstChild.nodeValue = displayCampaignTitle(campaign.title);
    $('tournamentLink').href = `/torneios/${encodeURIComponent(tournament.slug)}`;
    $('rulesText').textContent = campaign.rules_text || 'Escolha um atleta por jogo. Cada acerto soma os pontos definidos para a fase. O ranking usa somente os resultados oficiais lançados pela organização.';
    $('initialPoints').textContent = campaign.initial_round_points;
    $('semifinalPoints').textContent = campaign.semifinal_points;
    $('finalPoints').textContent = campaign.final_points;
    $('prizeCard').hidden = !campaign.prize;
    $('prizeText').textContent = campaign.prize || '';
    $('joinButton').textContent = state.data.participant ? 'Ver meus jogos' : campaign.accepting_predictions ? 'Quero participar' : 'Palpites encerrados';
    $('joinButton').disabled = !state.data.participant && !campaign.accepting_predictions;
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

  function renderMatchCard(match, pickMap) {
    const selected = pickMap.get(match.id) || '';
    const isSaving = state.savingMatchId === match.id;
    const locked = Boolean(match.locked || isSaving);
    const settled = Boolean(match.winner_athlete_id);
    const choice = (side) => {
      const isSelected = selected === side.id;
      const isWinner = settled && match.winner_athlete_id === side.id;
      const isLoser = settled && selected === side.id && !isWinner;
      const classes = ['player-choice', isSelected ? 'selected' : '', isWinner ? 'winner' : '', isLoser ? 'loser' : ''].filter(Boolean).join(' ');
      const label = isWinner ? 'Venceu' : isSelected ? 'Seu palpite' : locked ? '' : 'Escolher';
      return `<button class="${classes}" type="button" data-pick data-match-id="${escapeHtml(match.id)}" data-athlete-id="${escapeHtml(side.id)}" ${locked ? 'disabled' : ''} aria-pressed="${isSelected}"><strong>${escapeHtml(side.name)}</strong><small>${escapeHtml(label)}</small></button>`;
    };
    const stateLabel = isSaving ? 'Salvando…' : settled ? `Resultado: ${escapeHtml(match.score || 'confirmado')}` : match.locked ? 'Palpite encerrado' : selected ? 'Palpite salvo' : 'Aberto';
    return `<article class="match-card">
      <div class="match-meta"><span>${escapeHtml(phaseLabel(match.phase))} · jogo ${escapeHtml(match.match_no || '')}</span><span class="points-badge">vale ${escapeHtml(match.points)} pt${Number(match.points) === 1 ? '' : 's'}</span></div>
      ${choice(match.side1)}${choice(match.side2)}
      <div class="match-foot"><span>${escapeHtml(matchSchedule(match))}</span><strong class="${match.locked ? 'locked-badge' : selected ? 'saved-badge' : ''}">${stateLabel}</strong></div>
    </article>`;
  }

  function renderGames() {
    const pickMap = ownPickMap();
    const visible = state.data.matches.filter((match) => !state.categoryId || match.category_id === state.categoryId);
    const categories = state.data.categories.filter((category) => visible.some((match) => match.category_id === category.id));
    if (!visible.length) {
      $('gamesList').innerHTML = '<div class="empty-state"><strong>Nenhum jogo disponível aqui.</strong>Assim que a organização publicar os confrontos completos, eles aparecem automaticamente.</div>';
      return;
    }
    $('gamesList').innerHTML = categories.map((category) => {
      const cards = visible.filter((match) => match.category_id === category.id).map((match) => renderMatchCard(match, pickMap)).join('');
      return `<section class="category-group"><h3 class="category-title">${escapeHtml(category.name)}</h3><div class="match-grid">${cards}</div></section>`;
    }).join('');
  }

  function renderMine() {
    const participant = state.data.participant;
    const accessEmpty = $('accessEmpty');
    const accessDetails = $('accessDetails');
    $('joinReminder').hidden = Boolean(participant) || !state.data.campaign.accepting_predictions;
    $('leaveDeviceButton').hidden = !participant;
    accessEmpty.hidden = Boolean(participant);
    accessDetails.hidden = !participant;
    if (!participant) {
      $('participantGreeting').textContent = 'Entre para ver e alterar suas escolhas.';
      $('myPickCount').textContent = '0';
      $('myPicksList').innerHTML = '';
      return;
    }
    const picks = ownPickMap();
    $('participantGreeting').textContent = `${participant.name}, acompanhe aqui tudo que você escolheu.`;
    $('savedAccessCode').textContent = state.access?.access_code || '••••••••••';
    $('myPickCount').textContent = String(picks.size);
    const selectedMatches = state.data.matches.filter((match) => picks.has(match.id));
    if (!selectedMatches.length) {
      $('myPicksList').innerHTML = '<div class="empty-state"><strong>Seu cartão ainda está vazio.</strong>Abra a aba Jogos e escolha seus favoritos.</div>';
      return;
    }
    $('myPicksList').innerHTML = selectedMatches.map((match) => {
      const athleteId = picks.get(match.id);
      const side = match.side1.id === athleteId ? match.side1 : match.side2;
      const correct = match.winner_athlete_id ? match.winner_athlete_id === athleteId : null;
      const outcome = correct === true ? `+${match.points} ponto${Number(match.points) === 1 ? '' : 's'}` : correct === false ? 'Não pontuou' : match.locked ? 'Aguardando resultado' : 'Ainda pode alterar';
      return `<article class="my-pick"><div><strong>${escapeHtml(side.name)}</strong><small>${escapeHtml(phaseLabel(match.phase))} · ${escapeHtml(matchSchedule(match))}</small></div><span>${escapeHtml(outcome)}</span></article>`;
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
      <div class="ranking-name"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.predictions)} palpites</small></div>
      <span class="ranking-stat">Pontos<b>${escapeHtml(row.score)}</b></span>
      <span class="ranking-stat">Acertos<b>${escapeHtml(row.correct)}</b></span>
      <span class="ranking-stat">Apurados<b>${escapeHtml(row.settled)}</b></span>
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
    if (!state.data?.participant || !state.access) {
      openRegistration('register');
      return;
    }
    if (state.savingMatchId) return;
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
      if (error.status === 401 || error.status === 403) forgetAccess();
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
    } catch (error) {
      if (error.status === 401 || error.status === 403) forgetAccess();
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

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button, a');
      if (!target) return;
      if (target.matches('[data-tab]')) switchTab(target.dataset.tab);
      if (target.matches('[data-open-registration]')) openRegistration('register');
      if (target.matches('[data-access-mode]')) setAccessMode(target.dataset.accessMode);
      if (target.matches('[data-pick]')) savePick(target.dataset.matchId, target.dataset.athleteId);
    });
    $('joinButton').addEventListener('click', () => state.data?.participant ? switchTab('games') : state.data?.campaign?.accepting_predictions ? openRegistration('register') : showToast('Os palpites não estão abertos neste momento.'));
    $('openAccessButton').addEventListener('click', () => state.data?.participant ? switchTab('mine') : openRegistration('resume'));
    $('closeRegistrationButton').addEventListener('click', closeRegistration);
    $('registrationModal').addEventListener('click', (event) => { if (event.target === $('registrationModal')) closeRegistration(); });
    $('registerForm').addEventListener('submit', register);
    $('resumeForm').addEventListener('submit', resume);
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
      $('pageNotice').hidden = true;
      $('workspace').hidden = false;
      render();
    } catch (error) {
      showNotice('Não conseguimos carregar agora', error.message || 'Atualize a página em alguns instantes.', true);
    }
  }

  init();
})();
