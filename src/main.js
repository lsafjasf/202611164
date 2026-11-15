import { StudioApp } from "./app.js";

const app = new StudioApp();
globalThis.__prismStudio = app;

app.doc.fonts?.ready?.then(() => app.renderCanvas()).catch(() => {});

if (globalThis.location?.hash === "#a11y") {
  app.el.a11yDialog?.showModal?.();
}
