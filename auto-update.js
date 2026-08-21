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

  function reloadForVersion(version) {
    var next = String(version || 'app-update');
    if (reloading || sessionStorage.getItem(reloadVersionKey) === next) return;
    reloading = true;
    sessionStorage.setItem(reloadVersionKey, next);
    window.location.reload();
  }
  function broadcast(version) {
    var message = { type: 'APP_UPDATED', version: String(version), at: Date.now() };
    if (updateChannel) try { updateChannel.postMessage(message); } catch (error) {}
    try { localStorage.setItem(updateStorageKey, JSON.stringify(message)); } catch (error) {}
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
    try {
      var registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
      await registration.update();
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {}
  }
  async function checkForUpdate() {
    if (checking || reloading || document.hidden) return;
    checking = true;
    try {
      var nextVersion = await fetchAppVersion();
      if (!nextVersion) return;
      var storedVersion = localStorage.getItem(appVersionKey) || '';
      if (!currentVersion) currentVersion = storedVersion || nextVersion;
      if (!storedVersion) localStorage.setItem(appVersionKey, nextVersion);
      if (nextVersion !== currentVersion || (storedVersion && nextVersion !== storedVersion)) {
        currentVersion = nextVersion;
        localStorage.setItem(appVersionKey, nextVersion);
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
    var version = String(message.version || 'app-update');
    if (version.indexOf('ilha-play-') === 0) { updateServiceWorker(); return; }
    reloadForVersion(version);
  }
  if ('BroadcastChannel' in window) {
    updateChannel = new BroadcastChannel(updateChannelName);
    updateChannel.addEventListener('message', function (event) { receive(event.data); });
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== updateStorageKey || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch (error) {}
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (event) { receive(event.data); });
  checkForUpdate();
  updateServiceWorker();
  setInterval(checkForUpdate, 20000);
  setInterval(updateServiceWorker, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkForUpdate(); updateServiceWorker(); } });
  ['focus', 'online', 'pageshow'].forEach(function (name) {
    window.addEventListener(name, function () { checkForUpdate(); updateServiceWorker(); });
  });
  window.addEventListener('beforeunload', function () { if (updateChannel) updateChannel.close(); });
})();
