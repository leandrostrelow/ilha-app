(function () {
  'use strict';

  var versionKey = 'ilha:auto-version:' + window.location.pathname;
  var reloadKey = 'ilha:auto-reload-done:' + window.location.pathname;
  var currentDocumentVersion = sessionStorage.getItem(versionKey) || '';
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
        sessionStorage.setItem(versionKey, nextVersion);
        return;
      }
      if (nextVersion !== currentDocumentVersion) {
        currentDocumentVersion = nextVersion;
        sessionStorage.setItem(versionKey, nextVersion);
        if (sessionStorage.getItem(reloadKey) !== '1') {
          sessionStorage.setItem(reloadKey, '1');
          reloading = true;
          window.location.reload();
        }
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

  checkForAppUpdate();
  updateServiceWorker();
  setInterval(checkForAppUpdate, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      checkForAppUpdate();
    }
  });
  window.addEventListener('focus', checkForAppUpdate);
  window.addEventListener('online', checkForAppUpdate);
})();
