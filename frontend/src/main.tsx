/* @refresh reload */
import { render } from 'solid-js/web';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import './app.css';
import App from './App';

const root = document.getElementById('app');

if (root instanceof HTMLElement) {
  render(() => <App />, root);
}
