(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.chapter')];
  const dots = [...document.querySelectorAll('.chapter-dots a')];
  const currentChapter = document.querySelector('#current-chapter');
  const currentTitle = document.querySelector('#current-title');
  const previous = document.querySelector('#previous-chapter');
  const next = document.querySelector('#next-chapter');
  const progress = document.querySelector('#reading-progress');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeSection = 0;
  let scheduled = false;

  function updateNavigation() {
    scheduled = false;
    const checkpoint = window.innerHeight * .42;
    let visible = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= checkpoint) visible = index;
    });
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
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('a, button, input, textarea, select, [role="tab"], [role="tabpanel"], [contenteditable="true"]')) return;
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
  window.matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

  const events = [
    { name: 'Jogos de Verão Colatina', timing: '2027 · NOVA EDIÇÃO PREVISTA', copy: 'Tênis, beach tennis, futevôlei e vôlei em uma experiência que reúne atletas e comunidade. A proposta contempla a presença da Cresol na próxima edição.', date: 'Data de 2027 a confirmar.', image: 'jogos-de-verao.jpg', alt: 'Arte original dos Jogos de Verão Colatina com tênis, beach tennis, futevôlei e vôlei', note: 'Arte da edição anterior' },
    { name: 'Open de Tênis', timing: '2027 · REFERÊNCIA: MAIO', copy: 'Um encontro regional de tênis com participação de atletas de diversas cidades. Oportunidade para naming rights, presença de marca e relacionamento ao longo da competição.', date: 'Mês de referência da proposta. Data e formato de 2027 a confirmar.', image: 'quadras.jpg', alt: 'Quadras de saibro do Ilha Tênis Colatina', note: 'Estrutura do clube' },
    { name: 'Etapa Estadual de Tênis · FET', timing: '2027 · DATA EM NEGOCIAÇÃO', copy: 'Proposta de etapa oficial da Federação de Tênis, reunindo atletas de todo o estado e ampliando a conexão do clube com o circuito capixaba.', date: 'Realização e data sujeitas à confirmação com a Federação.', image: 'evandro.jpg', alt: 'Atleta jogando tênis no saibro do Ilha', note: 'Registro do acervo do Ilha' },
    { name: '2ª etapa Cincate', timing: '2027 · REFERÊNCIA: SETEMBRO', copy: 'Continuação do circuito, com participação regional e público ligado ao esporte. A marca pode acompanhar jogos, materiais da competição e momentos de premiação.', date: 'Mês de referência da proposta. Calendário de 2027 a confirmar.', image: 'quadras.jpg', alt: 'Vista das quadras de tênis do Ilha durante o dia', note: 'Estrutura do clube' },
    { name: 'Torneios de Beach Tennis', timing: '2027 · AO LONGO DO ANO', copy: 'Competições periódicas que mobilizam alunos, frequentadores e convidados. Diferentes momentos para a Cresol participar da energia das quadras de areia.', date: 'Edições e datas a definir no calendário anual.', image: 'ilha-aerea.jpg', alt: 'Vista aérea das quadras de areia e tênis do Ilha', note: 'Estrutura do clube' },
    { name: 'Quarta Universitária', timing: '2027 · AO LONGO DO ANO', copy: 'Música, convivência e integração entre alunos e convidados. Uma experiência social para aproximar a marca do público e criar novas conexões.', date: 'Programação e datas a confirmar.', image: 'convivencia.jpg', alt: 'Público reunido na área de convivência do Ilha à noite', note: 'Registro aprimorado com IA' },
    { name: 'Torneio Interno', timing: '2027 · CALENDÁRIO DO CLUBE', copy: 'Uma competição para valorizar quem vive o Ilha no dia a dia. Atletas e alunos compartilham desafios, evolução e a celebração de cada conquista.', date: 'Data e formato da próxima edição a confirmar.', image: 'evandro.jpg', alt: 'Atleta do clube durante uma partida de tênis', note: 'Registro do acervo do Ilha' },
    { name: 'Ilha Tênis Summer', timing: '2027 · NOVA EDIÇÃO PREVISTA', copy: 'Esporte e encontros com a energia do verão. A proposta inclui a Cresol nas experiências e na comunicação da próxima edição do Ilha Tênis Summer.', date: 'Realização, data e formato a confirmar.', image: 'quadras.jpg', alt: 'Quadras de tênis do Ilha em um dia de sol', note: 'Estrutura do clube' }
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

  const spots = [
    { name: 'Acesso às quadras', copy: 'Bandeiras verticais nas entradas e junto aos acessos. A Cresol recebe os atletas e acompanha o fluxo de quem chega para jogar.' },
    { name: 'Alambrados e laterais', copy: 'Banners nos alambrados das quadras de tênis e beach tennis, com visibilidade durante jogos, treinos e registros de fotos e vídeos.' },
    { name: 'Circulação e convivência', copy: 'Placas e peças de marca no caminho entre quadras, arquibancadas e área social. Presença nos momentos de pausa, encontro e celebração.' }
  ];
  const pins = [...document.querySelectorAll('[data-spot]')];
  pins.forEach((pin, index) => pin.addEventListener('click', () => {
    pins.forEach((item, position) => item.setAttribute('aria-pressed', String(position === index)));
    document.querySelector('#spot-number').textContent = String(index + 1).padStart(2, '0');
    document.querySelector('#spot-name').textContent = spots[index].name;
    document.querySelector('#spot-copy').textContent = spots[index].copy;
    animatePanel(document.querySelector('.spot-readout'));
  }));
})();
