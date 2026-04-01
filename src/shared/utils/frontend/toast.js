/**
 * Toast utility — triggers a non-blocking notification via custom DOM event.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} [type='success'] - Visual style
 */
export function showToast(message, type = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('app:toast', {
      detail: { message, type, id: Date.now() + Math.random() }
    })
  );
}
