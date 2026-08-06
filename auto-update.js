(function () {
  'use strict';

  var currentDocumentVersion = '';
  var checking = false;
  var reloading = false;

  async function documentVersion() {
    var response = await fetch(window.location.href, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) return '';
    return response.headers.get('etag') || [
      response.headers.get('last-modified') || '',
      response.headers.get('content-length') || ''
    ].join(':');
  }

  async function checkForAppUpdate() {
    if (checking || reloading || document.hidden || window.location.protocol === 'file:') return;
    checking = true;
    try {
      var nextVersion = await documentVersion();
      if (!nextVersion) return;
      if (!currentDocumentVersion) {
        currentDocumentVersion = nextVersion;
        return;
      }
      if (nextVersion !== currentDocumentVersion) {
        reloading = true;
        window.location.reload();
      }
    } catch (error) {
      // Sem conexão: mantém a tela funcionando e tenta novamente depois.
    } finally {
      checking = false;
    }
  }

  async function updateServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      var registration = await navigator.serviceWorker.getRegistration();
      if (registration) await registration.update();
    } catch (error) {}
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  checkForAppUpdate();
  setInterval(checkForAppUpdate, 12000);
  setInterval(updateServiceWorker, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      checkForAppUpdate();
      updateServiceWorker();
    }
  });
  window.addEventListener('focus', checkForAppUpdate);
  window.addEventListener('online', checkForAppUpdate);
})();
