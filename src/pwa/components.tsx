import { useState } from 'preact/hooks';

export function InstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <section class="pwa-sheet" role="dialog" aria-label="הוספה למסך הבית">
      <h2>להתקין למסך הבית</h2>
      <p>כדי שהנתונים יישמרו והאפליקציה תעבוד במסך מלא, התקינו אותה לפני שמזינים נתונים:</p>
      <ol>
        <li>לחצו על כפתור השיתוף <span aria-hidden="true">⎙</span> בשורה התחתונה של Safari.</li>
        <li>גללו ובחרו "הוספה למסך הבית".</li>
        <li>לחצו "הוספה" ופתחו את האפליקציה מהאייקון.</li>
      </ol>
      <p class="pwa-note">נתונים שהוזנו בלשונית Safari לא יופיעו באפליקציה המותקנת. אפשר להעביר אותם בייצוא וייבוא.</p>
      <button type="button" onClick={onClose}>הבנתי</button>
    </section>
  );
}

export function UpdateBanner({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div class="pwa-banner" role="status">
      <span>יש גרסה חדשה</span>
      <button type="button" onClick={onUpdate}>עדכן</button>
    </div>
  );
}

interface OverlayProps {
  showInstallGuide: boolean;
  updateReady: boolean;
  onApplyUpdate: () => void;
}

export function PwaOverlay({ showInstallGuide, updateReady, onApplyUpdate }: OverlayProps) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      {updateReady && <UpdateBanner onUpdate={onApplyUpdate} />}
      {showInstallGuide && !dismissed && <InstallGuide onClose={() => setDismissed(true)} />}
    </>
  );
}
