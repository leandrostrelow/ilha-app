(function () {
  'use strict';

  if (window.location.protocol === 'file:') return;

  var pageVersionKey = 'ilha:auto-version:' + window.location.pathname;
  var appliedUpdateKey = 'ilha:applied-app-update';
  var updateStorageKey = 'ilha:app-update-broadcast';
  var updateChannelName = 'ilha-app-updates-v1';
  var currentDocumentVersion = sessionStorage.getItem(pageVersionKey) || '';
  var updateChannel = null;
  var checking = false;
  var reloading = false;

  function reloadOnce(version) {
    var nextVersion = String(version || 'app-update');
    if (reloading || sessionStorage.getItem(appliedUpdateKey) === nextVersion) return;
    reloading = true;
    sessionStorage.setItem(appliedUpdateKey, nextVersion);
    window.location.reload();
  }

  function notifyOtherOpenPages(version) {
    var message = {
      type: 'APP_UPDATED',
      version: String(version || 'app-update'),
      at: Date.now()
    };
    if (updateChannel) {
      try { updateChannel.postMessage(message); } catch (error) { updateChannel = null; }
    }
    try { localStorage.setItem(updateStorageKey, JSON.stringify(message)); } catch (error) {}
  }

  function applyGlobalUpdate(version, shouldBroadcast) {
    var nextVersion = String(version || 'app-update');
    if (shouldBroadcast) notifyOtherOpenPages(nextVersion);
    reloadOnce(nextVersion);
  }

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

  async function checkForPageUpdate() {
    if (checking || reloading || document.hidden) return;
    checking = true;
    try {
      var nextVersion = await documentVersion();
      if (!nextVersion) return;
      if (!currentDocumentVersion) {
        currentDocumentVersion = nextVersion;
        sessionStorage.setItem(pageVersionKey, nextVersion);
        return;
      }
      if (nextVersion !== currentDocumentVersion) {
        currentDocumentVersion = nextVersion;
        sessionStorage.setItem(pageVersionKey, nextVersion);
        reloadOnce('page:' + window.location.pathname + ':' + nextVersion);
      }
    } catch (error) {
      // Sem conexão: mantém a tela funcionando e tenta novamente depois.
    } finally {
      checking = false;
    }
  }

  async function registerAndCheckServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      var registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      await registration.update();
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {}
  }

  function listenForGlobalUpdates() {
    if ('BroadcastChannel' in window) {
      updateChannel = new BroadcastChannel(updateChannelName);
      updateChannel.addEventListener('message', function (event) {
        var message = event.data || {};
        if (message.type === 'APP_UPDATED') reloadOnce(message.version);
      });
    }

    window.addEventListener('storage', function (event) {
      if (event.key !== updateStorageKey || !event.newValue) return;
      try {
        var message = JSON.parse(event.newValue);
        if (message.type === 'APP_UPDATED') reloadOnce(message.version);
      } catch (error) {}
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.type !== 'APP_UPDATED') return;
        applyGlobalUpdate(data.cache || data.version || 'service-worker-update', true);
      });
    }
  }

  listenForGlobalUpdates();
  checkForPageUpdate();
  registerAndCheckServiceWorker();

  setInterval(function () {
    checkForPageUpdate();
    registerAndCheckServiceWorker();
  }, 60000);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      checkForPageUpdate();
      registerAndCheckServiceWorker();
    }
  });
  window.addEventListener('focus', function () {
    checkForPageUpdate();
    registerAndCheckServiceWorker();
  });
  window.addEventListener('online', function () {
    checkForPageUpdate();
    registerAndCheckServiceWorker();
  });
  window.addEventListener('beforeunload', function () {
    if (updateChannel) updateChannel.close();
    updateChannel = null;
  });
})();
