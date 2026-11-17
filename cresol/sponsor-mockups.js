import { LOGO_SOURCE, projectiveMatrix } from './brand-projection.js';
import { MOCKUP_WIDTH, SPONSOR_PLACEMENTS } from './sponsor-placements.js';

const mounted = new Map();
function renderLogos(media) {
  const scale = media.clientWidth / MOCKUP_WIDTH;
  const planes = mounted.get(media);
  if (!planes || !scale) return;
  planes.forEach(({ image, corners }) => {
    const matrix = projectiveMatrix(corners.map(([x,y]) => [x*scale,y*scale]));
    image.hidden = !matrix;
    if (matrix) image.style.transform = `matrix3d(${matrix.join(',')})`;
  });
}
const resize = new ResizeObserver(entries => entries.forEach(({ target }) => renderLogos(target)));
function mountArtwork(media) {
  const placements = SPONSOR_PLACEMENTS[media.dataset.sponsorArt];
  if (!placements) return;
  const layer = document.createElement('span');
  layer.className = 'sponsor-logo-layer';
  layer.setAttribute('aria-hidden','true');
  mounted.set(media, placements.map(corners => {
    const image = document.createElement('img');
    image.src = LOGO_SOURCE;
    image.alt = '';
    image.width = 1664;
    image.height = 1080;
    image.className = 'sponsor-logo';
    layer.append(image);
    return { image, corners };
  }));
  media.append(layer);
  resize.observe(media);
  renderLogos(media);
}
document.querySelectorAll('[data-sponsor-art]').forEach(mountArtwork);

const dialog = document.querySelector('#sponsor-dialog');
const expanded = document.querySelector('#sponsor-expanded-art');
let opener = null;
document.querySelectorAll('[data-sponsor-open]').forEach(button => button.addEventListener('click', () => {
  opener = button;
  const source = button.querySelector('.sponsor-media');
  const media = document.createElement('span');
  media.className = 'sponsor-media';
  media.dataset.sponsorArt = source.dataset.sponsorArt;
  const photo = source.querySelector('img').cloneNode();
  photo.loading = 'eager';
  media.append(photo);
  expanded.replaceChildren(media);
  document.querySelector('#sponsor-dialog-title').textContent = media.dataset.sponsorArt === 'tenis' ? 'Cresol nas quadras de tênis' : 'Cresol nas quadras de areia';
  dialog.showModal();
  document.documentElement.classList.add('sponsor-is-open');
  mountArtwork(media);
}));
document.querySelector('#sponsor-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => {
  const media = expanded.querySelector('.sponsor-media');
  if (media) { resize.unobserve(media); mounted.delete(media); }
  expanded.replaceChildren();
  document.documentElement.classList.remove('sponsor-is-open');
  opener?.focus({ preventScroll:true });
});
