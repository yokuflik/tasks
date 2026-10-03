import { render, h } from 'preact';
import { PwaOverlay } from './components';
import { registerServiceWorker } from './register';
import { isIos, isStandalone } from './standalone';
import './pwa.css';

let updateReady = false;
let apply = () => {};
const host = document.createElement('div');
host.id = 'pwa-overlay';
document.body.appendChild(host);

const draw = () =>
  render(
    h(PwaOverlay, {
      showInstallGuide: isIos() && !isStandalone(),
      updateReady,
      onApplyUpdate: apply,
    }),
    host,
  );
draw();

if (import.meta.env.PROD) {
  registerServiceWorker()
    .then((handle) => {
      if (!handle) return;
      apply = () => handle.applyUpdate();
      handle.onUpdateReady(() => {
        updateReady = true;
        draw();
      });
    })
    .catch(() => {
      // ההרשמה נכשלה (למשל מצב גלישה פרטית): האפליקציה ממשיכה לעבוד בלי עבודה לא מקוונת
    });
}
