/**
 * Toast utility — triggers a non-blocking notification via custom DOM event.
 * @param message - Text to display
 * @param type - Visual style (default 'success')
 */
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('app:toast', {
      detail: { message, type, id: Date.now() + Math.random() }
    })
  );
}
