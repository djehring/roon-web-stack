import { firstValueFrom } from "rxjs";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, inject, Output } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { RoonService } from "@services/roon.service";
import { MicrophoneSelectDialogComponent } from "./microphone-select-dialog.component";

@Component({
  selector: "nr-voice-recorder",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <button
      mat-icon-button
      [color]="isRecording ? 'warn' : 'primary'"
      (click)="toggleRecording()"
      (touchstart)="startPress($event)"
      (touchend)="endPress()"
      (mousedown)="startPress($event)"
      (mouseup)="endPress()"
      (mouseleave)="endPress()"
      aria-label="Record voice input"
    >
      <mat-icon>{{ isRecording ? "stop" : "mic" }}</mat-icon>
    </button>
  `,
})
export class VoiceRecorderComponent {
  @Output() transcriptionComplete = new EventEmitter<string>();
  @Output() recordingStarted = new EventEmitter<void>();

  private readonly dialog = inject(MatDialog);
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];
  private selectedDeviceId = "";
  isRecording = false;

  private readonly roonService = inject(RoonService);

  private pressTimer?: number;
  private readonly LONG_PRESS_DURATION = 500; // 500ms for long press

  async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      if (!this.selectedDeviceId && !localStorage.getItem("preferredMicrophoneId")) {
        const dialogRef = this.dialog.open(MicrophoneSelectDialogComponent);
        const result = (await firstValueFrom(dialogRef.afterClosed())) as string | undefined;
        if (result) {
          this.selectedDeviceId = result;
          await this.startRecording();
        }
      } else {
        this.selectedDeviceId = localStorage.getItem("preferredMicrophoneId") || "";
        await this.startRecording();
      }
    }
  }

  private async startRecording(): Promise<void> {
    try {
      this.recordingStarted.emit();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 44100,
        },
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm; codecs=opus",
        audioBitsPerSecond: 128000,
      });

      this.audioChunks = [];
      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        void this.handleRecordingComplete();
      };

      this.mediaRecorder.start(100);
      this.isRecording = true;
    } catch (err) {
      this.transcriptionComplete.emit(
        `Error accessing microphone. Please check permissions: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private stopRecording(): void {
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      this.isRecording = false;

      // Stop all tracks in the stream
      this.mediaRecorder.stream.getTracks().forEach((track) => {
        track.stop();
      });
    }
  }

  private async handleRecordingComplete(): Promise<void> {
    const audioBlob = new Blob(this.audioChunks, { type: "audio/webm; codecs=opus" });

    // Emit loading state immediately
    this.transcriptionComplete.emit("Transcribing audio...");

    try {
      const transcription = await this.roonService.transcribeAudio(audioBlob);
      this.transcriptionComplete.emit(transcription);
    } catch (err) {
      this.transcriptionComplete.emit(
        "Error transcribing audio: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  startPress(event: Event): void {
    event.preventDefault(); // Prevent default browser behavior
    this.pressTimer = window.setTimeout(() => {
      void this.showMicrophoneSelect();
    }, this.LONG_PRESS_DURATION);
  }

  endPress(): void {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
    }
  }

  private async showMicrophoneSelect(): Promise<void> {
    const dialogRef = this.dialog.open(MicrophoneSelectDialogComponent);
    const result = (await firstValueFrom(dialogRef.afterClosed())) as string | undefined;
    if (result) {
      this.selectedDeviceId = result;
    }
  }
}
