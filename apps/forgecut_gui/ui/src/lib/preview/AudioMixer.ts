import type { Result } from "../../../electron/shared/result";

type Connection = { source: MediaElementAudioSourceNode; gain: GainNode };

export class AudioMixer {
  private context: AudioContext | null = null;

  private readonly connections = new WeakMap<HTMLMediaElement, Connection>();

  connect(media: HTMLMediaElement): Result<GainNode> {
    try {
      this.context ??= new AudioContext();
      let connection = this.connections.get(media);
      if (!connection) {
        connection = {
          source: this.context.createMediaElementSource(media),
          gain: this.context.createGain(),
        };
        this.connections.set(media, connection);
      }
      connection.source.connect(connection.gain);
      connection.gain.connect(this.context.destination);
      return { ok: true, value: connection.gain };
    } catch (error) {
      return {
        ok: false,
        error: { code: "AUDIO_UNAVAILABLE", message: String(error) },
      };
    }
  }

  disconnect(media: HTMLMediaElement): void {
    const connection = this.connections.get(media);
    connection?.source.disconnect();
    connection?.gain.disconnect();
  }

  setGain(node: GainNode, value: number): void {
    node.gain.setValueAtTime(value, this.context?.currentTime ?? 0);
  }

  async resume(): Promise<Result<void>> {
    try {
      if (this.context?.state === "suspended") await this.context.resume();
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: { code: "AUDIO_UNAVAILABLE", message: String(error) },
      };
    }
  }

  async close(): Promise<void> {
    if (this.context && this.context.state !== "closed")
      await this.context.close();
  }
}
