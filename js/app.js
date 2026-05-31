'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allMedications = [];

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('./data/medications.json')
    .then(r => r.json())
    .then(data => {
      allMedications = data.medicaties;
      bindEvents();
    })
    .catch(() => {
      document.getElementById('content').innerHTML =
        '<div class="empty-state"><div class="empty-icon">⚠️</div>' +
        '<h2>Kon medicatiedata niet laden</h2>' +
        '<p>Zorg dat het bestand <code>data/medications.json</code> aanwezig is en de pagina via een HTTP-server wordt geopend.</p></div>';
    });
});

function bindEvents() {
  ['species', 'weight', 'age', 'category', 'search'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderResults);
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults() {
  const species  = document.getElementById('species').value;
  const weightRaw = document.getElementById('weight').value;
  const weight   = parseFloat(weightRaw);
  const category = document.getElementById('category').value;
  const search   = document.getElementById('search').value.trim().toLowerCase();
  const age      = document.getElementById('age').value.trim();

  const empty   = document.getElementById('empty-state');
  const wrapper = document.getElementById('results-wrapper');

  if (!species || !weight || weight <= 0) {
    empty.classList.remove('hidden');
    wrapper.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  const speciesLabel = document.getElementById('species').selectedOptions[0].text;

  // Filter
  const filtered = allMedications.filter(med => {
    if (!med.soorten[species]) return false;
    if (category && med.categorie !== category) return false;
    if (search) {
      const haystack = [med.naam, med.werkzameStof, ...(med.merknamen || [])].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Header
  const ageStr = age ? `, ${age}` : '';
  document.getElementById('results-title').textContent = `Medicaties – ${speciesLabel}`;
  document.getElementById('patient-info').textContent  = `Gewicht: ${formatNum(weight)} kg${ageStr}`;
  document.getElementById('results-count').textContent = `${filtered.length} medicatie${filtered.length !== 1 ? 's' : ''}`;

  // Global species alerts
  renderAlerts(species, filtered);

  // Cards
  const grid = document.getElementById('medication-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="no-results"><h3>Geen medicaties gevonden</h3><p>Pas het filter of de zoekterm aan.</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(med => buildCard(med, species, weight)).join('');

  grid.querySelectorAll('.card-detail-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(btn.dataset.id, species, weight);
    });
  });
  grid.querySelectorAll('.med-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id, species, weight));
  });
}

// ── Alert zone ────────────────────────────────────────────────────────────────
const SPECIES_ALERTS = {
  kat: [
    { level: 'danger',  text: '<strong>Paracetamol:</strong> LETAAL bij katten – nooit toedienen!' },
    { level: 'danger',  text: '<strong>Permethrin / pyrethroïden spot-on (hond):</strong> LETAAL bij katten – nooit toepassen!' },
    { level: 'danger',  text: '<strong>NSAIDs:</strong> Katten zijn bijzonder gevoelig. Meloxicam max 5 dagen; nooit aspirine of ibuprofen.' },
    { level: 'danger',  text: '<strong>Enrofloxacine:</strong> Maximaal 5 mg/kg/dag – hogere dosis veroorzaakt onomkeerbare blindheid.' },
  ],
  konijn: [
    { level: 'danger',  text: '<strong>Orale penicillines (amoxicilline, amox-clav):</strong> Risico op FATALE cecale dysbiose bij konijnen!' },
    { level: 'warning', text: '<strong>Corticosteroïden:</strong> Verhogen sterk het risico op latente infecties (bijv. E. cuniculi reactivatie).' },
    { level: 'warning', text: '<strong>GI-stasis:</strong> Bij verminderde darmmotiliteit altijd vloeistof en prokinetisch middel inzetten.' },
  ],
  hond: [
    { level: 'danger',  text: '<strong>Ivermectine bij MDR1-rassen:</strong> Levensgevaarlijk bij Collie, Shetland Sheepdog, Australian Shepherd, Border Collie e.a. zonder MDR1-test.' },
  ],
  paard: [
    { level: 'danger',  text: '<strong>Dexamethason:</strong> Laminitisrisico bij paarden – voorzichtig toepassen.' },
  ],
};

function renderAlerts(species, filtered) {
  const zone = document.getElementById('alert-zone');
  const alerts = SPECIES_ALERTS[species] || [];
  if (!alerts.length) { zone.innerHTML = ''; return; }
  zone.innerHTML = alerts.map(a =>
    `<div class="alert alert-${a.level}">
       <span class="alert-icon">${a.level === 'danger' ? '🚫' : '⚠️'}</span>
       <div>${a.text}</div>
     </div>`
  ).join('');
}

// ── Card builder ──────────────────────────────────────────────────────────────
function buildCard(med, species, weight) {
  const sd = med.soorten[species];
  const hasDanger  = med.toxiciteit || (sd.waarschuwingen || []).some(w => w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') || w.startsWith('HOOG RISICO'));
  const hasWarning = !hasDanger && (sd.waarschuwingen || []).length > 0;

  const cardClass = hasDanger ? 'has-danger' : hasWarning ? 'has-warning' : '';
  const brandText = (med.merknamen || []).slice(0, 2).join(', ');

  let doseSectionHtml = '';
  if (sd.dosis && weight) {
    const dMin = sd.dosis.min * weight;
    const dMax = sd.dosis.max * weight;
    const showRange = dMin !== dMax;
    doseSectionHtml = `
      <div class="dose-block">
        <div class="dose-block-title">Dosis voor ${formatNum(weight)} kg</div>
        <div class="dose-row">
          <span class="dose-label">Totaaldosis:</span>
          <span class="dose-value">${showRange ? formatNum(dMin) + ' – ' + formatNum(dMax) : formatNum(dMin)}</span>
          <span class="dose-unit">mg</span>
        </div>
        ${buildRouteRows(sd, dMin, dMax)}
        <div class="freq-row">Frequentie: <span>${sd.dosis.frequentie}</span></div>
        ${sd.dosis.opmerkingen ? `<div class="dose-note">${escHtml(sd.dosis.opmerkingen)}</div>` : ''}
      </div>`;
  }

  const warnHtml = buildWarningsShort(sd, hasDanger);

  return `
    <div class="med-card ${cardClass}" data-id="${med.id}" tabindex="0" role="button" aria-label="${med.naam}">
      <div class="card-header">
        <div>
          <div class="card-title">${escHtml(med.naam)}</div>
          <div class="card-subtitle">${escHtml(med.werkzameStof)}${brandText ? ` · <em>${escHtml(brandText)}</em>` : ''}</div>
        </div>
        <span class="badge badge-${med.categorie}">${ucFirst(med.categorie)}</span>
      </div>
      <div class="card-body">
        ${hasDanger && med.toxiciteit ? `<div class="warn-tag warn-tag-danger">⚠ ${escHtml(med.toxiciteit)}</div>` : ''}
        ${doseSectionHtml}
        ${warnHtml}
      </div>
      <div class="card-footer">
        <span class="card-sources">${(sd.bronnen || []).join(', ')}</span>
        <button class="card-detail-btn" data-id="${med.id}">Details →</button>
      </div>
    </div>`;
}

function buildRouteRows(sd, dMin, dMax) {
  const rows = [];
  if (sd.toediening) {
    if (sd.toediening.injectie) {
      const conc = sd.toediening.injectie.concentratie;
      if (conc) {
        const vMin = dMin / conc, vMax = dMax / conc;
        const routes = (sd.toediening.injectie.routes || []).join('/');
        rows.push(`<div class="dose-row">
          <span class="dose-label">Injectie (${routes || 'IM/SC'}):</span>
          <span class="dose-value">${vMin !== vMax ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)}</span>
          <span class="dose-unit">ml (${conc} mg/ml)</span>
        </div>`);
      }
    }
    if (sd.toediening.oraal) {
      const o = sd.toediening.oraal;
      if (o.type === 'vloeistof' && o.concentratie) {
        const vMin = dMin / o.concentratie, vMax = dMax / o.concentratie;
        rows.push(`<div class="dose-row">
          <span class="dose-label">Oraal:</span>
          <span class="dose-value">${vMin !== vMax ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)}</span>
          <span class="dose-unit">ml (${o.concentratie} mg/ml)</span>
        </div>`);
      } else if (o.type === 'tablet' && o.tabletGrootten) {
        const tabletInfo = o.tabletGrootten.map(t => {
          const n = dMax / t;
          return `${formatNum(n)} × ${t}mg tab`;
        }).join(' | ');
        rows.push(`<div class="dose-row">
          <span class="dose-label">Tablet:</span>
          <span class="dose-value dose-unit" style="font-size:.8rem">${tabletInfo}</span>
        </div>`);
      }
    }
  }
  return rows.join('');
}

function buildWarningsShort(sd, hasDanger) {
  const warnings = (sd.waarschuwingen || []).slice(0, 3);
  if (!warnings.length) return '';
  const items = warnings.map(w => {
    const isDanger = w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') || w.startsWith('HOOG RISICO') || w.startsWith('KRITIEK');
    return `<li class="${isDanger ? 'danger' : ''}">${escHtml(w)}</li>`;
  }).join('');
  return `<ul class="warn-list">${items}</ul>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id, species, weight) {
  const med = allMedications.find(m => m.id === id);
  if (!med) return;
  const sd = med.soorten[species];

  const speciesLabel = document.getElementById('species').selectedOptions[0].text;

  let dosCalc = '';
  if (sd.dosis && weight > 0) {
    const dMin = sd.dosis.min * weight;
    const dMax = sd.dosis.max * weight;
    const showRange = dMin !== dMax;
    dosCalc = `
      <div class="modal-section">
        <div class="modal-section-title">Berekende dosering voor ${escHtml(speciesLabel)} ${formatNum(weight)} kg</div>
        <table class="detail-table">
          <tr><td>Totaaldosis</td><td><strong>${showRange ? formatNum(dMin) + ' – ' + formatNum(dMax) : formatNum(dMin)} mg</strong></td></tr>
          <tr><td>Per kg</td><td>${sd.dosis.min}${showRange ? ' – ' + sd.dosis.max : ''} mg/kg</td></tr>
          <tr><td>Frequentie</td><td>${escHtml(sd.dosis.frequentie)}</td></tr>
          ${sd.dosis.opmerkingen ? `<tr><td>Opmerking</td><td><em>${escHtml(sd.dosis.opmerkingen)}</em></td></tr>` : ''}
        </table>
      </div>
      ${buildModalRoutes(sd, dMin, dMax)}`;
  }

  let warnHtml = '';
  if (sd.waarschuwingen && sd.waarschuwingen.length) {
    const items = sd.waarschuwingen.map(w => {
      const isDanger = w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') || w.startsWith('HOOG RISICO') || w.startsWith('KRITIEK');
      return `<li class="${isDanger ? 'warn-danger' : 'warn-warning'}">${escHtml(w)}</li>`;
    }).join('');
    warnHtml = `<div class="modal-section">
      <div class="modal-section-title">Waarschuwingen</div>
      <ul class="modal-warn-list">${items}</ul>
    </div>`;
  }

  let toxHtml = '';
  if (med.toxiciteit || sd.toxiciteit) {
    toxHtml = `<div class="modal-section">
      <div class="modal-section-title">Toxiciteit</div>
      <p class="modal-ci"><strong>⚠ ${escHtml(med.toxiciteit || sd.toxiciteit)}</strong></p>
    </div>`;
  }

  let ciHtml = '';
  if (sd.contra_indicaties && sd.contra_indicaties.length) {
    ciHtml = `<div class="modal-section">
      <div class="modal-section-title">Contra-indicaties</div>
      <p class="modal-ci">${sd.contra_indicaties.map(c => escHtml(c)).join(', ')}</p>
    </div>`;
  }

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-med-name">${escHtml(med.naam)}</div>
    <div class="modal-werkzame">Werkzame stof: ${escHtml(med.werkzameStof)}</div>
    ${med.merknamen && med.merknamen.length ? `<div class="modal-merknamen">Merknamen: ${med.merknamen.map(escHtml).join(', ')}</div>` : ''}
    <p style="font-size:.85rem;color:var(--gray-600);margin-bottom:.5rem">${escHtml(med.beschrijving || '')}</p>
    ${toxHtml}
    ${dosCalc}
    ${warnHtml}
    ${ciHtml}
    <div class="modal-section">
      <div class="modal-section-title">Bronnen</div>
      <p class="modal-sources">${(sd.bronnen || []).map(escHtml).join(' · ')}</p>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-box').scrollTop = 0;
}

function buildModalRoutes(sd, dMin, dMax) {
  if (!sd.toediening) return '';
  const rows = [];
  const t = sd.toediening;

  if (t.injectie) {
    const conc = t.injectie.concentratie;
    const routes = (t.injectie.routes || []).join('/') || '—';
    rows.push(['Routes injectie', routes]);
    if (conc) {
      const vMin = dMin / conc, vMax = dMax / conc;
      rows.push([`Injectie volume (${conc} mg/ml)`, `<strong>${vMin !== vMax ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)} ml</strong>`]);
    }
    if (t.injectie.opmerkingen) rows.push(['Injectie opmerking', escHtml(t.injectie.opmerkingen)]);
  }

  if (t.oraal) {
    const o = t.oraal;
    rows.push(['Toediening oraal', ucFirst(o.type || '—')]);
    if (o.concentratie && o.type === 'vloeistof') {
      const vMin = dMin / o.concentratie, vMax = dMax / o.concentratie;
      rows.push([`Oraal volume (${o.concentratie} mg/ml)`, `<strong>${vMin !== vMax ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)} ml</strong>`]);
    }
    if (o.tabletGrootten) {
      o.tabletGrootten.forEach(t2 => {
        rows.push([`Tablet ${t2}mg`, `${formatNum(dMax / t2)} tabletten (op max dosis)`]);
      });
    }
    if (o.opmerkingen) rows.push(['Oraal opmerking', escHtml(o.opmerkingen)]);
  }

  if (!rows.length) return '';
  return `<div class="modal-section">
    <div class="modal-section-title">Toedieningsroutes & volumes</div>
    <table class="detail-table">
      ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
    </table>
  </div>`;
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatNum(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (n < 0.01) return n.toFixed(4);
  if (n < 1)    return n.toFixed(3).replace(/\.?0+$/, '');
  if (n < 10)   return parseFloat(n.toFixed(2)).toString();
  if (n < 100)  return parseFloat(n.toFixed(1)).toString();
  return Math.round(n).toString();
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function ucFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
