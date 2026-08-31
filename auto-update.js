(function () {
  'use strict';
  if (window.location.protocol === 'file:') return;
  var appVersionKey = 'ilha:app-version';
  var reloadVersionKey = 'ilha:reloaded-version';
  var updateStorageKey = 'ilha:app-update-broadcast';
  var updateChannelName = 'ilha-app-updates-v2';
  var updateChannel = null;
  var currentVersion = '';
  var checking = false;
  var reloading = false;
  var deferredReloadTimer = null;
  var workerUpdatePromise = null;
  var versionPollInterval = 60000;
  var serviceWorkerPollInterval = 300000;

  function storageGet(storageName, key) {
    try { return window[storageName].getItem(key); } catch (error) { return null; }
  }
  function storageSet(storageName, key, value) {
    try { window[storageName].setItem(key, value); return true; } catch (error) { return false; }
  }

  function sensitiveAuthFlowActive() {
    if (document.body && document.body.classList.contains('admin-recovery-active')) return true;
    var clientRecovery = document.getElementById('newPasswordForm');
    return Boolean(clientRecovery && !clientRecovery.hidden);
  }
  function reloadForVersion(version) {
    var next = String(version || 'app-update');
    if (reloading || storageGet('sessionStorage', reloadVersionKey) === next) return;
    if (sensitiveAuthFlowActive()) {
      if (deferredReloadTimer) window.clearTimeout(deferredReloadTimer);
      deferredReloadTimer = window.setTimeout(function () {
        deferredReloadTimer = null;
        reloadForVersion(next);
      }, 15000);
      return;
    }
    reloading = true;
    storageSet('sessionStorage', reloadVersionKey, next);
    window.location.reload();
  }
  function broadcast(version) {
    var message = { type: 'APP_UPDATED', version: String(version), at: Date.now() };
    if (updateChannel) try { updateChannel.postMessage(message); } catch (error) {}
    storageSet('localStorage', updateStorageKey, JSON.stringify(message));
  }
  async function fetchAppVersion() {
    var response = await fetch('/app-version.json?ts=' + Date.now(), {
      cache: 'no-store', credentials: 'same-origin', headers: { 'Cache-Control': 'no-cache, no-store' }
    });
    if (!response.ok) return '';
    var data = await response.json();
    return String(data && data.version || '');
  }
  async function updateServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (workerUpdatePromise) return workerUpdatePromise;
    workerUpdatePromise = (async function () {
      try {
        var registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
        await registration.update();
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch (error) {
        // O aplicativo continua funcional e tenta atualizar novamente no próximo ciclo.
      }
    })().finally(function () { workerUpdatePromise = null; });
    return workerUpdatePromise;
  }
  async function checkForUpdate() {
    if (checking || reloading || document.hidden) return;
    checking = true;
    try {
      var nextVersion = await fetchAppVersion();
      if (!nextVersion) return;
      var storedVersion = storageGet('localStorage', appVersionKey) || '';
      if (!currentVersion) currentVersion = storedVersion || nextVersion;
      if (!storedVersion) storageSet('localStorage', appVersionKey, nextVersion);
      if (nextVersion !== currentVersion || (storedVersion && nextVersion !== storedVersion)) {
        currentVersion = nextVersion;
        storageSet('localStorage', appVersionKey, nextVersion);
        broadcast('release:' + nextVersion);
        await updateServiceWorker();
        reloadForVersion('release:' + nextVersion);
      }
    } catch (error) {
      // Sem conexão: mantém a tela funcionando e tenta novamente depois.
    } finally { checking = false; }
  }
  function receive(message) {
    if (!message || message.type !== 'APP_UPDATED') return;
    var version = String(message.version || message.cache || 'app-update');
    reloadForVersion(version);
  }
  if ('BroadcastChannel' in window) {
    try {
      updateChannel = new BroadcastChannel(updateChannelName);
      updateChannel.addEventListener('message', function (event) { receive(event.data); });
    } catch (error) {
      updateChannel = null;
    }
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== updateStorageKey || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch (error) {}
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (event) { receive(event.data); });
  checkForUpdate();
  updateServiceWorker();
  setInterval(checkForUpdate, versionPollInterval);
  setInterval(updateServiceWorker, serviceWorkerPollInterval);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkForUpdate(); updateServiceWorker(); } });
  ['focus', 'online', 'pageshow'].forEach(function (name) {
    window.addEventListener(name, function () { checkForUpdate(); updateServiceWorker(); });
  });
  window.addEventListener('beforeunload', function () {
    if (deferredReloadTimer) window.clearTimeout(deferredReloadTimer);
    if (updateChannel) updateChannel.close();
  });
})();
