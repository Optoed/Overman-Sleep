import { createRoot } from 'react-dom/client';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/manrope';
import '../app/globals.css';
import SleepApp from '../components/sleep/sleep-app';
createRoot(document.getElementById('root')!).render(<SleepApp/>);
