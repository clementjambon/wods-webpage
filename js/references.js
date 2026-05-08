// Distill-style references: numbered inline citations with hover preview,
// auto-generated bibliography in order of first appearance.
(function () {
  const REFS = {
    evans2022partial: {
      type: 'book',
      authors: ['Lawrence C. Evans'],
      title: 'Partial Differential Equations',
      volume: 19,
      year: 2022,
      publisher: 'American Mathematical Society',
    },
    sawhney2023wost: {
      type: 'article',
      authors: ['Rohan Sawhney', 'Bailey Miller', 'Ioannis Gkioulekas', 'Keenan Crane'],
      title: 'Walk on Stars: A Grid-Free Monte Carlo Method for PDEs with Neumann Boundary Conditions',
      journal: 'ACM Transactions on Graphics (SIGGRAPH)',
      year: 2023,
      url: 'https://doi.org/10.1145/3592398',
    },
    muller1956continuous: {
      type: 'article',
      authors: ['Mervin E. Muller'],
      title: 'Some Continuous Monte Carlo Methods for the Dirichlet Problem',
      journal: 'The Annals of Mathematical Statistics',
      volume: 27,
      number: 3,
      pages: '569–589',
      year: 1956,
      url: 'https://doi.org/10.1214/aoms/1177728169',
    },
    sawhney2025star: {
      type: 'inproceedings',
      authors: ['Rohan Sawhney', 'Bailey Miller', 'Ioannis Gkioulekas', 'Keenan Crane', 'Wojciech Jarosz', 'Shuang Zhao', 'Mohammad Sina Nabizadeh', 'Zilu Li'],
      title: 'State of the Art in Grid-Free Monte Carlo Methods for Partial Differential Equations',
      booktitle: "SIGGRAPH Courses '25",
      publisher: 'ACM',
      year: 2025,
      url: 'https://doi.org/10.1145/3721241.3734001',
    },
    chung1997spectral: {
      type: 'book',
      authors: ['Fan R. K. Chung'],
      title: 'Spectral Graph Theory',
      volume: 92,
      year: 1997,
      publisher: 'American Mathematical Society',
    },
    shirley1997whatswrong: {
      type: 'misc',
      authors: ['Peter Shirley', 'D.C. Nguyen (JuHu)', 'Stephen Westin', 'Eric Veach'],
      title: "What's Wrong with Monte-Carlo Methods?",
      journal: 'Ray Tracing News',
      volume: 10,
      number: 2,
      year: 1997,
      url: 'https://www.realtimerendering.com/resources/RTNews/html/rtnv10n2.html#art6',
    },
    sokal1997monte: {
      type: 'incollection',
      authors: ['Alan Sokal'],
      title: 'Monte Carlo methods in statistical mechanics: foundations and new algorithms',
      booktitle: 'Functional integration: Basics and applications',
      pages: '131–192',
      year: 1997,
      publisher: 'Springer',
    },
    sawhney2020mcgp: {
      type: 'article',
      authors: ['Rohan Sawhney', 'Keenan Crane'],
      title: 'Monte Carlo Geometry Processing: A Grid-Free Approach to PDE-Based Methods on Volumetric Domains',
      journal: 'ACM Transactions on Graphics (SIGGRAPH)',
      volume: 39,
      number: 4,
      year: 2020,
      url: 'https://doi.org/10.1145/3386569.3392374',
    },
    zhao2013modular: {
      type: 'article',
      authors: ['Shuang Zhao', 'Miloš Hašan', 'Ravi Ramamoorthi', 'Kavita Bala'],
      title: 'Modular flux transfer: efficient rendering of high-resolution volumes with repeated structures',
      journal: 'ACM Transactions on Graphics (TOG)',
      volume: 32,
      number: 4,
      pages: '1–12',
      year: 2013,
      publisher: 'ACM New York, NY, USA',
    },
    blumer2016reduced: {
      type: 'inproceedings',
      authors: ['Adrian Blumer', 'Jan Novák', 'Ralf Habel', 'Derek Nowrouzezahrai', 'Wojciech Jarosz'],
      title: 'Reduced aggregate scattering operators for path tracing',
      booktitle: 'Computer Graphics Forum',
      volume: 35,
      number: 7,
      pages: '461–473',
      year: 2016,
      publisher: 'Wiley Online Library',
    },
  };

  function shortAuthors(authors) {
    if (!authors || !authors.length) return '';
    const last = (a) => a.trim().split(/\s+/).slice(-1)[0];
    if (authors.length === 1) return last(authors[0]);
    if (authors.length === 2) return `${last(authors[0])} & ${last(authors[1])}`;
    return `${last(authors[0])} et al.`;
  }

  function fullAuthors(authors) {
    if (!authors || !authors.length) return '';
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
    return authors.slice(0, -1).join(', ') + ', and ' + authors[authors.length - 1];
  }

  function formatVenue(ref) {
    const parts = [];
    if (ref.journal) parts.push(`<i>${ref.journal}</i>`);
    if (ref.booktitle) parts.push(`In <i>${ref.booktitle}</i>`);
    if (ref.publisher) parts.push(ref.publisher);
    if (ref.volume != null) parts.push(`Vol.&nbsp;${ref.volume}`);
    if (ref.year != null) parts.push(String(ref.year));
    return parts.join(', ');
  }

  function renderTooltip(ref, n) {
    const linkOpen = ref.url ? `<a href="${ref.url}" target="_blank" rel="noopener">` : '';
    const linkClose = ref.url ? '</a>' : '';
    return `
      <div class="cite-card-num">[${n}]</div>
      <div class="cite-card-body">
        <div class="cite-card-title">${linkOpen}${ref.title}${linkClose}</div>
        <div class="cite-card-meta">${fullAuthors(ref.authors)}</div>
        <div class="cite-card-meta">${formatVenue(ref)}</div>
      </div>`;
  }

  function renderEntry(ref, n) {
    const linkOpen = ref.url ? `<a href="${ref.url}" target="_blank" rel="noopener">` : '';
    const linkClose = ref.url ? '</a>' : '';
    const venue = formatVenue(ref);
    return `
      <li id="ref-${n}" class="ref-entry">
        <span class="ref-num">[${n}]</span>
        <span class="ref-body">
          ${fullAuthors(ref.authors)}.
          ${linkOpen}${ref.title}${linkClose}.${venue ? `\n          ${venue}.` : ''}
        </span>
      </li>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const nodes = Array.from(document.querySelectorAll('cite[data-key], .cite[data-key]'));
    if (!nodes.length) return;

    const parseKeys = (node) =>
      (node.getAttribute('data-key') || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    // Assign numbers in order of first appearance.
    const order = [];
    const numByKey = new Map();
    for (const node of nodes) {
      for (const key of parseKeys(node)) {
        if (!REFS[key]) {
          console.warn('[references] unknown key:', key);
          continue;
        }
        if (!numByKey.has(key)) {
          order.push(key);
          numByKey.set(key, order.length);
        }
      }
    }

    // Replace inline nodes with numbered links + hover card(s).
    for (const node of nodes) {
      const keys = parseKeys(node).filter((k) => numByKey.has(k));
      if (!keys.length) continue;
      const frag = document.createDocumentFragment();
      keys.forEach((key, i) => {
        const n = numByKey.get(key);
        const ref = REFS[key];
        const short = shortAuthors(ref.authors);
        const open = i === 0 ? '[' : '';
        const close = i === keys.length - 1 ? ']' : ',';
        const a = document.createElement('a');
        a.className = 'cite-link';
        a.href = `#ref-${n}`;
        a.setAttribute('data-key', key);
        a.setAttribute('aria-label', `Reference ${n}: ${short} ${ref.year}`);
        a.innerHTML = `${open}${n}${close}<span class="cite-card" role="tooltip">${renderTooltip(ref, n)}</span>`;
        frag.appendChild(a);
      });
      node.replaceWith(frag);
    }

    // Render bibliography if a container exists.
    const biblio = document.getElementById('bibliography');
    if (biblio && order.length) {
      const ol = document.createElement('ol');
      ol.className = 'ref-list';
      ol.innerHTML = order.map((key, i) => renderEntry(REFS[key], i + 1)).join('');
      biblio.appendChild(ol);
    }

    // ---------- Card positioning (clamped to viewport) ----------
    function positionCard(trigger) {
      const card = trigger.querySelector('.cite-card');
      if (!card) return;
      const margin = 8;
      const gap = 6;
      const tRect = trigger.getBoundingClientRect();
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = tRect.left + tRect.width / 2 - cw / 2;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      let top = tRect.top - ch - gap;
      if (top < margin) top = tRect.bottom + gap; // flip below if no room above
      top = Math.max(margin, Math.min(top, vh - ch - margin));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }
    document.addEventListener('mouseover', (e) => {
      const trigger = e.target.closest('.cite-link, .fn-link');
      if (trigger) positionCard(trigger);
    });
    document.addEventListener('focusin', (e) => {
      const trigger = e.target.closest('.cite-link, .fn-link');
      if (trigger) positionCard(trigger);
    });

    // ---------- Footnotes ----------
    // Usage: <span class="fn">footnote body, may contain <i>HTML</i> and $math$.</span>
    // or:    <fn>footnote body</fn>
    const footnotes = Array.from(document.querySelectorAll('fn, .fn'));
    footnotes.forEach((node, i) => {
      const n = i + 1;
      const body = node.innerHTML.trim();
      const marker = document.createElement('span');
      marker.className = 'fn-link';
      marker.setAttribute('id', `fnref-${n}`);
      marker.setAttribute('role', 'button');
      marker.setAttribute('tabindex', '0');
      marker.setAttribute('aria-label', `Footnote ${n}`);
      marker.innerHTML = `${n}<span class="cite-card fn-card" role="tooltip">
        <span class="cite-card-num">${n}</span>
        <span class="cite-card-body">${body}</span>
      </span>`;
      node.replaceWith(marker);
    });
  });
})();
