(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.chapter')];
  const dots = [...document.querySelectorAll('.chapter-dots a')];
  const currentChapter = document.querySelector('#current-chapter');
  const currentTitle = document.querySelector('#current-title');
  document.querySelector('#total-chapters').textContent = `/ ${String(sections.length).padStart(2, '0')}`;
  const previous = document.querySelector('#previous-chapter');
  const next = document.querySelector('#next-chapter');
  const progress = document.querySelector('#reading-progress');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeSection = 0;
  let navigationReady = false;
  let scheduled = false;

  function updateNavigation() {
    scheduled = false;
    const checkpoint = window.innerHeight * .42;
    let visible = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= checkpoint) visible = index;
    });
    if (navigationReady && visible !== activeSection) document.dispatchEvent(new CustomEvent('ilha:chapterchange', { detail: { direction: visible > activeSection ? 1 : -1 } }));
    navigationReady = true;
    activeSection = visible;
    currentChapter.textContent = String(visible + 1).padStart(2, '0');
    currentTitle.textContent = sections[visible].dataset.title;
    previous.disabled = visible === 0;
    next.disabled = visible === sections.length - 1;
    dots.forEach((dot, index) => {
      if (index === visible) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${distance > 0 ? Math.min(100, Math.max(0, window.scrollY / distance * 100)) : 100}%`;
  }
  function requestNavigationUpdate() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateNavigation); }
  }
  function goToSection(index) {
    const section = sections[Math.max(0, Math.min(sections.length - 1, index))];
    section.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${section.id}`);
  }
  previous.addEventListener('click', () => goToSection(activeSection - 1));
  next.addEventListener('click', () => goToSection(activeSection + 1));
  window.addEventListener('scroll', requestNavigationUpdate, { passive: true });
  window.addEventListener('resize', requestNavigationUpdate);
  window.addEventListener('load', updateNavigation);
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('a, button, input, textarea, select, [role="tab"], [role="tabpanel"], [contenteditable="true"]')) return;
    if (event.key === 'PageDown' || event.key === 'ArrowDown') { event.preventDefault(); goToSection(activeSection + 1); }
    if (event.key === 'PageUp' || event.key === 'ArrowUp') { event.preventDefault(); goToSection(activeSection - 1); }
  });
  updateNavigation();

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: .08 });
    document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
    document.documentElement.classList.add('motion-ready');
  }

  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#chapter-menu');
  function closeMenu(returnFocus = false) {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuButton.focus();
  }
  menuButton.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    menuButton.setAttribute('aria-expanded', String(opening));
  });
  menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('click', event => { if (!menu.hidden && !menu.contains(event.target) && !menuButton.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) closeMenu(true); });
  window.matchMedia('(min-width: 1001px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

  const events = [
    { name: 'Jogos de Verão Colatina', timing: '2027 · NOVA EDIÇÃO PREVISTA', copy: 'Tênis, beach tennis, futevôlei e vôlei. Opção de ativação: espaço Cresol na recepção e desafio de precisão nos intervalos.', date: 'Data de 2027 a confirmar.', image: 'jogos-de-verao.jpg', alt: 'Arte original dos Jogos de Verão Colatina com tênis, beach tennis, futevôlei e vôlei', note: 'Arte da edição anterior' },
    { name: 'Open de Tênis', timing: '2027 · REFERÊNCIA: MAIO', copy: 'Torneio regional com atletas de diferentes cidades. Opção de ativação: nome Cresol no torneio, materiais de competição e painel de premiação.', date: 'Mês de referência da proposta. Data e formato de 2027 a confirmar.', image: 'quadras.jpg', alt: 'Quadras de saibro do Ilha Tênis Colatina', note: 'Estrutura do clube' },
    { name: 'Etapa Estadual de Tênis · FET', timing: '2027 · DATA EM NEGOCIAÇÃO', copy: 'Etapa estadual em negociação com a Federação de Tênis. Opção de ativação: placas nas quadras e marca nos conteúdos da cobertura, a combinar com a organização.', date: 'Realização e data sujeitas à confirmação com a Federação.', image: 'evandro.jpg', alt: 'Atleta jogando tênis no saibro do Ilha', note: 'Registro do acervo do Ilha' },
    { name: 'Cincate · 1ª etapa', timing: '2027 · PRIMEIRA ETAPA', copy: 'O Cincate é o Circuito Noroeste Capixaba de Tênis. A primeira das duas etapas previstas no Ilha em 2027 integra o calendário regional. Opção de ativação: marca Cresol nas chamadas e nos clipes das partidas.', date: 'Data da primeira etapa a confirmar.', image: 'cincate-original.png', imageKind: 'logo', alt: 'Logo original do Cincate — Circuito Noroeste Capixaba de Tênis', note: 'Cincate · logo original' },
    { name: 'Cincate · 2ª etapa', timing: '2027 · SEGUNDA ETAPA', copy: 'Segunda etapa do Circuito Noroeste Capixaba de Tênis prevista no Ilha em 2027, dando sequência à participação do clube no circuito regional. Opção de ativação: marca Cresol no painel de premiação e nas fotos de pódio.', date: 'Data da segunda etapa a confirmar.', image: 'cincate-original.png', imageKind: 'logo', alt: 'Logo original do Cincate — Circuito Noroeste Capixaba de Tênis', note: 'Cincate · logo original' },
    { name: 'Copa Dupla Falta · 2 etapas', timing: '2027 · DUAS ETAPAS', copy: 'Duas etapas previstas. Opção de ativação: desafio de duplas nos intervalos e entrega de troféus com representante da Cresol.', date: 'Datas das duas etapas a confirmar.', image: 'drone/ilha-vista-aerea-tratada-800.webp', alt: 'Vista aérea tratada do Ilha Tênis Colatina', note: '2 etapas previstas · imagem tratada do clube' },
    { name: 'Torneios de Beach Tennis', timing: '2027 · AO LONGO DO ANO', copy: 'Torneios ao longo do ano. Opção de ativação: clínica de beach tennis para cooperados e desafio de precisão com a identidade Cresol.', date: 'Edições e datas a definir no calendário anual.', image: 'ilha-aerea.jpg', alt: 'Vista aérea das quadras de areia e tênis do Ilha', note: 'Estrutura do clube' },
    { name: 'Quarta Universitária', timing: '2027 · AO LONGO DO ANO', copy: 'Evento social com música para alunos e convidados. Opção de ativação: recepção Cresol no Ilha Bar e painel para fotos.', date: 'Programação e datas a confirmar.', image: 'convivencia.jpg', alt: 'Público reunido na área de convivência do Ilha à noite', note: 'Registro aprimorado com IA' },
    { name: 'Torneio Interno', timing: '2027 · CALENDÁRIO DO CLUBE', copy: 'Competição entre alunos e atletas do clube. Opção de ativação: melhores momentos com a marca e entrega de medalhas na premiação.', date: 'Data e formato da próxima edição a confirmar.', image: 'evandro.jpg', alt: 'Atleta do clube durante uma partida de tênis', note: 'Registro do acervo do Ilha' },
    { name: 'Ilha Tênis Summer', timing: '2027 · NOVA EDIÇÃO PREVISTA', copy: 'Nova edição prevista. Opção de ativação: circuito de experimentação esportiva para convidados e recepção no Ilha Bar.', date: 'Realização, data e formato a confirmar.', image: 'quadras.jpg', alt: 'Quadras de tênis do Ilha em um dia de sol', note: 'Estrutura do clube' }
  ];
  const tabs = [...document.querySelectorAll('[data-event]')];
  const eventPanel = document.querySelector('#event-panel');
  function animatePanel(element) {
    if (reducedMotion.matches) return;
    element.classList.remove('panel-changing');
    void element.offsetWidth;
    element.classList.add('panel-changing');
  }
  function selectEvent(index, moveFocus = false) {
    const selected = events[index];
    tabs.forEach((tab, position) => { tab.setAttribute('aria-selected', String(position === index)); tab.tabIndex = position === index ? 0 : -1; });
    eventPanel.setAttribute('aria-labelledby', tabs[index].id);
    document.querySelector('#event-name').textContent = selected.name;
    document.querySelector('#event-timing').textContent = selected.timing;
    document.querySelector('#event-copy').textContent = selected.copy;
    document.querySelector('#event-date').textContent = selected.date;
    const image = document.querySelector('#event-image');
    image.src = `/cresol/assets/${selected.image}`;
    image.alt = selected.alt;
    eventPanel.dataset.imageKind = selected.imageKind || 'photo';
    document.querySelector('#event-image-note').textContent = selected.note;
    animatePanel(eventPanel);
    if (moveFocus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectEvent(index));
    tab.addEventListener('keydown', event => {
      let target = index;
      if (event.key === 'ArrowDown') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowUp') target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      selectEvent(target, true);
    });
  });

  const gameIdeas = [
    { title: 'Placas e banners Cresol', copy: 'Banners nas quadras virtuais e placa no acesso ao Ilha Bar, visíveis durante a exploração do clube.' },
    { title: 'Desafio Cresol de precisão', copy: 'Sequência curta de saques ou rebatidas em alvos. A campanha dá nome ao desafio e aparece na tela de resultado.' },
    { title: 'Medalha e item de campanha', copy: 'Medalha digital e opção de camiseta Cresol para quem concluir o desafio. Recompensas visuais dentro do jogo.' }
  ];
  const gameTabs = [...document.querySelectorAll('[data-game-idea]')];
  const gameIdeaPanel = document.querySelector('#game-idea');
  function selectGameIdea(index, moveFocus = false) {
    gameTabs.forEach((tab, position) => { tab.setAttribute('aria-selected', String(position === index)); tab.tabIndex = position === index ? 0 : -1; });
    gameIdeaPanel.setAttribute('aria-labelledby', gameTabs[index].id);
    document.querySelector('#game-idea-number').textContent = String(index + 1).padStart(2, '0');
    document.querySelector('#game-idea-title').textContent = gameIdeas[index].title;
    document.querySelector('#game-idea-copy').textContent = gameIdeas[index].copy;
    animatePanel(gameIdeaPanel);
    if (moveFocus) gameTabs[index].focus();
  }
  gameTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectGameIdea(index));
    tab.addEventListener('keydown', event => {
      let target = index;
      if (event.key === 'ArrowRight') target = (index + 1) % gameTabs.length;
      else if (event.key === 'ArrowLeft') target = (index - 1 + gameTabs.length) % gameTabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = gameTabs.length - 1;
      else return;
      event.preventDefault();
      selectGameIdea(target, true);
    });
  });

})();
