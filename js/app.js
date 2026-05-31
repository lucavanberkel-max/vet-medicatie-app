'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allMedications = [];

const SPECIES_LABELS = {
  hond: '🐕 Hond', kat: '🐈 Kat', konijn: '🐇 Konijn', cavia: '🐾 Cavia',
  kanarie: '🐦 Kanarie', duif: '🕊️ Duif', kip: '🐓 Kip',
  koe: '🐄 Koe', paard: '🐴 Paard', varken: '🐷 Varken', schaap: '🐑 Schaap'
};

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
  const weight   = parseFloat(document.getElementById('weight').value) || 0;
  const category = document.getElementById('category').value;
  const search   = document.getElementById('search').value.trim().toLowerCase();
  const age      = document.getElementById('age').value.trim();

  const hasSearch  = search.length >= 2;
  const hasSpecies = !!species;
  const hasWeight  = weight > 0;

  const empty   = document.getElementById('empty-state');
  const wrapper = document.getElementById('results-wrapper');

  // Show empty state only when nothing useful is entered
  if (!hasSearch && !hasSpecies) {
    empty.classList.remove('hidden');
    wrapper.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  // Filter
  const filtered = allMedications.filter(med => {
    // Species filter: only apply when a species is selected
    if (hasSpecies && !med.soorten[species]) return false;
    // Without species filter: skip meds with zero species entries (shouldn't happen)
    if (!hasSpecies && Object.keys(med.soorten).length === 0) return false;
    // Category filter
    if (category && med.categorie !== category) return false;
    // Search filter
    if (hasSearch) {
      const haystack = [med.naam, med.werkzameStof, med.beschrijving, ...(med.merknamen || [])].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Header
  let titleText = 'Medicaties';
  let infoText  = '';

  if (hasSpecies && hasWeight) {
    const speciesLabel = document.getElementById('species').selectedOptions[0].text;
    titleText = `Medicaties – ${speciesLabel}`;
    infoText  = `Gewicht: ${formatNum(weight)} kg${age ? ', ' + age : ''}`;
  } else if (hasSpecies) {
    titleText = `Medicaties – ${document.getElementById('species').selectedOptions[0].text}`;
    infoText  = 'Voer gewicht in voor dosisberekening';
  } else if (hasSearch) {
    titleText = `Zoekresultaten voor "${escHtml(search)}"`;
    infoText  = hasSpecies ? '' : 'Selecteer diersoort + gewicht voor dosisberekening';
  }

  document.getElementById('results-title').textContent  = titleText;
  document.getElementById('patient-info').textContent   = infoText;
  document.getElementById('results-count').textContent  = `${filtered.length} medicatie${filtered.length !== 1 ? 's' : ''}`;

  // Alerts only when species is known
  renderAlerts(hasSpecies ? species : null);

  // Cards
  const grid = document.getElementById('medication-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="no-results"><h3>Geen medicaties gevonden</h3><p>Pas het filter of de zoekterm aan.</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(med => buildCard(med, hasSpecies ? species : null, hasWeight ? weight : 0)).join('');

  grid.querySelectorAll('.card-detail-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(btn.dataset.id, hasSpecies ? species : null, hasWeight ? weight : 0);
    });
  });
  grid.querySelectorAll('.med-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id, hasSpecies ? species : null, hasWeight ? weight : 0));
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
    { level: 'danger',  text: '<strong>Fipronil (Frontline):</strong> LETAAL bij konijnen – nooit toepassen!' },
    { level: 'warning', text: '<strong>Corticosteroïden:</strong> Verhogen sterk het risico op latente infecties (bijv. E. cuniculi reactivatie).' },
    { level: 'warning', text: '<strong>GI-stasis:</strong> Bij verminderde darmmotiliteit altijd vloeistof en prokinetisch middel inzetten.' },
  ],
  hond: [
    { level: 'danger',  text: '<strong>Ivermectine bij MDR1-rassen:</strong> Levensgevaarlijk bij Collie, Shetland Sheepdog, Australian Shepherd, Border Collie e.a. zonder MDR1-test.' },
  ],
  paard: [
    { level: 'danger',  text: '<strong>Dexamethason:</strong> Laminitisrisico bij paarden – voorzichtig toepassen.' },
    { level: 'danger',  text: '<strong>Procaïnepenicilline IV:</strong> LETAAL – uitsluitend IM toedienen!' },
    { level: 'danger',  text: '<strong>Acepromazine IV:</strong> Levensgevaarlijk bij paarden – uitsluitend IM.' },
  ],
};

function renderAlerts(species) {
  const zone = document.getElementById('alert-zone');
  if (!species) { zone.innerHTML = ''; return; }
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
  const brandText = (med.merknamen || []).slice(0, 3).join(', ');

  // When no species: show species availability chips + general info
  if (!species) {
    return buildCardNoSpecies(med, brandText);
  }

  const sd = med.soorten[species];
  const hasDanger  = med.toxiciteit || sd.toxiciteit ||
    (sd.waarschuwingen || []).some(w =>
      w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') ||
      w.startsWith('HOOG RISICO') || w.startsWith('ABSOLUTE') || w.startsWith('LEVENSGEVAARLIJK'));
  const hasWarning = !hasDanger && (sd.waarschuwingen || []).length > 0;

  const cardClass = hasDanger ? 'has-danger' : hasWarning ? 'has-warning' : '';

  let doseSectionHtml = '';
  if (sd.dosis && weight > 0 && sd.dosis.min > 0) {
    const dMin = sd.dosis.min * weight;
    const dMax = sd.dosis.max * weight;
    const showRange = Math.abs(dMin - dMax) > 0.001;
    doseSectionHtml = `
      <div class="dose-block">
        <div class="dose-block-title">Dosis voor ${formatNum(weight)} kg</div>
        <div class="dose-row">
          <span class="dose-label">Totaaldosis:</span>
          <span class="dose-value">${showRange ? formatNum(dMin) + ' – ' + formatNum(dMax) : formatNum(dMin)}</span>
          <span class="dose-unit">mg</span>
        </div>
        ${buildRouteRows(sd, dMin, dMax)}
        <div class="freq-row">Frequentie: <span>${escHtml(sd.dosis.frequentie)}</span></div>
        ${sd.dosis.opmerkingen ? `<div class="dose-note">${escHtml(sd.dosis.opmerkingen)}</div>` : ''}
      </div>`;
  } else if (sd.dosis && weight <= 0) {
    doseSectionHtml = `
      <div class="dose-block dose-block-hint">
        <div class="dose-block-title">Dosering (per kg)</div>
        <div class="dose-row">
          <span class="dose-label">Bereik:</span>
          <span class="dose-value">${sd.dosis.min === sd.dosis.max ? sd.dosis.min : sd.dosis.min + ' – ' + sd.dosis.max}</span>
          <span class="dose-unit">${escHtml(sd.dosis.eenheid)}</span>
        </div>
        <div class="freq-row">Frequentie: <span>${escHtml(sd.dosis.frequentie)}</span></div>
        <div class="dose-note">Voer gewicht in voor exacte berekening</div>
      </div>`;
  } else if (sd.dosis && sd.dosis.min === 0) {
    doseSectionHtml = `<div class="warn-tag warn-tag-danger" style="margin-bottom:.5rem">NIET TOEPASSEN BIJ DEZE SOORT</div>`;
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
        ${hasDanger && (med.toxiciteit || sd.toxiciteit) ? `<div class="warn-tag warn-tag-danger">⚠ ${escHtml(med.toxiciteit || sd.toxiciteit)}</div>` : ''}
        ${doseSectionHtml}
        ${warnHtml}
      </div>
      <div class="card-footer">
        <span class="card-sources">${(sd.bronnen || []).join(', ')}</span>
        <button class="card-detail-btn" data-id="${med.id}">Details →</button>
      </div>
    </div>`;
}

function buildCardNoSpecies(med, brandText) {
  const availableSpecies = Object.keys(med.soorten);
  const speciesChips = availableSpecies
    .map(s => `<span class="species-chip">${SPECIES_LABELS[s] || s}</span>`)
    .join('');

  return `
    <div class="med-card" data-id="${med.id}" tabindex="0" role="button" aria-label="${med.naam}">
      <div class="card-header">
        <div>
          <div class="card-title">${escHtml(med.naam)}</div>
          <div class="card-subtitle">${escHtml(med.werkzameStof)}${brandText ? ` · <em>${escHtml(brandText)}</em>` : ''}</div>
        </div>
        <span class="badge badge-${med.categorie}">${ucFirst(med.categorie)}</span>
      </div>
      <div class="card-body">
        <p class="card-desc">${escHtml(med.beschrijving || '')}</p>
        <div class="species-chips">${speciesChips}</div>
        <div class="dose-hint">Selecteer diersoort + gewicht voor dosisberekening</div>
      </div>
      <div class="card-footer">
        <span class="card-sources">${availableSpecies.length} diersoort${availableSpecies.length !== 1 ? 'en' : ''}</span>
        <button class="card-detail-btn" data-id="${med.id}">Details →</button>
      </div>
    </div>`;
}

function buildRouteRows(sd, dMin, dMax) {
  const rows = [];
  if (!sd.toediening) return '';
  if (sd.toediening.injectie) {
    const conc = sd.toediening.injectie.concentratie;
    if (conc) {
      const vMin = dMin / conc, vMax = dMax / conc;
      const routes = (sd.toediening.injectie.routes || []).join('/');
      rows.push(`<div class="dose-row">
        <span class="dose-label">Injectie (${routes || 'IM/SC'}):</span>
        <span class="dose-value">${Math.abs(vMin-vMax) > 0.001 ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)}</span>
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
        <span class="dose-value">${Math.abs(vMin-vMax) > 0.001 ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)}</span>
        <span class="dose-unit">ml (${o.concentratie} mg/ml)</span>
      </div>`);
    } else if (o.type === 'tablet' && o.tabletGrootten) {
      const tabletInfo = o.tabletGrootten.map(t => {
        const n = dMax / t;
        return `${formatNum(n)} × ${t}mg`;
      }).join(' | ');
      rows.push(`<div class="dose-row">
        <span class="dose-label">Tablet:</span>
        <span class="dose-value dose-unit" style="font-size:.8rem">${tabletInfo}</span>
      </div>`);
    }
  }
  return rows.join('');
}

function buildWarningsShort(sd, hasDanger) {
  const warnings = (sd.waarschuwingen || []).slice(0, 3);
  if (!warnings.length) return '';
  const items = warnings.map(w => {
    const isDanger = w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') ||
      w.startsWith('HOOG RISICO') || w.startsWith('ABSOLUTE') || w.startsWith('LEVENSGEVAARLIJK') || w.startsWith('KRITIEK');
    return `<li class="${isDanger ? 'danger' : ''}">${escHtml(w)}</li>`;
  }).join('');
  return `<ul class="warn-list">${items}</ul>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id, species, weight) {
  const med = allMedications.find(m => m.id === id);
  if (!med) return;

  // If no species, show overview of all species dosing
  if (!species) {
    renderModalOverview(med);
  } else {
    renderModalSpecies(med, species, weight);
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-box').scrollTop = 0;
}

function renderModalOverview(med) {
  const brandText = (med.merknamen || []).join(', ');
  const speciesList = Object.keys(med.soorten);

  const speciesRows = speciesList.map(s => {
    const sd = med.soorten[s];
    if (!sd.dosis) return '';
    const label = SPECIES_LABELS[s] || s;
    const hasDanger = sd.toxiciteit || (sd.waarschuwingen || []).some(w =>
      w.startsWith('GEVAAR') || w.startsWith('LETAAL') || w.startsWith('ABSOLUTE') || w.startsWith('CRITIEK'));
    const doseStr = sd.dosis.min === 0
      ? '<span style="color:var(--red);font-weight:700">NIET TOEPASSEN</span>'
      : (sd.dosis.min === sd.dosis.max ? sd.dosis.min : `${sd.dosis.min}–${sd.dosis.max}`) + ` ${sd.dosis.eenheid}`;
    const warn = hasDanger ? ' <span style="color:var(--red)">⚠</span>' : '';
    return `<tr><td>${label}${warn}</td><td><strong>${doseStr}</strong></td><td>${escHtml(sd.dosis.frequentie)}</td></tr>`;
  }).filter(Boolean).join('');

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-med-name">${escHtml(med.naam)}</div>
    <div class="modal-werkzame">Werkzame stof: ${escHtml(med.werkzameStof)}</div>
    ${brandText ? `<div class="modal-merknamen">Merknamen: ${escHtml(brandText)}</div>` : ''}
    <p style="font-size:.85rem;color:var(--gray-600);margin:.5rem 0 1rem">${escHtml(med.beschrijving || '')}</p>
    <div class="modal-section">
      <div class="modal-section-title">Dosering per diersoort</div>
      <table class="detail-table">
        <thead><tr><th>Diersoort</th><th>Dosis</th><th>Frequentie</th></tr></thead>
        <tbody>${speciesRows}</tbody>
      </table>
    </div>
    <p style="font-size:.75rem;color:var(--gray-400);margin-top:1rem">Selecteer een diersoort en vul het gewicht in voor berekende doseringen per kg.</p>`;
}

function renderModalSpecies(med, species, weight) {
  const sd = med.soorten[species];
  const speciesLabel = document.getElementById('species').selectedOptions[0].text;

  let dosCalc = '';
  if (sd.dosis && weight > 0 && sd.dosis.min > 0) {
    const dMin = sd.dosis.min * weight;
    const dMax = sd.dosis.max * weight;
    const showRange = Math.abs(dMin - dMax) > 0.001;
    dosCalc = `
      <div class="modal-section">
        <div class="modal-section-title">Berekende dosering – ${escHtml(speciesLabel)} ${formatNum(weight)} kg</div>
        <table class="detail-table">
          <tr><td>Totaaldosis</td><td><strong>${showRange ? formatNum(dMin) + ' – ' + formatNum(dMax) : formatNum(dMin)} mg</strong></td></tr>
          <tr><td>Per kg</td><td>${sd.dosis.min}${showRange ? ' – ' + sd.dosis.max : ''} ${escHtml(sd.dosis.eenheid)}</td></tr>
          <tr><td>Frequentie</td><td>${escHtml(sd.dosis.frequentie)}</td></tr>
          ${sd.dosis.opmerkingen ? `<tr><td>Opmerking</td><td><em>${escHtml(sd.dosis.opmerkingen)}</em></td></tr>` : ''}
        </table>
      </div>
      ${buildModalRoutes(sd, dMin, dMax)}`;
  } else if (sd.dosis && sd.dosis.min === 0) {
    dosCalc = `<div class="modal-section"><div class="modal-section-title">Dosering</div>
      <p style="color:var(--red);font-weight:700">NIET TOEPASSEN BIJ DEZE SOORT</p></div>`;
  } else if (sd.dosis) {
    dosCalc = `
      <div class="modal-section">
        <div class="modal-section-title">Dosering – ${escHtml(speciesLabel)}</div>
        <table class="detail-table">
          <tr><td>Per kg</td><td>${sd.dosis.min}${sd.dosis.min !== sd.dosis.max ? ' – ' + sd.dosis.max : ''} ${escHtml(sd.dosis.eenheid)}</td></tr>
          <tr><td>Frequentie</td><td>${escHtml(sd.dosis.frequentie)}</td></tr>
          ${sd.dosis.opmerkingen ? `<tr><td>Opmerking</td><td><em>${escHtml(sd.dosis.opmerkingen)}</em></td></tr>` : ''}
        </table>
        <p style="font-size:.75rem;color:var(--gray-400);margin-top:.5rem">Voer gewicht in voor exacte berekening</p>
      </div>`;
  }

  let warnHtml = '';
  if (sd.waarschuwingen && sd.waarschuwingen.length) {
    const items = sd.waarschuwingen.map(w => {
      const isDanger = w.startsWith('GEVAAR') || w.startsWith('CRITIEK') || w.startsWith('LETAAL') ||
        w.startsWith('HOOG RISICO') || w.startsWith('ABSOLUTE') || w.startsWith('LEVENSGEVAARLIJK') || w.startsWith('KRITIEK');
      return `<li class="${isDanger ? 'warn-danger' : 'warn-warning'}">${escHtml(w)}</li>`;
    }).join('');
    warnHtml = `<div class="modal-section">
      <div class="modal-section-title">Waarschuwingen</div>
      <ul class="modal-warn-list">${items}</ul>
    </div>`;
  }

  const toxHtml = (med.toxiciteit || sd.toxiciteit) ? `<div class="modal-section">
    <div class="modal-section-title">Toxiciteit</div>
    <p class="modal-ci"><strong>⚠ ${escHtml(med.toxiciteit || sd.toxiciteit)}</strong></p>
  </div>` : '';

  const ciHtml = sd.contra_indicaties && sd.contra_indicaties.length ? `<div class="modal-section">
    <div class="modal-section-title">Contra-indicaties</div>
    <p class="modal-ci">${sd.contra_indicaties.map(escHtml).join(', ')}</p>
  </div>` : '';

  const brandText = (med.merknamen || []).join(', ');

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-med-name">${escHtml(med.naam)}</div>
    <div class="modal-werkzame">Werkzame stof: ${escHtml(med.werkzameStof)}</div>
    ${brandText ? `<div class="modal-merknamen">Merknamen: ${escHtml(brandText)}</div>` : ''}
    <p style="font-size:.85rem;color:var(--gray-600);margin-bottom:.5rem">${escHtml(med.beschrijving || '')}</p>
    ${toxHtml}
    ${dosCalc}
    ${warnHtml}
    ${ciHtml}
    <div class="modal-section">
      <div class="modal-section-title">Bronnen</div>
      <p class="modal-sources">${(sd.bronnen || []).map(escHtml).join(' · ')}</p>
    </div>`;
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
      rows.push([`Injectie (${conc} mg/ml)`, `<strong>${Math.abs(vMin-vMax) > 0.001 ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)} ml</strong>`]);
    }
    if (t.injectie.opmerkingen) rows.push(['Injectie opmerking', escHtml(t.injectie.opmerkingen)]);
  }
  if (t.oraal) {
    const o = t.oraal;
    rows.push(['Toediening oraal', ucFirst(o.type || '—')]);
    if (o.concentratie && o.type === 'vloeistof') {
      const vMin = dMin / o.concentratie, vMax = dMax / o.concentratie;
      rows.push([`Oraal (${o.concentratie} mg/ml)`, `<strong>${Math.abs(vMin-vMax) > 0.001 ? formatNum(vMin) + ' – ' + formatNum(vMax) : formatNum(vMin)} ml</strong>`]);
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
  if (n < 1)    return parseFloat(n.toFixed(3)).toString();
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
