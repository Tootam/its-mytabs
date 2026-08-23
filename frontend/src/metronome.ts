/// <reference lib="dom" />
import { play as foleyPlay } from "@foleyjs/core";

export interface MetronomeEvent {
    isMetronome: boolean;
    metronomeNumerator?: number;
}

type PlayFn = (accent: boolean) => void;

/**
 * Play metronome clicks from alphaTab's timing events instead of its native
 * Web Audio click. The native click can race while stopping scheduled audio
 * nodes during seeks and loop restarts, eventually leaving the metronome
 * silent even though playback continues.
 */
export function createMetronome(
    playFn: PlayFn = (accent) => {
        foleyPlay("ping", { pitch: accent ? 7 : 0 });
    },
) {
    return new Metronome(playFn);
}

class Metronome {
    private enabled = false;
    private playFn: PlayFn;

    constructor(playFn: PlayFn) {
        this.playFn = playFn;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    handleEvents(events: MetronomeEvent[]): void {
        if (!this.enabled) {
            return;
        }

        for (const event of events) {
            if (!event.isMetronome) {
                continue;
            }

            try {
                this.playFn(event.metronomeNumerator === 0);
            } catch {
                // A rejected audio gesture or suspended context must not affect playback.
            }
        }
    }
}

export const metronome = createMetronome();
