// Tags in the interface: chips on rows, the picker of the entry, template
// and quick entry dialogs, and the bulk "add tag" / "remove tag" dialog of
// the month view. The money of a tag lives in tags.js.

import { store } from './store.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { h, clear, icon, field, selectEl, openModal, refreshIcons } from './ui.js';
import { makeTag, TAG_COLORS, live } from './model.js';
import { sortedTags, withTag, withoutTag } from './tags.js';

function tagById(id) {
  return (store.data.tags || []).find(x => x.id === id && !x.deleted) || null;
}

export function tagChip(tag, { small = true } = {}) {
  return h('span', { class: `tag-chip tag-${tag.color || TAG_COLORS[0]} ${small ? 'is-small' : ''}`.trim() }, tag.name);
}

// The chips of an entry's tags, or null when it has none (deleted tags are
// skipped: another device may not have dropped the id yet).
export function tagChips(entry) {
  const tags = (entry.tagIds || []).map(tagById).filter(Boolean);
  if (!tags.length) return null;
  return h('span', { class: 'tag-chips' }, tags.map(tag => tagChip(tag)));
}

// Options for a tag filter: every tag that is not archived, and the one
// already chosen even if it is.
export function tagFilterOptions(emptyLabel, selected = '') {
  return [{ value: '', label: emptyLabel }].concat(
    sortedTags(store.data, { includeArchived: true })
      .filter(tag => !tag.archived || tag.id === selected)
      .map(tag => ({ value: tag.id, label: tag.name })));
}

// The next color for a new tag: the one used least, so tags made one after
// another do not all come out blue.
export function nextTagColor() {
  const used = new Map(TAG_COLORS.map(c => [c, 0]));
  live(store.data.tags).forEach(tag => { if (used.has(tag.color)) used.set(tag.color, used.get(tag.color) + 1); });
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

// Chips that switch a tag on and off, and a small field for a new tag.
// New tags wait in the picker until save() is called, so a dialog closed
// without saving leaves none behind. save() returns the chosen ids.
export function tagPicker(selected = []) {
  const chosen = new Set(selected || []);
  const pending = [];
  const chips = h('div', { class: 'tag-picker-chips' });
  const nameInput = h('input', {
    type: 'text', class: 'tag-new-input', placeholder: t('tag-new-placeholder'), 'aria-label': t('tag-new'),
    autocomplete: 'off', enterkeyhint: 'done', 'data-own-enter': '1'
  });
  const addBox = h('div', { class: 'tag-new', hidden: true }, nameInput,
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => addNew() }, t('add')));
  const openAdd = h('button', {
    type: 'button', class: 'tag-chip tag-chip-add', onclick: () => {
      addBox.hidden = false;
      openAdd.hidden = true;
      nameInput.focus();
    }
  }, icon('plus', 'inline-icon'), t('tag-new'));

  function all() {
    const known = sortedTags(store.data, { includeArchived: true }).filter(tag => !tag.archived || chosen.has(tag.id));
    return known.concat(pending);
  }

  function draw() {
    clear(chips);
    all().forEach(tag => {
      const on = chosen.has(tag.id);
      chips.appendChild(h('button', {
        type: 'button', class: `tag-chip tag-${tag.color} ${on ? 'is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (chosen.has(tag.id)) chosen.delete(tag.id);
          else chosen.add(tag.id);
          draw();
        }
      }, on ? icon('check', 'inline-icon') : null, tag.name));
    });
    chips.appendChild(openAdd);
    refreshIcons();
  }

  function addNew() {
    const name = nameInput.value.trim();
    if (!name) return;
    const same = all().find(tag => tag.name.toLowerCase() === name.toLowerCase());
    if (same) {
      chosen.add(same.id);
    } else {
      const tag = makeTag({ name, color: nextTagColor() });
      // Two new tags in a row get different colors too.
      if (pending.length) tag.color = TAG_COLORS[(TAG_COLORS.indexOf(pending[pending.length - 1].color) + 1) % TAG_COLORS.length];
      pending.push(tag);
      chosen.add(tag.id);
    }
    nameInput.value = '';
    addBox.hidden = true;
    openAdd.hidden = false;
    draw();
  }

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNew(); }
  });
  draw();

  return {
    el: h('div', { class: 'tag-picker' }, chips, addBox),
    save() {
      // A name typed but not confirmed with "Add" still counts.
      if (nameInput.value.trim()) addNew();
      const fresh = pending.filter(tag => chosen.has(tag.id));
      if (fresh.length) store.addMany('tags', fresh);
      pending.length = 0;
      return [...chosen].filter(id => tagById(id));
    }
  };
}

// Adds one tag to the ticked entries or takes it away, in one step with
// undo. Removing offers only the tags the entries carry.
export function openBulkTagModal(ids, mode = 'add') {
  const entries = live(store.data.entries).filter(e => ids.includes(e.id));
  if (!entries.length) return;
  const carried = new Set(entries.flatMap(e => e.tagIds || []));
  const tags = sortedTags(store.data).filter(tag => mode === 'add' || carried.has(tag.id));
  if (mode === 'remove' && !tags.length) {
    showToast(t('bulk-tag-none'), { type: 'info' });
    return;
  }
  const options = tags.map(tag => ({ value: tag.id, label: tag.name }));
  if (mode === 'add') options.push({ value: '__new', label: t('tag-new-option') });
  const tagSel = selectEl(options, options.length ? options[0].value : '');
  const name = h('input', { type: 'text', placeholder: t('tag-new-placeholder'), autocomplete: 'off' });
  const nameField = field(t('tag-new'), name);
  const sync = () => { nameField.hidden = tagSel.value !== '__new'; };
  tagSel.addEventListener('change', () => { sync(); if (!nameField.hidden) name.focus(); });
  sync();

  openModal({
    title: t(mode === 'add' ? 'bulk-tag-add-title' : 'bulk-tag-remove-title', { n: entries.length }),
    body: h('div', { class: 'form-stack' }, field(t('field-tag'), tagSel), mode === 'add' ? nameField : null),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t(mode === 'add' ? 'sel-tag-add' : 'sel-tag-remove'), kind: 'primary', onClick: (m) => {
          const snap = store.snapshot();
          let tagId = tagSel.value;
          if (tagId === '__new') {
            const text = name.value.trim();
            if (!text) { showToast(t('err-name'), { type: 'error' }); return false; }
            const existing = live(store.data.tags).find(tag => tag.name.toLowerCase() === text.toLowerCase());
            tagId = existing ? existing.id : store.add('tags', makeTag({ name: text, color: nextTagColor() })).id;
          }
          if (!tagId) return false;
          const changed = store.bulkUpdate(entries.map(e => e.id),
            (e) => ({ tagIds: mode === 'add' ? withTag(e.tagIds, tagId) : withoutTag(e.tagIds, tagId) }),
            { skip: (e) => (mode === 'add') === (e.tagIds || []).includes(tagId) });
          showToast(t(mode === 'add' ? 'toast-bulk-tag-added' : 'toast-bulk-tag-removed', { n: changed }), {
            type: 'success', actionLabel: t('undo'), onAction: () => store.restore(snap)
          });
          m.close();
          return true;
        }
      }
    ]
  });
}
