'use strict';

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia('(max-width: 900px)');
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let cy;
let data;
const state = {
  families: new Set(),
  keywords: new Set(),
  mode: 'all',
  yearMin: 0,
  yearMax: 0,
  query: '',
  selected: null,
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const familyVar = (color) => `var(--fam-${color}, var(--fam-default))`;
const familyHex = (color) => css(`--fam-${color}`) || css('--fam-default');
const fold = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Petit constructeur d'éléments : les données passent toujours par textContent
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'on') for (const [event, fn] of Object.entries(value)) node.addEventListener(event, fn);
    else if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

// Le JSON complet n'existe qu'en local ; le site public retombe sur public.json
async function load() {
  const forced = new URLSearchParams(location.search).get('data');
  for (const name of forced === 'public' ? ['public'] : ['full', 'public']) {
    try {
      const response = await fetch(`data/${name}.json`, { cache: 'no-cache' });
      if (response.ok) return await response.json();
    } catch { /* fichier suivant */ }
  }
  throw new Error('Données introuvables. En local, lance le site avec scripts/serve.ps1.');
}

function elements() {
  const colorOf = new Map(data.keywords.map((k) => [k.name, k.color]));
  const used = new Set(data.papers.flatMap((p) => p.keywords));
  const nodes = [];
  const edges = [];
  for (const k of data.keywords) {
    if (!used.has(k.name)) continue;
    nodes.push({
      data: { id: `k:${k.name}`, kind: 'keyword', label: k.name, color: k.color, width: k.name.length * 7.6 + 20 },
    });
  }
  for (const p of data.papers) {
    // Échelle log : 0 citation -> 14 px, 100 -> 32 px, 3 800 -> 46 px
    const size = 14 + 9 * Math.log10(1 + (p.citations || 0));
    nodes.push({ data: { id: `p:${p.id}`, kind: 'paper', label: p.label, size, paper: p } });
    for (const name of p.keywords) {
      edges.push({ data: { id: `e:${p.id}:${name}`, source: `p:${p.id}`, target: `k:${name}`, color: colorOf.get(name) } });
    }
  }
  return [...nodes, ...edges];
}

function graphStyle() {
  const ink = css('--ink');
  return [
    {
      selector: 'node[kind = "paper"]',
      style: {
        shape: 'ellipse',
        width: 'data(size)',
        height: 'data(size)',
        'background-color': css('--paper'),
        label: 'data(label)',
        color: ink,
        'font-size': 13,
        'text-valign': 'bottom',
        'text-margin-y': 3,
        'text-outline-color': css('--bg'),
        'text-outline-width': 2,
      },
    },
    {
      selector: 'node[kind = "keyword"]',
      style: {
        shape: 'round-rectangle',
        width: 'data(width)',
        height: 26,
        'background-color': (node) => familyHex(node.data('color')),
        label: 'data(label)',
        color: '#fff',
        'font-size': 13,
        'font-weight': 600,
        'text-valign': 'center',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': (edge) => familyHex(edge.data('color')),
        opacity: 0.28,
        'curve-style': 'haystack',
      },
    },
    { selector: 'edge.lit', style: { opacity: 0.95, width: 2 } },
    { selector: '.faded', style: { opacity: 0.1 } },
    { selector: 'node.chosen', style: { 'border-width': 3, 'border-color': css('--accent') } },
    { selector: 'node:active', style: { 'overlay-opacity': 0.12 } },
    { selector: '.hidden', style: { display: 'none' } },
  ];
}

// Graine fixe : la disposition est la même à chaque chargement
function seeded(seed, run) {
  const original = Math.random;
  let s = seed;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { run(); } finally { Math.random = original; }
}

function layout() {
  // La disposition épouse les proportions de la zone d'affichage
  const ratio = Math.min(2, Math.max(0.6, cy.width() / Math.max(1, cy.height())));
  seeded(7, () => {
    cy.elements(':visible').layout({
      name: 'cose',
      animate: false,
      boundingBox: { x1: 0, y1: 0, w: 1100 * ratio, h: 1100 },
      nodeRepulsion: () => 600000,
      nodeOverlap: 40,
      idealEdgeLength: () => 110,
      edgeElasticity: () => 80,
      gravity: 0.3,
      numIter: 3000,
      nodeDimensionsIncludeLabels: true,
    }).run();
  });
  cy.fit(cy.elements(':visible'), 30);
}

// Surligne un nœud et ses voisins ; sans argument, revient à la sélection en cours
function focus(node) {
  const target = node || (state.selected && cy.getElementById(state.selected));
  cy.batch(() => {
    cy.elements().removeClass('faded lit');
    if (!target || target.empty() || target.hasClass('hidden')) return;
    const near = target.closedNeighborhood();
    cy.elements().not(near).addClass('faded');
    near.edges().addClass('lit');
  });
}

