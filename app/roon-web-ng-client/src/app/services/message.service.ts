// message.service.ts
import { Injectable } from "@angular/core";
import { MatSnackBar, MatSnackBarConfig } from "@angular/material/snack-bar";

@Injectable({
  providedIn: "root",
})
export class MessageService {
  private defaultConfig: MatSnackBarConfig = {
    duration: 3000,
    horizontalPosition: "center",
    verticalPosition: "bottom",
  };

  constructor(private snackBar: MatSnackBar) {}

  showMessage(message: string, action = "", config: Partial<MatSnackBarConfig> = {}) {
    return this.snackBar.open(message, action, { ...this.defaultConfig, ...config });
  }

  showMessageWithTimeout(message: string, action = "", duration = 3000) {
    return this.snackBar.open(message, action, {
      ...this.defaultConfig,
      panelClass: ["info-snackbar"],
      duration,
    });
  }

  showSuccess(message: string, duration = 3000) {
    this.showMessage(message, "", {
      duration,
      panelClass: ["success-snackbar"],
      horizontalPosition: "right",
    });
  }

  showError(message: string, error?: Error) {
    const errorMessage = error?.message ? `${message}: ${error.message}` : message;
    this.showMessage(errorMessage, "OK", {
      duration: 0,
      panelClass: ["error-snackbar"],
    });
  }
}
