import { render } from 'preact';
import { App, createDefaultServices } from './screens';
import { Welcome, takeFirstRun } from './screens/welcome';
import { installTheme } from './ui';
import './ui/theme.css';
import './screens/screens.css';

installTheme();

createDefaultServices().then(
  (services) => render(
    <>
      <App services={services} />
      {takeFirstRun() && <Welcome />}
    </>,
    document.getElementById('app')!,
  ),
  () => {
    document.getElementById('app')!.textContent = 'לא ניתן לפתוח את האחסון המקומי. נסה לטעון מחדש.';
  },
);
