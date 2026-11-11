'use strict';

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia('(max-width: 900px)');
const dark = window.matchMedia('(prefers-color-scheme: dark)');

// Familles descriptives, portées par presque tous les papiers : masquées à l'ouverture
const HIDDEN_AT_START = ['gray', 'brown'];
const PERTINENCE = ['Centrale', 'Utile', 'Contexte'];
const STATUTS = ['Lu', 'En cours', 'À lire'];
const VIEWS = { graph: null, timeline: 'chronologie', list: 'liste' };
const COLORS = { none: null, year: 'annee', type: 'type', pertinence: 'pertinence' };

let cy;
let data;
const meta = {};
const state = {
  view: 'graph',
  families: new Set(),
  keywords: new Set(),
  mode: 'all',
  yearMin: 0,
  yearMax: 0,
  minCitations: 0,
  off: { type: new Set(), pertinence: new Set() },
  statuts: new Set(['Lu']),
  query: '',
  selected: null,
  isolated: null,
  hideOthers: false,
  minShared: 2,
  colorBy: 'none',
  sort: { key: 'year', dir: -1 },
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const familyVar = (color) => `var(--fam-${color}, var(--fam-default))`;
const familyHex = (color) => css(`--fam-${color}`) || css('--fam-default');
const fold = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// Petit constructeur d'éléments : les données passent toujours par textContent
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'on') for (const [event, fn] of Object.entries(value)) node.addEventListener(event, fn);
    else if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== '' && child != null));
  return node;
}

