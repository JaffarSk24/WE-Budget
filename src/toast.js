// Lightweight toasts instead of blocking alert().
// showToast(message, { type: 'success'|'error'|'info', actionLabel, onAction, duration })
// An action button (e.g. 'Undo') provides undo without confirm dialogs.

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, options = {}) {
  const { type = 'info', actionLabel = null, onAction = null, duration = 4500 } = options;

  const host = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  let timeoutId = null;
  const dismiss = () => {
    clearTimeout(timeoutId);
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 200);
  };

  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      onAction();
      dismiss();
    });
    toast.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', dismiss);
  toast.appendChild(closeBtn);

  host.appendChild(toast);
  timeoutId = setTimeout(dismiss, duration);
  return dismiss;
}
