import { DOCUMENT } from "@angular/common";
import { inject, Injectable, OnDestroy } from "@angular/core";
import {
  containerClass,
  dataContainerPrioritizedChildrenAttribute,
  Direction,
  getNextFocus,
  isSnKeyboardEvent,
} from "./ngx-spatial-navigable-utils";

@Injectable({
  providedIn: "root",
})
export class NgxSpatialNavigableService implements OnDestroy {
  private readonly _document: Document;
  private _rootElement: HTMLElement;
  private readonly _starter: HTMLElement[];
  private _dialogElement?: HTMLElement;
  private _focusedElement?: HTMLElement;
  private _isActive: boolean;

  constructor() {
    this._document = inject<Document>(DOCUMENT);
    this._isActive = true;
    this._starter = [];
    this._document.addEventListener("keydown", (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });
    this._rootElement = document.body;
  }

  ngOnDestroy(): void {
    this._document.removeEventListener("keydown", (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });
  }

  registerRoot(htmlElement: HTMLElement): void {
    this._rootElement = htmlElement;
  }

  registerStarter(htmlElement: HTMLElement): void {
    this._starter.push(htmlElement);
  }

  unregisterStarter(htmlElement: HTMLElement): void {
    const elementIndex = this._starter.findIndex((el: HTMLElement) => el === htmlElement);
    if (elementIndex >= 0) {
      this._starter.splice(elementIndex, 1);
    }
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (!this._isActive) {
      return;
    }
    const direction = isSnKeyboardEvent(event);
    if (direction) {
      event.preventDefault();
      const scope = this._dialogElement ?? this._rootElement;
      if (this._focusedElement) {
        this._focusedElement = this.getNextFocus(this._focusedElement ?? null, direction, scope);
      } else {
        this._focusedElement = this.getStarter();
      }
      this.focus();
    }
  }

  suspendSpatialNavigation() {
    this._isActive = false;
  }

  resumeSpatialNavigation() {
    this._isActive = true;
  }

  dialogOpened(htmlElement: HTMLElement, autofocus: string | false) {
    this._dialogElement = htmlElement;
    this._dialogElement.classList.add(containerClass);
    this._dialogElement.setAttribute(dataContainerPrioritizedChildrenAttribute, "true");
    delete this._focusedElement;
    if (autofocus) {
      this._focusedElement = this._document.querySelector(autofocus) ?? undefined;
      this.focus();
    }
  }

  dialogClosed() {
    this._dialogElement?.classList.remove(containerClass);
    this._dialogElement?.removeAttribute(dataContainerPrioritizedChildrenAttribute);
    delete this._dialogElement;
  }

  resetSpatialNavigation() {
    delete this._focusedElement;
  }

  private getStarter(): HTMLElement | undefined {
    return this._starter.at(-1);
  }

  private getNextFocus(current: HTMLElement | null, direction: Direction, scope: HTMLElement): HTMLElement | undefined {
    let candidate = current;
    let disabled = false;
    do {
      candidate = getNextFocus(candidate, direction, scope);
      disabled = candidate?.getAttribute("disabled") === "true";
    } while (disabled);
    return candidate ?? this.getStarter();
  }

  private focus(): void {
    if (this._focusedElement) {
      this._focusedElement.focus();
    }
  }
}
