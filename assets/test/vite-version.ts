import { version } from 'vite';

const [major, minor] = version.split('.').map(Number);

// The top-level `input` option landed in Vite 8.2; 8.1 and older only have `build.rollupOptions.input`.
export const hasTopLevelInput = major > 8 || (major === 8 && minor >= 2);