function matches(paper) {
  if (paper.year && (paper.year < state.yearMin || paper.year > state.yearMax)) return false;
  if (state.keywords.size) {
    const has = (name) => paper.keywords.includes(name);
    const wanted = [...state.keywords];
    if (!(state.mode === 'all' ? wanted.every(has) : wanted.some(has))) return false;
  }
  if (state.query) {
    const text = fold([paper.title, paper.label, paper.authors.join(' '), paper.publication, paper.en_bref,
      paper.keywords.join(' '), paper.mes_notes].join(' '));
    if (!state.query.split(/\s+/).every((word) => text.includes(word))) return false;
  }
  return true;
}

function applyFilters() {
  let shown = 0;
  cy.batch(() => {
    cy.nodes('[kind = "paper"]').forEach((node) => {
      const ok = matches(node.data('paper'));
      node.toggleClass('hidden', !ok);
      if (ok) shown += 1;
    });
    // Un mot-clé disparaît si sa famille est masquée ou s'il n'a plus de papier visible
    cy.nodes('[kind = "keyword"]').forEach((node) => {
      const alive = state.families.has(node.data('color')) && node.neighborhood('node').not('.hidden').nonempty();
      node.toggleClass('hidden', !alive);
    });
  });
  $('count').textContent = `${shown} / ${data.papers.length} papiers`;
  document.querySelectorAll('.chip[data-keyword]').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(state.keywords.has(chip.dataset.keyword)));
  });
  focus();
}

function chip(keyword, onClick) {
  const color = data.keywords.find((k) => k.name === keyword)?.color;
  return el('button', { type: 'button', class: 'chip', style: `--chip:${familyVar(color)}`, text: keyword, on: { click: onClick } });
}

function toggleKeyword(name) {
  state.keywords.has(name) ? state.keywords.delete(name) : state.keywords.add(name);
  applyFilters();
}

function buildFilters() {
  const years = data.papers.map((p) => p.year).filter(Boolean);
  state.yearMin = Math.min(...years);
  state.yearMax = Math.max(...years);
  for (const id of ['year-min', 'year-max']) {
    const input = $(id);
    input.min = state.yearMin;
    input.max = state.yearMax;
    input.value = id === 'year-min' ? state.yearMin : state.yearMax;
    input.addEventListener('input', () => {
      // Les deux curseurs ne se croisent pas
      const low = Math.min(+$('year-min').value, +$('year-max').value);
      const high = Math.max(+$('year-min').value, +$('year-max').value);
      state.yearMin = low;
      state.yearMax = high;
      $('year-out').textContent = `${low} – ${high}`;
      applyFilters();
    });
  }
  $('year-out').textContent = `${state.yearMin} – ${state.yearMax}`;

  const used = new Set(data.papers.flatMap((p) => p.keywords));
  for (const family of data.families) {
    state.families.add(family.color);
    const names = data.keywords.filter((k) => k.color === family.color && used.has(k.name));
    if (!names.length) continue;
    const chips = names.map((k) => {
      const button = chip(k.name, () => toggleKeyword(k.name));
      button.dataset.keyword = k.name;
      return button;
    });
    $('keyword-groups').append(
      el('div', { class: 'group-title', text: family.label }),
      el('div', { class: 'chips' }, chips),
    );

    const toggle = el('button', {
      type: 'button',
      'aria-pressed': 'true',
      style: `--chip:${familyVar(family.color)}`,
      title: 'Afficher ou masquer cette famille',
      on: {
        click: () => {
          const on = !state.families.has(family.color);
          on ? state.families.add(family.color) : state.families.delete(family.color);
          toggle.setAttribute('aria-pressed', String(on));
          applyFilters();
        },
      },
    }, [el('span', { class: 'swatch' }), family.label]);
    $('legend').append(toggle);
  }
  $('legend').append(el('span', { class: 'note' }, [el('span', { class: 'dot' }), 'papier, taille = citations (échelle log)']));

  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', () => { state.mode = radio.value; applyFilters(); });
  });
  $('reset').addEventListener('click', () => { state.keywords.clear(); applyFilters(); });
  $('search').addEventListener('input', (event) => { state.query = fold(event.target.value.trim()); applyFilters(); });
}

function line(className, text) {
  return text ? el('p', { class: className, text }) : '';
}

