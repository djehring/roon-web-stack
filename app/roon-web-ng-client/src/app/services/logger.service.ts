import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class LoggerService {
  error(message: string, error?: unknown): void {
    // eslint-disable-next-line no-console
    console.error(message, error);
  }

  info(message: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.info(message, ...args);
  }
}
