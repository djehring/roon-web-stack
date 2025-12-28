import { DOCUMENT } from "@angular/common";
import { inject, Injectable } from "@angular/core";
import { GramophoneShareDialogComponent } from "@components/gramophone-share-dialog/gramophone-share-dialog.component";
import { DialogService } from "@services/dialog.service";

/**
 * Payload extracted from Gramophone page by the bookmarklet
 */
export interface GramophonePayload {
  url: string;
  title: string;
  description?: string;
  selection?: string;
}

@Injectable({
  providedIn: "root",
})
export class GramophoneShareService {
  private static readonly GRAMOPHONE_HASH_PREFIX = "#gramophone=";
  private static readonly ALLOWED_HOST = "gramophone.co.uk";

  private readonly _window: Window;
  private readonly _dialogService: DialogService;

  constructor() {
    const document = inject<Document>(DOCUMENT);
    if (document.defaultView === null) {
      throw new Error("This app does not support server rendering!");
    }
    this._window = document.defaultView;
    this._dialogService = inject(DialogService);
  }

  /**
   * Checks the URL hash for a gramophone payload and opens the share dialog
   * if found. Should be called after the app has fully initialized.
   */
  checkHashAndOpenDialog(): void {
    const hash = this._window.location.hash;
    if (!hash.startsWith(GramophoneShareService.GRAMOPHONE_HASH_PREFIX)) {
      return;
    }

    const encodedPayload = hash.substring(GramophoneShareService.GRAMOPHONE_HASH_PREFIX.length);

    try {
      const payload = this.parseAndValidatePayload(encodedPayload);
      if (payload) {
        this.clearHash();
        this.openShareDialog(payload);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to parse Gramophone payload:", error);
      this.clearHash();
    }
  }

  private parseAndValidatePayload(encoded: string): GramophonePayload | null {
    const decoded = decodeURIComponent(encoded);
    const payload = JSON.parse(decoded) as GramophonePayload;

    // Validate required fields
    if (!payload.url || !payload.title) {
      // eslint-disable-next-line no-console
      console.error("Invalid Gramophone payload: missing url or title");
      return null;
    }

    // Validate URL host
    try {
      const url = new URL(payload.url);
      if (!url.host.endsWith(GramophoneShareService.ALLOWED_HOST)) {
        // eslint-disable-next-line no-console
        console.error(`Invalid Gramophone payload: URL host must be ${GramophoneShareService.ALLOWED_HOST}`);
        return null;
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error("Invalid Gramophone payload: invalid URL format");
      return null;
    }

    return payload;
  }

  private clearHash(): void {
    this._window.history.replaceState(null, "", this._window.location.pathname + this._window.location.search);
  }

  private openShareDialog(payload: GramophonePayload): void {
    this._dialogService.open(GramophoneShareDialogComponent, {
      data: payload,
      autoFocus: "input",
    });
  }

  /**
   * Determines the default search query based on the payload
   * Query precedence: selection > title > title + description
   */
  getDefaultQuery(payload: GramophonePayload): string {
    if (payload.selection && payload.selection.trim()) {
      return payload.selection.trim();
    }
    if (payload.title) {
      return payload.title.trim();
    }
    if (payload.title && payload.description) {
      return `${payload.title.trim()} ${payload.description.trim()}`;
    }
    return "";
  }
}
