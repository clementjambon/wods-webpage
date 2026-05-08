// Generic LaTeX-style labels & cross-references.
//
// Mark a target with [data-label="name"] on:
//   - .equation (wraps a $$...$$ block) — auto-numbered (1), (2), ...
//   - figure                            — auto-numbered Figure 1, 2, ...
//   - h2                                — number is read from .secnum
//
// Reference it with <a class="ref" data-ref="name"></a>. Add data-short
// for the abbreviated form ("Eq. 3" instead of "Equation 3").
(function () {
  const registry = {};

  function collectReferencedLabels() {
    const set = new Set();
    document.querySelectorAll('.ref[data-ref]').forEach((node) => {
      set.add(node.getAttribute('data-ref'));
    });
    return set;
  }

  function registerEquations(referenced) {
    let n = 0;
    document.querySelectorAll('.equation[data-label]').forEach((el) => {
      const label = el.getAttribute('data-label');
      const id = 'eq-' + label;
      el.id = id;
      if (!referenced.has(label)) return;
      n++;
      registry[label] = { kind: 'Equation', short: 'Eq.', num: '(' + n + ')', display: String(n), id };
      const tag = document.createElement('span');
      tag.className = 'eq-num';
      tag.textContent = '(' + n + ')';
      el.appendChild(tag);
    });
  }

  function registerFigures() {
    let n = 0;
    document.querySelectorAll('figure[data-label]').forEach((el) => {
      n++;
      const label = el.getAttribute('data-label');
      const id = el.id || 'fig-' + label;
      el.id = id;
      registry[label] = { kind: 'Figure', short: 'Fig.', num: String(n), display: String(n), id };
    });
  }

  function registerSections() {
    document.querySelectorAll('h2[data-label]').forEach((el) => {
      const label = el.getAttribute('data-label');
      const secnum = el.querySelector('.secnum');
      const num = secnum ? secnum.textContent.trim() : '?';
      const id = el.id || 'sec-' + label;
      el.id = id;
      registry[label] = { kind: 'Section', short: 'Sec.', num, display: num, id };
    });
  }

  function resolveRefs() {
    document.querySelectorAll('.ref[data-ref]').forEach((node) => {
      const label = node.getAttribute('data-ref');
      const entry = registry[label];
      if (!entry) {
        node.textContent = '[?' + label + ']';
        node.classList.add('ref-missing');
        return;
      }
      const useShort = node.hasAttribute('data-short');
      const kind = useShort ? entry.short : entry.kind;
      const a = document.createElement('a');
      a.href = '#' + entry.id;
      a.className = 'ref';
      a.textContent = kind + ' ' + entry.display;
      node.replaceWith(a);
    });
  }

  function init() {
    const referenced = collectReferencedLabels();
    registerEquations(referenced);
    registerFigures();
    registerSections();
    resolveRefs();
  }

  window.initLabels = init;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
