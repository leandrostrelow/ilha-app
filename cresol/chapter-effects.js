(() => {
  const layer = document.querySelector('.chapter-ball-pass');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let lastPass = -Infinity;
  let animations = [];
  function stop() {
    animations.forEach(animation => animation.cancel());
    animations = [];
    layer.replaceChildren();
  }
  document.addEventListener('ilha:chapterchange', event => {
    if (reducedMotion.matches || document.hidden || document.querySelector('dialog[open]') || performance.now() - lastPass < 900) return;
    lastPass = performance.now();
    stop();
    const forward = event.detail.direction > 0;
    const width = innerWidth, height = innerHeight;
    [0, 1].forEach(index => {
      const ball = document.createElement('span');
      ball.className = `chapter-tennis-ball${forward ? '' : ' reverse'}`;
      const trail = document.createElement('span');
      trail.className = 'chapter-ball-trail';
      const sphere = document.createElement('span');
      sphere.className = 'chapter-ball-sphere';
      ball.append(trail, sphere);
      layer.append(ball);
      const start = forward ? -150 : width + 150;
      const end = forward ? width + 150 : -150;
      const offset = index * 55;
      const pass = ball.animate([
        { transform: `translate3d(${start}px,${height * .56 - offset}px,0)`, opacity: 0 },
        { transform: `translate3d(${width * (forward ? .2 : .8)}px,${height * .68 - offset}px,0)`, opacity: .95, offset: .28 },
        { transform: `translate3d(${width * (forward ? .62 : .38)}px,${height * .4 - offset}px,0)`, opacity: .95, offset: .65 },
        { transform: `translate3d(${end}px,${height * .6 - offset}px,0)`, opacity: 0 }
      ], { duration: 1100, delay: index * 130, easing: 'linear', fill: 'both' });
      const spin = sphere.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${forward ? 630 : -630}deg)` }], { duration: 1100, delay: index * 130, fill: 'both' });
      animations.push(pass, spin);
      pass.finished.then(() => ball.remove()).catch(() => {});
    });
  });
  reducedMotion.addEventListener('change', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