// Mélange deux couleurs hexadécimales, t entre 0 et 1
function mix(from, to, t) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = rgb(from);
  const b = rgb(to);
  return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * t)).join(',')})`;
}

function byFrequency(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
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

function prepare() {
  for (const p of data.papers) p.statut = p.statut || 'Lu';
  meta.color = new Map(data.keywords.map((k) => [k.name, k.color]));
  meta.count = new Map();
  for (const p of data.papers) for (const k of p.keywords) meta.count.set(k, (meta.count.get(k) || 0) + 1);
  // Un mot-clé rare pèse plus qu'un mot-clé porté par presque tous les papiers
  const tagged = data.papers.filter((p) => p.keywords.length).length;
  meta.weight = (name) => Math.log(1 + tagged / meta.count.get(name));
  meta.byId = new Map(data.papers.map((p) => [p.id, p]));
  const years = data.papers.map((p) => p.year).filter(Boolean);
  meta.yearMin = Math.min(...years);
  meta.yearMax = Math.max(...years);
  meta.types = byFrequency(data.papers.map((p) => p.type));
  meta.pertinences = PERTINENCE.filter((v) => data.papers.some((p) => p.pertinence === v));
  meta.statuts = STATUTS.filter((v) => data.papers.some((p) => p.statut === v));
}

// Mots-clés communs à deux papiers ; visibleOnly ne compte que les familles affichées
function shared(a, b, visibleOnly = false) {
  return a.keywords.filter((k) => b.keywords.includes(k) && (!visibleOnly || state.families.has(meta.color.get(k))));
}

function paperColor(p) {
  if (state.colorBy === 'year' && p.year) {
    const t = (p.year - meta.yearMin) / Math.max(1, meta.yearMax - meta.yearMin);
    return mix(css('--seq-lo'), css('--seq-hi'), t);
  }
  if (state.colorBy === 'type' && p.type) return css(`--cat-${Math.min(5, meta.types.indexOf(p.type) + 1)}`);
  if (state.colorBy === 'pertinence' && PERTINENCE.includes(p.pertinence)) {
    return css(`--ord-${3 - PERTINENCE.indexOf(p.pertinence)}`);
  }
  return css('--paper');
}

function elements() {
  const nodes = [];
  const edges = [];
  const most = Math.max(...meta.count.values());
  for (const k of data.keywords) {
    const count = meta.count.get(k.name);
    if (!count) continue;
    // Un mot-clé grossit avec son nombre de papiers, de 0,85 à 1,35 fois la taille de base
    const scale = 0.85 + 0.5 * Math.sqrt(count / most);
    nodes.push({ data: {
      id: `k:${k.name}`, kind: 'keyword', label: k.name, color: k.color,
      font: 13 * scale, height: 26 * scale, width: (k.name.length * 7.6 + 20) * scale,
    } });
  }
  for (const p of data.papers) {
    // Échelle log : 0 citation -> 14 px, 100 -> 32 px, 3 800 -> 46 px
    const size = 14 + 9 * Math.log10(1 + (p.citations || 0));
    nodes.push({
      data: { id: `p:${p.id}`, kind: 'paper', label: p.label, size, paper: p },
      classes: p.statut === 'Lu' ? '' : 'unread',
    });
    for (const name of p.keywords) {
      edges.push({ data: { id: `e:${p.id}:${name}`, source: `p:${p.id}`, target: `k:${name}`, color: meta.color.get(name) } });
    }
  }
  return [...nodes, ...edges];
}

function graphStyle() {
  return [
    {
      selector: 'node[kind = "paper"]',
      style: {
        shape: 'ellipse',
        width: 'data(size)',
        height: 'data(size)',
        'background-color': (node) => paperColor(node.data('paper')),
        'border-width': 1,
        'border-color': css('--paper'),
        label: 'data(label)',
        color: css('--ink'),
        'font-size': 13,
        'text-valign': 'bottom',
        'text-margin-y': 3,
        'text-outline-color': css('--bg'),
        'text-outline-width': 2,
      },
    },
    { selector: 'node.unread', style: { 'background-opacity': 0.15, 'border-width': 2, 'border-style': 'dashed' } },
    {
      selector: 'node[kind = "keyword"]',
      style: {
        shape: 'round-rectangle',
        width: 'data(width)',
        height: 'data(height)',
        'background-color': (node) => familyHex(node.data('color')),
        label: 'data(label)',
        color: '#fff',
        'font-size': 'data(font)',
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
    // Repères d'année de la vue chronologique : du texte seul, insensible au survol
    {
      selector: 'node[kind = "axis"]',
      style: {
        width: 1,
        height: 1,
        'background-opacity': 0,
        label: 'data(label)',
        color: css('--muted'),
        'font-size': 15,
        'font-weight': 600,
        'text-valign': 'center',
        opacity: 1,
        events: 'no',
      },
    },
    { selector: 'node.chosen', style: { 'border-width': 3, 'border-style': 'solid', 'border-color': css('--accent') } },
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

// Nœuds affichés et liens entre eux, d'après la classe posée par les filtres
function shown() {
  const nodes = cy.nodes().not('.hidden');
  return nodes.union(nodes.edgesWith(nodes));
}

function forceLayout() {
  // La disposition épouse les proportions de la zone d'affichage
  const ratio = Math.min(2, Math.max(0.6, cy.width() / Math.max(1, cy.height())));
  seeded(7, () => {
    shown().layout({
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
}

// Chronologie : une colonne par année, les mots-clés rangés au-dessus par ancienneté moyenne
function timelineLayout() {
  const COLUMN = 130;
  const ROW = 58;
  const KEYWORD_ROWS = 4;
  const papers = cy.nodes('[kind = "paper"]').not('.hidden').toArray();
  const keywords = cy.nodes('[kind = "keyword"]').not('.hidden').toArray();
  const yearOf = (node) => node.data('paper').year || Infinity;
  const years = [...new Set(papers.map(yearOf))].sort((a, b) => a - b);
  const width = Math.max((years.length - 1) * COLUMN, (keywords.length - 1) * 60);
  const left = (width - (years.length - 1) * COLUMN) / 2;
  const axisY = KEYWORD_ROWS * 40 + 50;

  cy.batch(() => {
    years.forEach((year, i) => {
      const x = left + i * COLUMN;
      const column = papers.filter((node) => yearOf(node) === year)
        .sort((a, b) => (b.data('paper').citations || 0) - (a.data('paper').citations || 0));
      // Une colonne sur deux est décalée, pour que les libellés voisins ne se touchent pas
      column.forEach((node, j) => node.position({ x, y: axisY + 45 + j * ROW + (i % 2) * (ROW / 2) }));
      cy.add({
        group: 'nodes',
        data: { id: `axis:${year}`, kind: 'axis', label: Number.isFinite(year) ? String(year) : 'sans date' },
        position: { x, y: axisY },
        selectable: false,
        grabbable: false,
      });
    });
    const mean = (node) => {
      const near = node.neighborhood('node').not('.hidden').toArray();
      return near.reduce((sum, n) => sum + n.position('x'), 0) / Math.max(1, near.length);
    };
    const ordered = keywords.map((node) => [mean(node), node]).sort((a, b) => a[0] - b[0]);
    ordered.forEach(([, node], rank) => node.position({
      x: ordered.length > 1 ? (rank / (ordered.length - 1)) * width : width / 2,
      y: (rank % KEYWORD_ROWS) * 40,
    }));
  });
}

function layout() {
  if (state.view === 'list') return;
  cy.resize();
  cy.nodes('[kind = "axis"]').remove();
  if (state.view === 'timeline') timelineLayout();
  else forceLayout();
  // Disposition calculée sur un sous-ensemble : à refaire en quittant l'isolement du papier
  meta.partial = Boolean(state.isolated && state.isolated.startsWith('p:'));
  cy.fit(shown(), 50);
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

function passesIsolation(paper) {
  const id = state.isolated;
  if (!id) return true;
  if (id.startsWith('k:')) return paper.keywords.includes(id.slice(2));
  const center = meta.byId.get(id.slice(2));
  return paper === center || shared(paper, center, true).length >= state.minShared;
}

function matches(paper) {
  if (!state.statuts.has(paper.statut)) return false;
  if (!passesIsolation(paper)) return false;
  if (paper.year && (paper.year < state.yearMin || paper.year > state.yearMax)) return false;
  if ((paper.citations || 0) < state.minCitations) return false;
  if (state.off.type.has(paper.type) || state.off.pertinence.has(paper.pertinence)) return false;
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

function keywordAlive(node) {
  const id = state.isolated;
  const center = id === node.id();
  if (id && state.hideOthers) {
    if (id.startsWith('k:') && !center) return false;
    if (id.startsWith('p:') && !meta.byId.get(id.slice(2)).keywords.includes(node.data('label'))) return false;
  }
  if (!center && !state.families.has(node.data('color'))) return false;
  return node.neighborhood('node').not('.hidden').nonempty();
}

function applyFilters() {
  let count = 0;
  cy.batch(() => {
    cy.nodes('[kind = "paper"]').forEach((node) => {
      const ok = matches(node.data('paper'));
      node.toggleClass('hidden', !ok);
      if (ok) count += 1;
    });
    cy.nodes('[kind = "keyword"]').forEach((node) => node.toggleClass('hidden', !keywordAlive(node)));
  });
  const eligible = data.papers.filter((p) => state.statuts.has(p.statut)).length;
  $('count').textContent = `${count} / ${plural(eligible, 'papier')}`;
  document.querySelectorAll('.chip[data-keyword]').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(state.keywords.has(chip.dataset.keyword)));
  });
}

// Applique les filtres ; relayout redispose aussi le graphe (des nœuds sont apparus)
function refresh(relayout = false) {
  applyFilters();
  if (state.view === 'list') renderList();
  else if (relayout || state.view === 'timeline') layout();
  renderPaperLegend();
  focus();
}

function chip(keyword, onClick) {
  return el('button', {
    type: 'button', class: 'chip', style: `--chip:${familyVar(meta.color.get(keyword))}`, text: keyword, on: { click: onClick },
  });
}

function solidChip(keyword) {
  const button = chip(keyword, () => select(`k:${keyword}`));
  button.classList.add('solid');
  return button;
}

function toggleKeyword(name) {
  state.keywords.has(name) ? state.keywords.delete(name) : state.keywords.add(name);
  refresh();
}

// L'adresse retient la vue, le nœud isolé et le nœud ouvert, pour partager un lien direct
function syncUrl() {
  const params = new URLSearchParams(location.search);
  state.isolated ? params.set('isoler', state.isolated) : params.delete('isoler');
  VIEWS[state.view] ? params.set('vue', VIEWS[state.view]) : params.delete('vue');
  COLORS[state.colorBy] ? params.set('couleur', COLORS[state.colorBy]) : params.delete('couleur');
  const query = params.toString();
  const hash = state.selected ? `#${encodeURIComponent(state.selected)}` : '';
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + hash);
}

