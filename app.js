(() => {
  const STORAGE_KEY = 'worldsAtWarRegistrationsV1';
  const categories = ['appetizers', 'mains', 'desserts', 'drinks'];
  const labels = { appetizers: 'Appetizers', mains: 'Main courses', desserts: 'Desserts', drinks: 'Drinks' };
  const read = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { players: [], food: [] }; } catch { return { players: [], food: [] }; } };
  const save = data => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  let data = read();
  const $ = s => document.querySelector(s);

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== `panel-${tab.dataset.tab}`; });
  }));
  document.querySelectorAll('input[name="attendance"]').forEach(input => input.addEventListener('change', () => { $('#player-options').hidden = input.value !== 'play' || !input.checked; }));
  document.querySelectorAll('input[name="setup"]').forEach(input => input.addEventListener('change', () => { $('#team-options').hidden = input.value !== 'own' || !input.checked; }));

  $('#civ-form').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim();
    if (!name) return;
    const previous = data.players.findIndex(person => person.name.toLowerCase() === name.toLowerCase());
    const registration = { id: previous >= 0 ? data.players[previous].id : crypto.randomUUID(), name,
      attendance: form.get('attendance'), setup: form.get('attendance') === 'play' ? form.get('setup') : '',
      teamMode: form.get('attendance') === 'play' && form.get('setup') === 'own' ? form.get('teamMode') : '' };
    if (previous >= 0) data.players[previous] = registration; else data.players.push(registration);
    save(data); $('#civ-message').textContent = `Registration saved for ${name}.`; renderTeams();
  });

  $('#food-form').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim();
    if (!name || !form.get('type')) return;
    const previous = data.food.findIndex(person => person.name.toLowerCase() === name.toLowerCase());
    const item = { id: previous >= 0 ? data.food[previous].id : crypto.randomUUID(), name, type: form.get('type'), dish: String(form.get('dish') || '').trim() };
    if (previous >= 0) data.food[previous] = item; else data.food.push(item);
    save(data); $('#food-message').textContent = `Potluck registration saved for ${name}.`; event.currentTarget.reset(); renderFood();
  });

  function playerTeams() {
    const hosts = data.players.filter(p => p.attendance === 'play' && p.setup === 'own');
    const joiners = data.players.filter(p => p.attendance === 'play' && p.setup === 'join');
    const openHosts = hosts.filter(p => p.teamMode === 'open');
    const soloHosts = hosts.filter(p => p.teamMode === 'solo');
    const stored = read().teams || {};
    const assignments = {};
    // Preserve chosen assignments while a host is still open and a player still wants a team.
    for (const host of openHosts) {
      const chosen = (stored[host.id] || []).map(id => joiners.find(p => p.id === id)).filter(Boolean);
      assignments[host.id] = chosen;
    }
    const assigned = new Set(Object.values(assignments).flat().map(p => p.id));
    const pending = joiners.filter(p => !assigned.has(p.id));
    for (const host of openHosts) { if (pending.length) assignments[host.id].push(pending.shift()); }
    return { hosts, openHosts, soloHosts, joiners, assignments, pending };
  }
  function renderTeams() {
    const { hosts, openHosts, soloHosts, joiners, assignments, pending } = playerTeams();
    const watchers = data.players.filter(p => p.attendance === 'watch').length;
    $('#team-summary').textContent = `${data.players.length} registered · ${hosts.length + joiners.length} playing · ${watchers} watching`;
    const cards = [];
    const hostCard = (host, mates, mode) => `<article class="team-card"><div class="team-card-header"><span>🏛 TEAM · ${escapeHTML(host.name).toUpperCase()}</span><span class="team-badge">${mode === 'solo' ? 'SOLO SETUP' : 'HOST SETUP'}</span></div><div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(host.name)} <small>host</small></span></div>${mates.map(mate => `<div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(mate.name)} <small>joining</small></span><select class="swap-select" aria-label="Switch ${escapeHTML(mate.name)} to another team" data-member="${mate.id}" data-current="${host.id}"><option value="${host.id}">This team</option>${openHosts.filter(other => other.id !== host.id).map(other => `<option value="${other.id}">Team ${escapeHTML(other.name)}</option>`).join('')}</select></div>`).join('')}</article>`;
    for (const host of openHosts) cards.push(hostCard(host, assignments[host.id] || [], 'open'));
    for (const host of soloHosts) cards.push(hostCard(host, [], 'solo'));
    if (!cards.length && !joiners.length) $('#teams-list').innerHTML = '<div class="empty-state"><span>🏛</span><strong>No players registered.</strong><p>Player registrations will appear here.</p></div>';
    else {
      const unmatched = [...pending, ...(!openHosts.length ? joiners : [])];
      const unique = [...new Map(unmatched.map(p => [p.id, p])).values()];
      if (unique.length) cards.push(`<div class="unmatched"><strong>Players without a team</strong>${unique.map(p => `<div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(p.name)}</span></div>`).join('')}${openHosts.length ? 'No additional open setups are available.' : 'No players have offered an open setup.'}</div>`);
      $('#teams-list').innerHTML = cards.join('');
      document.querySelectorAll('.swap-select').forEach(select => select.addEventListener('change', () => {
        const member = select.dataset.member, from = select.dataset.current, to = select.value;
        const stored = read().teams || {};
        stored[from] = (stored[from] || []).filter(id => id !== member);
        stored[to] = [...new Set([...(stored[to] || []), member])];
        data.teams = stored; save(data); renderTeams();
      }));
    }
  }
  function renderFood() {
    const counts = Object.fromEntries(categories.map(category => [category, data.food.filter(item => item.type === category).length]));
    const total = data.food.length; $('#food-total').textContent = `${total} ${total === 1 ? 'person' : 'people'}`;
    for (const category of categories) $(`#count-${category}`).textContent = counts[category];
    const widths = total ? categories.map(category => counts[category] / total) : [0, 0, 0, 0];
    categories.forEach((category, index) => { $(`.bar-${category}`).style.flex = widths[index] ? String(widths[index] * 100) : '0 0 0'; });
    const minimum = total ? Math.min(...categories.map(category => counts[category])) : 0;
    const least = categories.filter(category => counts[category] === minimum);
    $('#balance-tip').textContent = total === 0 ? 'No potluck registrations yet.' : least.length === categories.length ? 'All categories have equal registrations.' : `Fewest registrations: ${least.map(category => labels[category]).join(' or ')}.`;
    $('#food-roster-count').textContent = `${total} ${total === 1 ? 'dish' : 'dishes'}`;
    if (!total) {
      $('#food-list').innerHTML = '<div class="food-empty"><strong>No dishes registered yet.</strong><p>Potluck sign-ups will appear here.</p></div>';
      return;
    }
    const icons = { appetizers: '🥙', mains: '🍛', desserts: '🍰', drinks: '🥤' };
    $('#food-list').innerHTML = categories.flatMap(category => data.food
      .filter(item => item.type === category)
      .map(item => `<article class="food-card"><div class="food-card-header"><span>${icons[category]} ${labels[category]}</span></div><strong>${escapeHTML(item.name)}</strong><p>${item.dish ? escapeHTML(item.dish) : 'Dish details not added.'}</p></article>`))
      .join('');
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  $('#clear-data').addEventListener('click', () => { if (!data.players.length && !data.food.length) return; if (!window.confirm('Clear all sign-ups saved in this browser?')) return; data = { players: [], food: [] }; save(data); renderTeams(); renderFood(); $('#civ-message').textContent = ''; $('#food-message').textContent = ''; });
  renderTeams(); renderFood();
})();
