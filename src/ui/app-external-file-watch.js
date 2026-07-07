import { createExternalFileWatchController } from "./controllers/external-file-watch-controller.js";

export function createAppExternalFileWatchBridge({ state, els }) {
  const hooks = {
    syncDocumentBaseline: async () => {},
    forgetDocument: () => {},
    resolveReloadedDocument: () => {}
  };

  function attach(documentController) {
    const controller = createExternalFileWatchController({
      state,
      els,
      reloadDocumentAtIndex: (index, options) => documentController.reloadDocumentAtIndex(index, options),
      isDocumentSavePending: (doc) => documentController.isSavePending(doc)
    });
    hooks.syncDocumentBaseline = (doc) => controller.syncDocumentBaseline(doc);
    hooks.forgetDocument = (doc) => controller.forgetDocument(doc);
    hooks.resolveReloadedDocument = (doc) => controller.resolveReloadedDocument(doc);
    controller.start();
  }

  return {
    attach,
    syncExternalFileBaseline: (doc) => hooks.syncDocumentBaseline(doc),
    forgetExternalFileWatch: (doc) => hooks.forgetDocument(doc),
    resolveExternalFileChangeAfterReload: (doc) => hooks.resolveReloadedDocument(doc)
  };
}