function renderIsolation() {
  const box = $('isolation');
  const id = state.isolated;
  box.hidden = !id;
  if (!id) return;
  const onPaper = id.startsWith('p:');
  const parts = ['Isolé :'];
  if (onPaper) {
    parts.push(el('button', { type: 'button', text: meta.byId.get(id.slice(2)).label, on: { click: () => select(id) } }));
    const level = el('select', { 'aria-label': 'Nombre minimal de mots-clés communs', on: { change: (event) => {
      state.minShared = +event.target.value;
      refresh();
    } } }, [1, 2, 3, 4, 5, 6].map((n) => el('option', { value: n, text: n })));
    level.value = state.minShared;
    parts.push(el('label', {}, ['papiers partageant au moins', level, 'mots-clés affichés']));
  } else {
    parts.push(solidChip(id.slice(2)));
  }
  const others = el('input', { type: 'checkbox', on: { change: (event) => {
    state.hideOthers = event.target.checked;
    refresh(!onPaper);
  } } });
  others.checked = state.hideOthers;
  parts.push(
    el('label', {}, [others, onPaper ? 'ne garder que ses mots-clés' : 'masquer les autres mots-clés']),
    el('button', { type: 'button', text: 'Quitter', on: { click: () => isolate(null) } }),
  );
  box.replaceChildren(...parts);
}

