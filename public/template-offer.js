// A template's offer after a switch (plan-environment-templates.md, "Addendum: switching a template", GitHub #59), shared
// by Manage's Template tab and the host console's environment card. The offer is what the server answers with a switch:
// { modules: [{ id, name, allowed, why? }], lobby: { name, description } | null, spaceDefaults: { profile } | null,
// reactions: [{ id, glyph, label }] | null, theme: { name, author? } | null, iconSet: [Font Awesome names] | null }
// (addendum 2, "templates grow").
// Modules are ticked by default; one the plan leaves out is shown unticked and disabled, with the server's why. The
// Lobby, the new-space profile, the reactions, the theme and the icons are unticked (the Lobby's words are the owner's by now). Apply sends what is ticked
// ({ modules, lobby, spaceDefaults, reactions, theme, iconSet }); even with nothing ticked it closes the offer. Not now only hides it here.
import { escapeHtml, word } from '/brand.js';

const sentence = (text) => {
  const t = String(text || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : '';
};
const PROFILE_LABELS = { roleplaying: 'Roleplaying', participants: 'Participants', characters: 'Characters' };

// The question before a switch: what changes at once, and that nothing is turned off. `name` is the template's, or
// null for no template.
export function switchQuestion(name) {
  const what = `Words, icons and ${word('module')} names`;
  return name
    ? `Switch to the ${name} template?\n\n${what} change now. Nothing is turned off or removed. Then you choose what else it turns on.`
    : `Switch to no template?\n\n${what} go back to the default ones (or your own) now. Nothing is turned off or removed.`;
}

// True when the offer has anything to tick.
const hasExtras = (offer) => Boolean(offer && (offer.lobby || offer.spaceDefaults || offer.reactions || offer.theme || (offer.iconSet && offer.iconSet.length)));
export const offerHasChoices = (offer) => Boolean(offer && ((offer.modules || []).length || hasExtras(offer)));

// Draws the offer into `box`. `templateName` names the template; `lobbyName` is the Lobby's name as the environment has
// it (the console doesn't know it: "the Lobby"). `apply(body)` sends the confirmed part and resolves once the caller has
// redrawn; `later()` hides the offer. Errors from apply are shown in the box as the server sent them.
export function renderOffer(box, { templateName, offer, lobbyName = '', apply, later }) {
  const lobby = !lobbyName || lobbyName === 'Lobby' ? 'the Lobby' : lobbyName; // as a sentence reads it
  const mods = (offer && offer.modules) || [];
  const uid = `offer-${Math.random().toString(36).slice(2, 8)}`;
  const moduleRow = (m) => {
    const why = m.allowed ? '' : sentence(m.why);
    return `<label class="check${m.allowed ? '' : ' offer-refused'}"><input type="checkbox" data-offer-module="${escapeHtml(m.id)}"${m.allowed ? ' checked' : ' disabled'}> <span><strong>${escapeHtml(m.name || m.id)}</strong>${why ? ` <span class="hint">${escapeHtml(why)}</span>` : ''}</span></label>`;
  };
  const lobbyRow = () => {
    const l = offer.lobby;
    const renames = l.name && l.name !== lobbyName;
    const text = renames ? `Name ${escapeHtml(lobby)} "${escapeHtml(l.name)}"` : `Give ${escapeHtml(lobby)} the template's description`;
    return `<label class="check"><input type="checkbox" data-offer-lobby> <span>${text}${l.description ? ` <span class="hint">${escapeHtml(l.description)}</span>` : ''}</span></label>`;
  };
  const profileRow = () => {
    const p = offer.spaceDefaults.profile;
    return `<label class="check"><input type="checkbox" data-offer-space-defaults> <span>New ${escapeHtml(word('space', { many: true }))} use the ${escapeHtml(PROFILE_LABELS[p] || p)} profile</span></label>`;
  };
  const reactionsRow = () => {
    const list = offer.reactions;
    const glyphs = list.map((r) => r.glyph).join(' ');
    return `<label class="check"><input type="checkbox" data-offer-reactions> <span>${list.length ? 'Use its reactions' : 'Turn reactions off'}${glyphs ? ` <span class="offer-glyphs">${escapeHtml(glyphs)}</span>` : ''} <span class="hint">Replaces the reactions you have.</span></span></label>`;
  };
  const themeRow = () => {
    const t = offer.theme;
    return `<label class="check"><input type="checkbox" data-offer-theme> <span>Add and use the ${escapeHtml(t.name)} theme${t.author ? ` <span class="hint">by ${escapeHtml(t.author)}</span>` : ''}</span></label>`;
  };
  const iconSetRow = () => {
    const names = offer.iconSet;
    const shown = names.slice(0, 12).map((n) => `<i class="fa-solid fa-${escapeHtml(n)} fa-fw" aria-hidden="true"></i>`).join('');
    return `<label class="check"><input type="checkbox" data-offer-icon-set> <span>Add its ${names.length === 1 ? 'icon' : `${names.length} icons`} to the icon list <span class="offer-icons">${shown}</span></span></label>`;
  };
  const any = offerHasChoices(offer);
  box.innerHTML = `
    <div class="template-offer" role="group" aria-labelledby="${uid}">
      <h3 id="${uid}">What the ${escapeHtml(templateName)} template can add</h3>
      ${any ? `<p class="hint">Untick anything you don't want. Nothing you have now is turned off.</p>` : `<p class="hint">Nothing more to add: what it lists is already on.</p>`}
      ${mods.length ? `<div class="offer-group"><span class="field-label">Turn on</span>${mods.map(moduleRow).join('')}<p class="hint">Each goes on in every ${escapeHtml(word('space'))}. ${escapeHtml(lobby[0].toUpperCase() + lobby.slice(1))} keeps only chat, the call and ${escapeHtml(word('module', { many: true }))} made for it.</p></div>` : ''}
      ${hasExtras(offer) ? `<div class="offer-group"><span class="field-label">Also</span>${offer.lobby ? lobbyRow() : ''}${offer.spaceDefaults ? profileRow() : ''}${offer.reactions ? reactionsRow() : ''}${offer.theme ? themeRow() : ''}${offer.iconSet && offer.iconSet.length ? iconSetRow() : ''}</div>` : ''}
      <div class="row">
        <button class="btn btn-primary" type="button" data-offer-apply>${any ? 'Apply' : 'Done'}</button>
        <button class="btn" type="button" data-offer-later>Not now</button>
        <span class="status" data-offer-status role="status"></span>
      </div>
    </div>`;
  box.hidden = false;
  const status = box.querySelector('[data-offer-status]');
  box.querySelector('[data-offer-later]').addEventListener('click', () => later && later());
  box.querySelector('[data-offer-apply]').addEventListener('click', async () => {
    const body = {
      modules: [...box.querySelectorAll('[data-offer-module]:checked:not(:disabled)')].map((i) => i.dataset.offerModule),
      lobby: Boolean(box.querySelector('[data-offer-lobby]')?.checked),
      spaceDefaults: Boolean(box.querySelector('[data-offer-space-defaults]')?.checked),
      reactions: Boolean(box.querySelector('[data-offer-reactions]')?.checked),
      theme: Boolean(box.querySelector('[data-offer-theme]')?.checked),
    };
    // Sent only when offered, so a server without icon sets never sees the field.
    if (offer && offer.iconSet) body.iconSet = Boolean(box.querySelector('[data-offer-icon-set]')?.checked);
    const buttons = box.querySelectorAll('button, input');
    for (const b of buttons) b.disabled = true;
    status.classList.remove('error');
    status.textContent = body.modules.length ? `Turning on ${body.modules.length === 1 ? `1 ${word('module')}` : `${body.modules.length} ${word('module', { many: true })}`}...` : 'Applying...';
    try {
      await apply(body);
    } catch (err) {
      for (const b of buttons) b.disabled = b.matches('[data-offer-module]') && b.closest('.offer-refused') ? true : false;
      status.textContent = err.message; // the server's own sentence
      status.classList.add('error');
    }
  });
}
