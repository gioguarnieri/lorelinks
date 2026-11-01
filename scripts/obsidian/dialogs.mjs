import { exportVault } from "./export.mjs";
import { importVault } from "./import.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * A labelled checkbox for a dialog form.
 * @param {string} name
 * @param {string} labelKey
 * @param {boolean} checked
 * @returns {string}
 */
function checkbox(name, labelKey, checked = true) {
  return `<label class="checkbox"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
    ${game.i18n.localize(labelKey)}</label>`;
}

/**
 * Ask for export options, then export the world as a zipped Obsidian vault.
 */
export async function openExportDialog() {
  const options = await DialogV2.prompt({
    window: { title: "LORELINKS.Obsidian.Export.Title", icon: "fa-solid fa-file-export" },
    content: `<p>${game.i18n.localize("LORELINKS.Obsidian.Export.Hint")}</p>
      <div class="lorelinks-obsidian-options">
        ${checkbox("actors", "LORELINKS.Obsidian.Export.Actors")}
        ${checkbox("items", "LORELINKS.Obsidian.Export.Items")}
        ${checkbox("images", "LORELINKS.Obsidian.Export.Images")}
      </div>`,
    ok: {
      label: "LORELINKS.Obsidian.Export.Button",
      icon: "fa-solid fa-file-export",
      callback: (event, button) => {
        const form = button.form.elements;
        return { actors: form.actors.checked, items: form.items.checked, images: form.images.checked };
      }
    },
    rejectClose: false
  });
  if ( !options ) return;

  ui.notifications.info("LORELINKS.Obsidian.Export.Working", { localize: true });
  try {
    const result = await exportVault(options);
    ui.notifications.info("LORELINKS.Obsidian.Export.Done", { format: result });
    if ( result.missingImages ) {
      ui.notifications.warn("LORELINKS.Obsidian.Export.MissingImages", { format: { count: result.missingImages } });
    }
  } catch(err) {
    console.error(err);
    ui.notifications.error("LORELINKS.Obsidian.Export.Failed", { format: { error: err.message } });
  }
}

/**
 * Ask for a vault folder (or Markdown files) and import options, then import the notes as journal entries.
 */
export async function openImportDialog() {
  const choice = await DialogV2.prompt({
    window: { title: "LORELINKS.Obsidian.Import.Title", icon: "fa-solid fa-file-import" },
    content: `<p>${game.i18n.localize("LORELINKS.Obsidian.Import.Hint")}</p>
      <div class="form-group stacked">
        <label>${game.i18n.localize("LORELINKS.Obsidian.Import.Folder")}</label>
        <input type="file" name="folder" webkitdirectory multiple>
      </div>
      <div class="form-group stacked">
        <label>${game.i18n.localize("LORELINKS.Obsidian.Import.Files")}</label>
        <input type="file" name="files" accept=".md,.markdown,image/*" multiple>
      </div>
      <div class="lorelinks-obsidian-options">
        ${checkbox("folders", "LORELINKS.Obsidian.Import.KeepFolders")}
        ${checkbox("update", "LORELINKS.Obsidian.Import.Update")}
      </div>`,
    ok: {
      label: "LORELINKS.Obsidian.Import.Button",
      icon: "fa-solid fa-file-import",
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          files: [...form.folder.files, ...form.files.files],
          folders: form.folders.checked,
          update: form.update.checked
        };
      }
    },
    rejectClose: false
  });
  if ( !choice ) return;
  if ( !choice.files.some(f => /\.md$/i.test(f.name)) ) {
    return void ui.notifications.warn("LORELINKS.Obsidian.Import.NoNotes", { localize: true });
  }

  const progress = ui.notifications.info("LORELINKS.Obsidian.Import.Working", { localize: true, progress: true });
  try {
    const result = await importVault(choice.files, {
      folders: choice.folders,
      update: choice.update,
      onProgress: (done, total) => progress?.update?.({ pct: total ? done / total : 1 })
    });
    ui.notifications.info("LORELINKS.Obsidian.Import.Done", { format: result });
    if ( result.skipped ) ui.notifications.info("LORELINKS.Obsidian.Import.Skipped", { format: result });
    if ( result.failedImages.length ) {
      ui.notifications.warn("LORELINKS.Obsidian.Import.FailedImages", {
        format: { count: result.failedImages.length, names: result.failedImages.slice(0, 5).join(", ") }
      });
    }
  } catch(err) {
    console.error(err);
    ui.notifications.error("LORELINKS.Obsidian.Import.Failed", { format: { error: err.message } });
  } finally {
    progress?.update?.({ pct: 1 });
  }
}
