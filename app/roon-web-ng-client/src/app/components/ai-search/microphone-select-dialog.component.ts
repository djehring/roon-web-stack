import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";

@Component({
  selector: "nr-microphone-select-dialog",
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatFormFieldModule, MatSelectModule, MatButtonModule],
  styles: [
    `
      :host {
        display: block;
        background: var(--mat-dialog-container-background-color);
        padding: 24px;
        border-radius: 4px;
        color: var(--mat-dialog-container-color);
        min-height: 350px;
        position: relative;
      }
      .dialog-content {
        display: flex;
        flex-direction: column;
      }
      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      .mic-select {
        width: 100%;
        min-width: 300px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        position: absolute;
        bottom: 24px;
        left: 24px;
        right: 24px;
        padding-top: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
      }
    `,
  ],
  template: `
    <div class="dialog-content">
      <mat-form-field class="mic-select" appearance="fill">
        <mat-label>Select Microphone</mat-label>
        <mat-select [(value)]="selectedDeviceId" panelClass="dark-theme-dialog">
          <mat-option *ngFor="let device of audioDevices" [value]="device.deviceId">
            {{ device.label || "Default Microphone" }}
          </mat-option>
        </mat-select>
      </mat-form-field>
      <div class="actions">
        <button mat-button (click)="onCancel()">Cancel</button>
        <button mat-raised-button color="primary" (click)="onSave()">Save</button>
      </div>
    </div>
  `,
})
export class MicrophoneSelectDialogComponent implements OnInit {
  audioDevices: MediaDeviceInfo[] = [];
  selectedDeviceId = "";

  constructor(private dialogRef: MatDialogRef<MicrophoneSelectDialogComponent>) {}

  ngOnInit(): void {
    void this.loadAudioDevices();
  }

  private async loadAudioDevices(): Promise<void> {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter((device) => device.kind === "audioinput");

      // Load previously selected device
      const savedDeviceId = localStorage.getItem("preferredMicrophoneId");
      if (savedDeviceId) {
        this.selectedDeviceId = savedDeviceId;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error loading audio devices:", err);
    }
  }

  onSave(): void {
    localStorage.setItem("preferredMicrophoneId", this.selectedDeviceId);
    this.dialogRef.close(this.selectedDeviceId);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
