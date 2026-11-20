// Order matters: the shared chunk's vendor CSS is imported first, so the entry's own CSS overrides it.
import './shared.js';
import './app.css';

export const app = 1;
