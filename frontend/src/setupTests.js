import '@testing-library/jest-dom/vitest'

// axe probes <canvas> for icon fonts; jsdom has no canvas and logs a noisy "not implemented" error.
HTMLCanvasElement.prototype.getContext = () => null
