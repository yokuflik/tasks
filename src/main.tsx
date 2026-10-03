import { render } from 'preact';
import { App, createDefaultServices } from './screens';
import { installTheme } from './ui';
import './ui/theme.css';
import './screens/screens.css';

installTheme();

createDefaultServices().then(
  (services) => render(<App services={services} />, document.getElementById('app')!),
  () => {
    document.getElementById('app')!.textContent = 'לא ניתן לפתוח את האחסון המקומי. נסה לטעון מחדש.';
  },
);
