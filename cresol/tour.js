(() => {
  'use strict';
  const dialog = document.querySelector('#tour-dialog');
  const panorama = document.querySelector('#tour-panorama');
  const sceneSelect = document.querySelector('#tour-scene-select');
  const status = document.querySelector('#tour-status');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pins = [...document.querySelectorAll('[data-tour-scene]')];
  const places = pins.map(pin => ({ id: pin.dataset.tourScene, title: pin.dataset.title, number: pin.dataset.number, url: pin.href }));
  const previous = document.querySelector('#tour-previous');
  const next = document.querySelector('#tour-next');
  const viewControls = [...document.querySelectorAll('[data-pan-control]')];
  const fullscreen = document.querySelector('#tour-fullscreen');
  let viewer = null;
  let current = 0;
  let opener = null;
  let loading = false;
  let widePanorama = false;

  function setLoading(value) {
    loading = value;
    panorama.setAttribute('aria-busy', String(value));
    previous.disabled = value || current === 0;
    next.disabled = value || current === places.length - 1;
    sceneSelect.disabled = value;
    viewControls.forEach(button => { button.disabled = value; });
  }
  function showInfo(index) {
    current = index;
    const place = places[index];
    document.querySelector('#tour-dialog-title').textContent = place.title;
    document.querySelector('#tour-original').href = place.url;
    sceneSelect.value = place.id;
    status.textContent = `Carregando ponto ${place.number} de ${places.length}…`;
    setLoading(true);
  }
  function useLargePanorama() {
    if (!window.matchMedia('(min-width: 900px)').matches || navigator.connection?.saveData) return false;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return false;
    const supportsLarge = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return supportsLarge;
  }
  function failed() {
    status.textContent = 'Não foi possível abrir a vista 360°. Tente outro ponto ou use “Abrir foto”.';
    setLoading(false);
    viewControls.forEach(button => { button.disabled = true; });
  }
  function openTour(id, source) {
    const index = places.findIndex(place => place.id === id);
    if (index < 0 || !window.pannellum || typeof dialog.showModal !== 'function') return false;
    opener = source;
    dialog.showModal();
    document.documentElement.classList.add('tour-is-open');
    showInfo(index);
    widePanorama = useLargePanorama();
    const scenes = Object.fromEntries(places.map(place => [place.id, {
      type: 'equirectangular', panorama: widePanorama ? place.url.replace('-4096.webp', '-6144.webp') : place.url,
      preview: `/cresol/assets/tour/ponto-${place.number}-preview.webp`, pitch: 0, yaw: ({ deck: 85, pickleball: 90 })[place.id] || 0, hfov: 100
    }]));
    try {
      viewer = window.pannellum.viewer(panorama, {
        default: { firstScene: id, sceneFadeDuration: reducedMotion.matches ? 0 : 350, autoLoad: true, showControls: false,
          escapeHTML: true, minHfov: 45, maxHfov: 115, mouseZoom: true, keyboardZoom: true,
          strings: { loadingLabel: 'Abrindo o Ilha…', loading: 'Carregando', loadButtonLabel: 'Abrir foto 360°',
            genericWebGLError: 'A vista 360° não está disponível neste navegador. Use “Abrir foto”.',
            noWebGLError: 'Seu navegador não oferece visualização 360°. Use “Abrir foto”.',
            fileAccessError: 'Não foi possível carregar esta foto. Tente outro ponto ou use “Abrir foto”.' }
        }, scenes
      });
      viewer.on('load', () => { if (!dialog.open) return; status.textContent = ''; setLoading(false); });
      viewer.on('error', failed);
      requestAnimationFrame(() => viewer?.resize());
    } catch { failed(); }
    return true;
  }
  function selectScene(index) {
    if (!viewer || loading || index < 0 || index >= places.length || index === current) return;
    showInfo(index);
    try { viewer.loadScene(places[index].id); } catch { failed(); }
  }
  [...pins, ...document.querySelectorAll('[data-tour-open]')].forEach(link => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      if (openTour(link.dataset.tourScene || link.dataset.tourOpen, link)) event.preventDefault();
    });
  });
  previous.addEventListener('click', () => selectScene(current - 1));
  next.addEventListener('click', () => selectScene(current + 1));
  sceneSelect.addEventListener('change', () => selectScene(places.findIndex(place => place.id === sceneSelect.value)));
  document.querySelector('#tour-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
    viewer?.destroy();
    viewer = null;
    panorama.replaceChildren();
    document.documentElement.classList.remove('tour-is-open');
    status.textContent = '';
    opener?.focus({ preventScroll: true });
  });
  viewControls.forEach(button => button.addEventListener('click', () => {
    if (!viewer || loading) return;
    const animate = reducedMotion.matches ? false : 250;
    const action = button.dataset.panControl;
    if (action === 'left' || action === 'right') viewer.setYaw(viewer.getYaw() + (action === 'left' ? -25 : 25), animate);
    else viewer.setHfov(Math.max(45, Math.min(115, viewer.getHfov() + (action === 'in' ? -15 : 15))), animate);
  }));
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === dialog) await document.exitFullscreen();
      else await dialog.requestFullscreen();
    } catch { status.textContent = 'A tela cheia não está disponível. Você pode continuar explorando aqui.'; }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.setAttribute('aria-label', document.fullscreenElement === dialog ? 'Sair da tela cheia' : 'Ver tour em tela cheia');
    viewer?.resize();
  });
  const mapImage = document.querySelector('#tour-map-image');
  const mapButtons = [...document.querySelectorAll('[data-map-view]')];
  mapButtons.forEach(button => button.addEventListener('click', () => {
    const photo = button.dataset.mapView === 'photo';
    mapImage.src = `/cresol/assets/tour/${photo ? 'foto-aerea' : 'mapa-ilustrado'}.webp`;
    mapImage.alt = photo ? 'Foto aérea original do Ilha Tênis, com pontos para abrir as fotos 360°' : 'Mapa ilustrado do Ilha a partir da foto de drone, com pontos para abrir as fotos 360°';
    mapButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
})();
