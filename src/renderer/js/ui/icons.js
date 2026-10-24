// Simple outline icons (24x24, stroke only). Drawn for this app; no emojis anywhere.
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 8H6.2M9 20.5h.01M17 20.5h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  layers: 'M12 3 2 8.5 12 14l10-5.5zM2 13.5 12 19l10-5.5',
  truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3.5 3.5 0 0 1 0 6.8',
  user: 'M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  building: 'M4 21V5l8-2v18M12 7l8 2v12M2 21h20M7.5 8h1M7.5 12h1M7.5 16h1M15.5 12h1M15.5 16h1',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  cloud: 'M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 12a3.5 3.5 0 0 1-2.5 7z',
  cloudOff: 'M2 2l20 20M5.8 8.8A5 5 0 0 0 8 19h9.5M20.6 16.6A3.5 3.5 0 0 0 20 12a6 6 0 0 0-8.7-5.4',
  refresh: 'M20 11a8 8 0 0 0-14.7-4.3L3 9M3 4v5h5M4 13a8 8 0 0 0 14.7 4.3L21 15M21 20v-5h-5',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17 19 7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM13.2 12.7 21 20.5M17.5 17l2-2M15 14.5l2-2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  upload: 'M12 20V9M7 14l5-5 5 5M4 4h16',
  printer: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  filter: 'M3 5h18l-7 8.5V19l-4 2v-7.5z',
  columns: 'M4 4h16v16H4zM10 4v16M15 4v16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  alertCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  switch: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7zM8.5 8.5l7 7',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11v3M16.5 13.5h.01',
  clipboard: 'M9 4h6v3H9zM9 5H6v16h12V5h-3M9 12h6M9 16h4',
  power: 'M12 3v8M6.3 7a8 8 0 1 0 11.4 0',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${size}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[name] || PATHS.circle);
  svg.append(path);
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