// Isoler : ne garder que le voisinage d'un mot-clé ou d'un papier, puis redisposer
function isolate(id) {
  // Autour d'un papier, les nœuds gardent leur place ; un mot-clé isolé est redisposé
  const moves = [state.isolated, id].some((node) => node && node.startsWith('k:')) || meta.partial;
  state.isolated = id;
  if (!id) state.hideOthers = false;
  renderIsolation();
  refresh(moves);
  if (state.selected) select(cy.getElementById(state.selected).hasClass('hidden') ? null : state.selected);
  else syncUrl();
}

function zoomBy(factor) {
  cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}

// Cases à cocher d'un filtre ; isOn et toggle lisent et modifient l'état
function facet(title, values, isOn, toggle) {
  const rows = values.map((value) => {
    const box = el('input', { type: 'checkbox', on: { change: () => toggle(value, box.checked) } });
    box.checked = isOn(value);
    return el('label', {}, [box, value]);
  });
  return el('section', {}, [el('h2', { text: title }), el('div', { class: 'checks' }, rows)]);
}

function buildFilters() {
  const options = [['none', 'uniforme'], ['year', 'par année'], ['type', 'par type']];
  if (meta.pertinences.length) options.push(['pertinence', 'par pertinence']);
  $('color-by').append(...options.map(([value, text]) => el('option', { value, text })));
  $('color-by').addEventListener('change', (event) => {
    state.colorBy = event.target.value;
    cy.style(graphStyle());
    renderPaperLegend();
    syncUrl();
  });

  state.yearMin = meta.yearMin;
  state.yearMax = meta.yearMax;
  for (const id of ['year-min', 'year-max']) {
    const input = $(id);
    input.min = meta.yearMin;
    input.max = meta.yearMax;
    input.value = id === 'year-min' ? meta.yearMin : meta.yearMax;
    input.addEventListener('input', () => {
      // Les deux curseurs ne se croisent pas
      state.yearMin = Math.min(+$('year-min').value, +$('year-max').value);
      state.yearMax = Math.max(+$('year-min').value, +$('year-max').value);
      $('year-out').textContent = `${state.yearMin} – ${state.yearMax}`;
      refresh();
    });
  }
  $('year-out').textContent = `${state.yearMin} – ${state.yearMax}`;
  $('min-citations').addEventListener('change', (event) => { state.minCitations = +event.target.value; refresh(); });

  const exclude = (key) => (value, on) => {
    on ? state.off[key].delete(value) : state.off[key].add(value);
    refresh();
  };
  if (meta.types.length > 1) {
    $('facets').append(facet('Type de document', meta.types, (v) => !state.off.type.has(v), exclude('type')));
  }
  if (meta.pertinences.length) {
    $('facets').append(facet('Pertinence', meta.pertinences, (v) => !state.off.pertinence.has(v), exclude('pertinence')));
  }
  if (meta.statuts.length > 1) {
    $('facets').append(facet('Statut de lecture', meta.statuts, (v) => state.statuts.has(v), (value, on) => {
      on ? state.statuts.add(value) : state.statuts.delete(value);
      refresh(true);
    }));
  }

  for (const family of data.families) {
    const names = data.keywords.filter((k) => k.color === family.color && meta.count.get(k.name));
    if (!names.length) continue;
    const visible = !HIDDEN_AT_START.includes(family.color);
    if (visible) state.families.add(family.color);
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
      'aria-pressed': String(visible),
      style: `--chip:${familyVar(family.color)}`,
      title: 'Afficher ou masquer cette famille dans le graphe',
      on: {
        click: () => {
          const on = !state.families.has(family.color);
          on ? state.families.add(family.color) : state.families.delete(family.color);
          toggle.setAttribute('aria-pressed', String(on));
          refresh(true);
        },
      },
    }, [el('span', { class: 'swatch' }), family.label]);
    $('legend-families').append(toggle);
  }

  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', () => { state.mode = radio.value; refresh(); });
  });
  $('reset').addEventListener('click', () => { state.keywords.clear(); refresh(); });
  $('search').addEventListener('input', (event) => { state.query = fold(event.target.value.trim()); refresh(); });
}