function paperPanel(p) {
  const shown = p.authors.slice(0, 6).join(', ') + (p.authors.length > 6 ? ` et ${p.authors.length - 6} autres` : '');
  const cited = p.citations == null ? '' : `${p.citations} citation${p.citations > 1 ? 's' : ''}`;
  const parts = [
    el('h2', { text: p.title }),
    line('meta', shown),
    line('meta', [p.year, p.type, p.publication, cited].filter(Boolean).join(' · ')),
    el('div', { class: 'chips' }, p.keywords.map((name) => {
      const button = chip(name, () => select(`k:${name}`));
      button.classList.add('solid');
      return button;
    })),
  ];
  if (p.en_bref) parts.push(el('h3', { text: 'En bref' }), line('', p.en_bref));
  if (p.doi) parts.push(el('p', {}, [el('a', { href: p.doi, target: '_blank', rel: 'noopener', text: p.doi.replace('https://doi.org/', 'doi:') })]));

  // Champs présents seulement dans full.json, donc seulement en local
  const local = [];
  if (p.pertinence || p.lu_le) {
    local.push(line('meta', [p.pertinence && `Pertinence : ${p.pertinence}`, p.lu_le && `lu le ${p.lu_le}`].filter(Boolean).join(' · ')));
  }
  if (p.mes_notes) local.push(el('h3', { text: 'Mes notes' }), line('notes', p.mes_notes));
  if (p.zotero_uri) {
    const link = p.zotero_uri.replace(/^https:\/\/(www\.)?zotero\.org\//, 'zotero://select/');
    local.push(el('p', {}, [el('a', { href: link, text: 'Ouvrir dans Zotero' })]));
  }
  if (local.length) parts.push(el('div', { class: 'private' }, local));
  return parts;
}

function keywordPanel(node) {
  const name = node.data('label');
  const family = data.families.find((f) => f.color === node.data('color'));
  const papers = node.neighborhood('node').not('.hidden').map((n) => n.data('paper'))
    .sort((a, b) => (b.year || 0) - (a.year || 0) || a.label.localeCompare(b.label));
  const active = state.keywords.has(name);
  return [
    el('h2', { text: name }),
    line('meta', `${family ? family.label : ''} · ${papers.length} papier${papers.length > 1 ? 's' : ''} affiché${papers.length > 1 ? 's' : ''}`),
    el('p', {}, [el('button', {
      type: 'button',
      text: active ? 'Retirer ce filtre' : 'Ne garder que ces papiers',
      on: { click: () => { toggleKeyword(name); select(node.id()); } },
    })]),
    el('ul', { class: 'paper-list' }, papers.map((p) => el('li', {}, [
      el('button', { type: 'button', on: { click: () => select(`p:${p.id}`) } }, [p.label, el('small', { text: p.title })]),
    ]))),
  ];
}

function select(id) {
  const node = id ? cy.getElementById(id) : null;
  cy.nodes().removeClass('chosen');
  if (!node || node.empty()) {
    state.selected = null;
    $('panel').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    state.selected = id;
    node.addClass('chosen');
    $('panel-body').replaceChildren(...(node.data('kind') === 'paper' ? paperPanel(node.data('paper')) : keywordPanel(node)));
    $('panel').hidden = false;
    $('panel').scrollTop = 0;
    // L'adresse garde le nœud ouvert, pour partager un lien direct
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    // Le panneau vient de réduire la zone du graphe : on ramène le nœud dans le champ
    cy.resize();
    const view = cy.extent();
    const at = node.position();
    if (at.x < view.x1 || at.x > view.x2 || at.y < view.y1 || at.y > view.y2) cy.center(node);
  }
  focus();
}

function setFilters(open) {
  $('filters').classList.toggle('closed', !open);
  $('toggle-filters').setAttribute('aria-expanded', String(open));
}

async function main() {
  try {
    data = await load();
  } catch (error) {
    $('message').textContent = error.message;
    $('message').hidden = false;
    return;
  }
  $('badge').hidden = data.version !== 'full';

  cy = cytoscape({
    container: $('graph'),
    elements: elements(),
    style: graphStyle(),
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });
  buildFilters();
  applyFilters();
  layout();

  cy.on('mouseover', 'node', (event) => focus(event.target));
  cy.on('mouseout', 'node', () => focus());
  cy.on('tap', (event) => select(event.target === cy ? null : event.target.isNode() ? event.target.id() : state.selected));

  $('close-panel').addEventListener('click', () => select(null));
  $('relayout').addEventListener('click', layout);
  $('toggle-filters').addEventListener('click', () => setFilters($('filters').classList.contains('closed')));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') select(null); });

  setFilters(!narrow.matches);
  narrow.addEventListener('change', () => setFilters(!narrow.matches));
  dark.addEventListener('change', () => cy.style(graphStyle()));
  new ResizeObserver(() => cy.resize()).observe($('graph'));

  if (location.hash.length > 1) select(decodeURIComponent(location.hash.slice(1)));
}

main();
