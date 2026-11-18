(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const svgNS = 'http://www.w3.org/2000/svg';
  const chapters = [...document.querySelectorAll('.chapter')].map(section => {
    const ball = document.createElementNS(svgNS, 'svg');
    ball.setAttribute('class', 'chapter-ball-outline');
    ball.setAttribute('viewBox', '0 0 200 200');
    ball.setAttribute('aria-hidden', 'true');
    ball.setAttribute('focusable', 'false');
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '100');
    circle.setAttribute('cy', '100');
    circle.setAttribute('r', '96');
    const seams = document.createElementNS(svgNS, 'path');
    seams.setAttribute('d', 'M 33.7 30.6 C 111 54 111 146 33.7 169.4 M 166.3 30.6 C 89 54 89 146 166.3 169.4');
    ball.append(circle, seams);
    section.prepend(ball);
    return { section, ball };
  });
  let frame = 0;

  function render() {
    frame = 0;
    if (reducedMotion.matches || document.hidden) return;
    const height = innerHeight;
    const rotation = 24 + Math.max(0, scrollY) * .09;
    // Each chapter clips the same ball behind its content, so it continues
    // across color changes without covering photographs or controls.
    const visible = chapters.map(chapter => ({ ...chapter, rect: chapter.section.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= 0 && rect.top <= height);
    visible.forEach(({ ball, rect }) => {
      ball.style.transform = `translate3d(0,${height * .54 - rect.top}px,0) translateY(-50%) rotate(${rotation}deg)`;
    });
  }
  function schedule() {
    if (!frame && !reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(render);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();
})();