// Seconde ligne de la légende : ce que disent la couleur, la taille et le contour des papiers
function renderPaperLegend() {
  const note = (children) => el('span', { class: 'note' }, children);
  const dot = (color) => el('span', { class: 'dot', style: color ? `background:${color};border-color:${color}` : '' });
  const parts = [];
  if (state.colorBy === 'year') {
    parts.push(note([`papiers : ${meta.yearMin}`, el('span', { class: 'gradient' }), String(meta.yearMax)]));
  } else if (state.colorBy === 'type') {
    parts.push(...meta.types.map((type, i) => note([dot(`var(--cat-${Math.min(5, i + 1)})`), type])));
  } else if (state.colorBy === 'pertinence') {
    parts.push(...meta.pertinences.map((value) => note([dot(`var(--ord-${3 - PERTINENCE.indexOf(value)})`), value])));
  } else {
    parts.push(note([dot(), 'papier']));
  }
  parts.push(note(['taille = citations (échelle log)']));
  if ([...state.statuts].some((statut) => statut !== 'Lu')) parts.push(note([el('span', { class: 'dot unread' }), 'pas encore lu']));
  parts.push(note(['double-clic : isoler']));
  $('legend-papers').replaceChildren(...parts);
}

function line(className, text) {
  return text ? el('p', { class: className, text }) : '';
}

