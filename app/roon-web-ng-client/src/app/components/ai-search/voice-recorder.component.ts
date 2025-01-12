import { firstValueFrom } from "rxjs";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, inject, Output } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MessageService } from "@services/message.service";
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
      (touchstart)="startPress($event)"
      (touchend)="endPress($event)"
      (mousedown)="startPress($event)"
      (mouseup)="endPress($event)"
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

  private isLongPress = false;
  private isToggling = false;
  private isTouchDevice = false;

  constructor(private readonly messageService: MessageService) {}

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
        },
      });

      // Determine MIME type based on the user agent
      const mimeType = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "audio/mp4" : "audio/webm; codecs=opus";

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
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
      const message = /denied|not found/i.test(String(err))
        ? "Microphone access was denied. Please check your browser settings and permissions."
        : `Error accessing microphone: ${err instanceof Error ? err.message : String(err)}`;

      this.transcriptionComplete.emit(message);
    }
  }

  private stopRecording(): void {
    if (this.mediaRecorder?.state === "recording") {
      //this.messageService.showMessage("Stopping recording...");

      try {
        this.mediaRecorder.stop();
        this.isRecording = false;

        // Stop all tracks in the stream
        this.mediaRecorder.stream.getTracks().forEach((track) => {
          track.stop();
        });

        //this.messageService.showSuccess("Recording stopped successfully");
      } catch (err) {
        this.messageService.showError("Error stopping recording", err as Error);
        this.transcriptionComplete.emit(
          "Error stopping recording: " + (err instanceof Error ? err.message : String(err))
        );
      }
    } else {
      this.messageService.showMessage(`MediaRecorder state: ${this.mediaRecorder?.state}`);
    }
  }

  private async handleRecordingComplete(): Promise<void> {
    // Use MP4 for iOS, WebM for others
    const mimeType = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "audio/mp4" : "audio/webm; codecs=opus";

    const audioBlob = new Blob(this.audioChunks, { type: mimeType });

    //if size < 44100 * 100ms, then we don't have any audio
    if (audioBlob.size < 44100 * 0.1) {
      this.transcriptionComplete.emit("No audio recorded");
      return;
    }

    // Emit loading state immediately
    this.transcriptionComplete.emit("Transcribing audio...");

    try {
      const transcription = await this.roonService.transcribeAudio(audioBlob);
      this.transcriptionComplete.emit(transcription);
    } catch (err) {
      this.messageService.showError("Transcription error", err as Error);
      this.transcriptionComplete.emit("Error transcribing audio");
    }
  }

  startPress(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    // Set device type on first interaction
    if (event.type === "touchstart") {
      this.isTouchDevice = true;
    }

    // Ignore mouse events on touch devices
    if (this.isTouchDevice && event.type === "mousedown") {
      return;
    }

    // Only start the timer if we're not already processing something
    if (!this.isToggling && !this.pressTimer) {
      this.isLongPress = false;
      this.pressTimer = window.setTimeout(() => {
        this.isLongPress = true;
        void this.showMicrophoneSelect();
      }, this.LONG_PRESS_DURATION);
    }
  }

  endPress(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    // Ignore mouse events on touch devices
    if (this.isTouchDevice && event.type === "mouseup") {
      return;
    }

    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = undefined; // Reset the timer

      if (!this.isLongPress && !this.isToggling) {
        this.isToggling = true;
        void this.toggleRecording().finally(() => {
          this.isToggling = false;
        });
      }
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
