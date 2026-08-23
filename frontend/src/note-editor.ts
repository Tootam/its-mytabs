import type * as alphaTab from "@coderline/alphatab";

type Beat = alphaTab.model.Beat;
type Note = alphaTab.model.Note;
type Score = alphaTab.model.Score;

export interface BeatAddress {
    trackIndex: number;
    staffIndex: number;
    barIndex: number;
    voiceIndex: number;
    beatIndex: number;
}

export interface NoteAddress extends BeatAddress {
    noteIndex: number;
}

export interface FretEdit {
    address: NoteAddress;
    fret: number;
}

export interface AddedNote {
    address: BeatAddress;
    string: number;
    fret: number;
}

export function getBeatAddress(beat: Beat): BeatAddress {
    const bar = beat.voice.bar;
    const staff = bar.staff;
    return {
        trackIndex: staff.track.index,
        staffIndex: staff.index,
        barIndex: bar.index,
        voiceIndex: beat.voice.index,
        beatIndex: beat.index,
    };
}

export function getNoteAddress(note: Note): NoteAddress {
    return {
        ...getBeatAddress(note.beat),
        noteIndex: note.index,
    };
}

export function getNoteAddressKey(address: NoteAddress): string {
    return `${getBeatAddressKey(address)}:${address.noteIndex}`;
}

export function getBeatAddressKey(address: BeatAddress): string {
    return `${address.trackIndex}:${address.staffIndex}:${address.barIndex}:${address.voiceIndex}:${address.beatIndex}`;
}

export function findBeat(score: Score, address: BeatAddress): Beat {
    const beat = score.tracks[address.trackIndex]?.staves[address.staffIndex]?.bars[address.barIndex]?.voices[address.voiceIndex]?.beats[address.beatIndex];
    if (!beat) {
        throw new Error("The edited beat no longer exists in the tab");
    }
    return beat;
}

export function findNote(score: Score, address: NoteAddress): Note {
    const note = findBeat(score, address).notes.find((candidate) => candidate.index === address.noteIndex);
    if (!note) {
        throw new Error("The edited note no longer exists in the tab");
    }
    return note;
}

export function parseFret(value: unknown): number {
    if (typeof value === "string" && value.trim() === "") {
        throw new Error("Enter a fret number between 0 and 99");
    }
    const fret = Number(value);
    if (!Number.isInteger(fret) || fret < 0 || fret > 99) {
        throw new Error("Fret must be a whole number between 0 and 99");
    }
    return fret;
}

export function parseString(value: unknown, stringCount: number): number {
    const noteString = Number(value);
    if (!Number.isInteger(noteString) || noteString < 1 || noteString > stringCount) {
        throw new Error(`String must be a whole number between 1 and ${stringCount}`);
    }
    return noteString;
}

export function applyNoteEdits(score: Score, fretEdits: FretEdit[], addedNotes: AddedNote[], createNote: () => Note): void {
    for (const edit of fretEdits) {
        findNote(score, edit.address).fret = parseFret(edit.fret);
    }

    for (const addition of addedNotes) {
        const beat = findBeat(score, addition.address);
        const stringCount = beat.voice.bar.staff.tuning.length;
        const noteString = parseString(addition.string, stringCount);
        if (beat.getNoteOnString(noteString)) {
            throw new Error(`String ${noteString} already has a note at the edited beat`);
        }

        const note = createNote();
        note.string = noteString;
        note.fret = parseFret(addition.fret);
        beat.addNote(note);
    }
}