// Les papiers les plus proches : mots-clés communs, les plus rares comptant le plus
function related(paper) {
  return data.papers
    .filter((other) => other !== paper && other.keywords.length)
    .map((other) => {
      const common = shared(paper, other).sort((a, b) => meta.weight(b) - meta.weight(a));
      return { paper: other, common, score: common.reduce((sum, name) => sum + meta.weight(name), 0) };
    })
    .filter((entry) => entry.common.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function reference(p) {
  const names = p.authors.length > 6 ? `${p.authors.slice(0, 6).join(', ')} et al.` : p.authors.join(', ');
  return [names, p.year && `(${p.year})`, p.title, p.publication, p.doi].filter(Boolean).join('. ').replace('. (', ' (');
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Dans une iframe, le presse-papiers moderne peut être refusé : ancienne méthode
    const area = el('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const label = button.textContent;
  button.textContent = 'Copié';
  setTimeout(() => { button.textContent = label; }, 1500);
}

function paperPanel(p) {
  const id = `p:${p.id}`;
  const shownAuthors = p.authors.slice(0, 6).join(', ') + (p.authors.length > 6 ? ` et ${p.authors.length - 6} autres` : '');
  const cited = p.citations == null ? '' : plural(p.citations, 'citation');
  const isolated = state.isolated === id;
  const parts = [
    el('h2', { text: p.title }),
    line('meta', shownAuthors),
    line('meta', [p.year, p.type, p.publication, cited].filter(Boolean).join(' · ')),
    el('div', { class: 'chips' }, p.keywords.map(solidChip)),
  ];
  if (p.en_bref) parts.push(el('h3', { text: 'En bref' }), line('', p.en_bref));
  if (p.doi) parts.push(el('p', {}, [el('a', { href: p.doi, target: '_blank', rel: 'noopener', text: p.doi.replace('https://doi.org/', 'doi:') })]));

  const actions = [el('button', { type: 'button', text: 'Copier la référence', on: { click: (event) => copy(reference(p), event.currentTarget) } })];
  if (p.keywords.length) {
    actions.unshift(el('button', {
      type: 'button',
      text: isolated ? 'Quitter l\'isolement' : 'Isoler ce papier',
      on: { click: () => isolate(isolated ? null : id) },
    }));
  }
  parts.push(el('div', { class: 'actions' }, actions));

  const close = related(p);
  if (close.length) {
    parts.push(el('h3', { text: 'Papiers proches' }), el('ul', { class: 'paper-list' }, close.map((entry) => el('li', {}, [
      el('button', { type: 'button', on: { click: () => select(`p:${entry.paper.id}`) } }, [
        entry.paper.label,
        el('small', { text: `${entry.common.length} en commun : ${entry.common.slice(0, 4).join(', ')}${entry.common.length > 4 ? '…' : ''}` }),
      ]),
    ]))));
  }

  // Champs présents seulement dans full.json, donc seulement en local
  const local = [];
  const facts = [p.statut !== 'Lu' && p.statut, p.pertinence && `Pertinence : ${p.pertinence}`, p.lu_le && `lu le ${p.lu_le}`];
  if (facts.some(Boolean)) local.push(line('meta', facts.filter(Boolean).join(' · ')));
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
  const isolated = state.isolated === node.id();
  return [
    el('h2', { text: name }),
    line('meta', `${family ? family.label : ''} · ${plural(papers.length, 'papier')} affiché${papers.length > 1 ? 's' : ''}`),
    el('div', { class: 'actions' }, [el('button', {
      type: 'button',
      text: isolated ? 'Quitter l\'isolement' : 'Isoler ce mot-clé',
      on: { click: () => isolate(isolated ? null : node.id()) },
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
  } else {
    state.selected = id;
    node.addClass('chosen');
    $('panel-body').replaceChildren(...(node.data('kind') === 'paper' ? paperPanel(node.data('paper')) : keywordPanel(node)));
    $('panel').hidden = false;
    $('panel').scrollTop = 0;
    // Le panneau vient de réduire la zone du graphe : on ramène le nœud dans le champ
    cy.resize();
    const view = cy.extent();
    const at = node.position();
    if (at.x < view.x1 || at.x > view.x2 || at.y < view.y1 || at.y > view.y2) cy.center(node);
  }
  document.querySelectorAll('#list tr[data-id]').forEach((row) => row.classList.toggle('current', row.dataset.id === id));
  syncUrl();
  focus();
}

// Colonnes de la vue liste ; les colonnes locales n'existent que si les données les portent
function columns() {
  const all = [
    { key: 'label', title: 'Papier' },
    { key: 'year', title: 'Année', num: true },
    { key: 'citations', title: 'Citations', num: true },
    { key: 'type', title: 'Type', wide: true },
  ];
  if (meta.pertinences.length) all.push({ key: 'pertinence', title: 'Pertinence', wide: true });
  if (meta.statuts.length > 1) all.push({ key: 'statut', title: 'Statut', wide: true });
  return all;
}

function sortedPapers() {
  const { key, dir } = state.sort;
  const rank = (p) => (key === 'pertinence' && p.pertinence ? PERTINENCE.indexOf(p.pertinence) : p[key]);
  return data.papers.filter(matches).sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    // Les valeurs manquantes restent en bas, quel que soit le sens du tri
    if (x == null || y == null) return (x == null) - (y == null);
    return dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) || a.label.localeCompare(b.label);
  });
}

function renderList() {
  const cols = columns();
  const papers = sortedPapers();
  const head = el('tr', {}, cols.map((col) => {
    const active = state.sort.key === col.key;
    const th = el('th', { class: [col.num ? 'num' : '', col.wide ? 'wide' : ''].join(' ').trim() }, [
      el('button', {
        type: 'button',
        text: col.title + (active ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''),
        on: { click: () => {
          state.sort = { key: col.key, dir: active ? -state.sort.dir : (col.num ? -1 : 1) };
          renderList();
        } },
      }),
    ]);
    if (active) th.setAttribute('aria-sort', state.sort.dir > 0 ? 'ascending' : 'descending');
    return th;
  }));
  const rows = papers.map((p) => {
    const id = `p:${p.id}`;
    const cells = cols.map((col) => {
      const cell = el('td', { class: [col.num ? 'num' : '', col.wide ? 'wide' : ''].join(' ').trim() });
      if (col.key === 'label') cell.append(p.label, el('small', { text: p.title }));
      else cell.textContent = p[col.key] ?? '';
      return cell;
    });
    const row = el('tr', { 'data-id': id, on: { click: () => select(id) } }, cells);
    row.classList.toggle('current', state.selected === id);
    return row;
  });
  $('list').replaceChildren(papers.length
    ? el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])
    : el('p', { class: 'empty', text: 'Aucun papier ne correspond aux filtres.' }));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exporte ce qui est affiché : le tableau en CSV dans la vue liste, sinon le graphe en PNG
function exportView() {
  if (state.view !== 'list') {
    download(cy.png({ output: 'blob', full: true, scale: 2, bg: css('--bg') }), 'reseau-des-lectures.png');
    return;
  }
  const fields = ['label', 'title', 'authors', 'year', 'type', 'publication', 'doi', 'citations', 'keywords'];
  if (meta.pertinences.length) fields.push('pertinence');
  if (meta.statuts.length > 1) fields.push('statut');
  const cell = (value) => `"${String(Array.isArray(value) ? value.join(', ') : value ?? '').replace(/"/g, '""')}"`;
  const lines = [fields.join(';'), ...sortedPapers().map((p) => fields.map((field) => cell(p[field])).join(';'))];
  // BOM et point-virgule : le fichier s'ouvre directement dans Excel en français
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'papiers.csv');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.views button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  $('list').hidden = view !== 'list';
  $('relayout').disabled = view !== 'graph';
  refresh(true);
  syncUrl();
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
  prepare();
  $('badge').hidden = data.version !== 'full';

  cy = cytoscape({
    container: $('graph'),
    elements: elements(),
    style: graphStyle(),
    minZoom: 0.2,
    maxZoom: 4,
  });
  buildFilters();

  cy.on('mouseover', 'node', (event) => focus(event.target));
  cy.on('mouseout', 'node', () => focus());
  cy.on('tap', (event) => select(event.target === cy ? null : event.target.isNode() ? event.target.id() : state.selected));
  cy.on('dbltap', 'node', (event) => {
    const id = event.target.id();
    const paper = event.target.data('paper');
    // Un papier sans mot-clé n'a pas de voisinage à isoler
    if (paper && !paper.keywords.length) return;
    isolate(state.isolated === id ? null : id);
  });

  $('close-panel').addEventListener('click', () => select(null));
  $('relayout').addEventListener('click', layout);
  $('export').addEventListener('click', exportView);
  $('toggle-filters').addEventListener('click', () => setFilters($('filters').classList.contains('closed')));
  $('zoom-in').addEventListener('click', () => zoomBy(1.3));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.3));
  $('zoom-fit').addEventListener('click', () => cy.fit(shown(), 50));
  document.querySelectorAll('.views button').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') select(null);
    // Les raccourcis de zoom ne doivent pas gêner la saisie dans un champ
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === '+' || event.key === '=') zoomBy(1.3);
    if (event.key === '-') zoomBy(1 / 1.3);
    if (event.key === '0') cy.fit(shown(), 50);
  });

  setFilters(!narrow.matches);
  narrow.addEventListener('change', () => setFilters(!narrow.matches));
  dark.addEventListener('change', () => cy.style(graphStyle()));
  new ResizeObserver(() => cy.resize()).observe($('graph'));

  // État de départ repris de l'adresse ; un mot-clé nu reste accepté (anciens liens)
  const params = new URLSearchParams(location.search);
  const wanted = params.get('isoler');
  const isolated = wanted && (/^[kp]:/.test(wanted) ? wanted : `k:${wanted}`);
  if (isolated && cy.getElementById(isolated).nonempty()) state.isolated = isolated;
  renderIsolation();
  const color = Object.keys(COLORS).find((key) => COLORS[key] === params.get('couleur'));
  if (color && [...$('color-by').options].some((option) => option.value === color)) {
    state.colorBy = color;
    $('color-by').value = color;
    cy.style(graphStyle());
  }
  const view = Object.keys(VIEWS).find((key) => VIEWS[key] === params.get('vue')) || 'graph';
  const start = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : null;
  // Le panneau s'ouvre avant la première disposition, pour cadrer sur la place restante
  $('panel').hidden = !start;
  setView(view);
  select(start);
}

main();
