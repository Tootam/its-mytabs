import { expect, Page, test } from "./fixtures.ts";
import { findNoteEditorTabId, login, openTab } from "./helpers.ts";

interface EditableNoteLocation {
    barIndex: number;
    voiceIndex: number;
    beatIndex: number;
    noteIndex: number;
    fret: number;
    noteCount: number;
    x: number;
    y: number;
    emptyStringX: number;
    emptyStringY: number;
}

async function findEditableNote(page: Page): Promise<EditableNoteLocation> {
    return await page.evaluate(() => {
        const api = window.api;
        const track = api.score.tracks[0];
        for (const bar of track.staves[0].bars) {
            for (const voice of bar.voices) {
                for (const beat of voice.beats) {
                    const note = beat.notes.find((candidate) => candidate.isStringed);
                    if (!note || beat.notes.filter((candidate) => candidate.isStringed).length >= bar.staff.tuning.length) {
                        continue;
                    }
                    const beatBounds = api.boundsLookup.findBeat(beat);
                    const noteBounds = beatBounds.notes.find((bounds) => bounds.note.id === note.id);
                    const element = (api.canvasElement as unknown as { element: HTMLElement }).element;
                    const rect = element.getBoundingClientRect();
                    const emptyString = Array.from({ length: bar.staff.tuning.length }, (_, index) => index + 1).find((noteString) => !beat.getNoteOnString(noteString));
                    if (!emptyString) {
                        continue;
                    }
                    const noteCenterY = noteBounds.noteHeadBounds.y + noteBounds.noteHeadBounds.h / 2;
                    const lineSpacing = 13 * api.settings.display.scale;
                    return {
                        barIndex: bar.index,
                        voiceIndex: voice.index,
                        beatIndex: beat.index,
                        noteIndex: note.index,
                        fret: note.fret,
                        noteCount: beat.notes.length,
                        x: rect.left + noteBounds.noteHeadBounds.x + noteBounds.noteHeadBounds.w / 2,
                        y: rect.top + noteCenterY,
                        emptyStringX: rect.left + beatBounds.onNotesX,
                        emptyStringY: rect.top + noteCenterY + (note.string - emptyString) * lineSpacing,
                    };
                }
            }
        }
        throw new Error("No editable note found");
    });
}

async function readEditedBeat(page: Page, location: EditableNoteLocation) {
    return await page.evaluate((address) => {
        const beat = window.api.score.tracks[0].staves[0].bars[address.barIndex].voices[address.voiceIndex].beats[address.beatIndex];
        return {
            fret: beat.notes.find((note) => note.index === address.noteIndex)?.fret,
            noteCount: beat.notes.length,
        };
    }, location);
}

async function originalFileHash(page: Page, tabId: string): Promise<string> {
    return await page.evaluate(async (id) => {
        const response = await fetch(`/api/tab/${id}/file`, { credentials: "include" });
        const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
        return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    }, tabId);
}

test("autosaves a working copy and only replaces the original on explicit save", async ({ page, request }) => {
    await login(page);
    const tabId = await findNoteEditorTabId(request);
    await openTab(page, "synth", tabId);
    await expect(page.locator(".toolbar > .note-editor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
    const location = await findEditableNote(page);
    const changedFret = location.fret === 0 ? 1 : 0;
    const originalHash = await originalFileHash(page, tabId);
    const waitForDraftSave = () => page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/api/tab/${tabId}/edit-session/`));

    const fretInput = page.getByRole("spinbutton", { name: "Fret", exact: true });
    await page.mouse.click(location.x, location.y);
    await expect(fretInput).toBeHidden();
    await page.mouse.dblclick(location.x, location.y);
    await expect(fretInput).toHaveValue(String(location.fret));
    await expect(fretInput).toHaveAttribute("placeholder", " ");
    await expect(page.getByRole("form", { name: "Fret editor" }).getByRole("button")).toHaveCount(0);
    const inlineEditorBounds = await fretInput.boundingBox();
    expect(inlineEditorBounds?.width).toBeLessThanOrEqual(26);
    expect(inlineEditorBounds?.height).toBeLessThanOrEqual(17);
    await fretInput.fill(String(changedFret));
    const firstDraftSave = waitForDraftSave();
    await page.mouse.click(location.x + 35, location.y);
    await firstDraftSave;
    await expect(fretInput).toBeHidden();
    await expect(page.getByText("Working copy saved")).toBeVisible();
    expect((await readEditedBeat(page, location)).fret).toBe(changedFret);
    expect(await originalFileHash(page, tabId)).toBe(originalHash);

    const cleanDraftSession = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/tab/${tabId}/edit-session`));
    await page.getByRole("button", { name: "Discard" }).click();
    await cleanDraftSession;
    await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
    await page.waitForFunction(() => window.api?.boundsLookup?.isFinished && window.api?.player?.isReadyForPlayback);
    expect((await readEditedBeat(page, location)).fret).toBe(location.fret);

    const refreshedLocation = await findEditableNote(page);
    await page.mouse.dblclick(refreshedLocation.x, refreshedLocation.y);
    await fretInput.fill(String(changedFret));
    const fretDraftSave = waitForDraftSave();
    await fretInput.press("Enter");
    await fretDraftSave;
    await expect(page.getByText("Working copy saved")).toBeVisible();
    await page.waitForFunction(() => window.api?.boundsLookup?.isFinished);

    await page.mouse.dblclick(refreshedLocation.emptyStringX, refreshedLocation.emptyStringY);
    await expect(fretInput).toHaveValue("");
    await fretInput.fill("0");
    const chordDraftSave = waitForDraftSave();
    await fretInput.press("Enter");
    await chordDraftSave;
    await expect(page.getByText("Working copy saved")).toBeVisible();
    expect((await readEditedBeat(page, refreshedLocation)).noteCount).toBe(refreshedLocation.noteCount + 1);
    expect(await originalFileHash(page, tabId)).toBe(originalHash);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".notification-content")).toContainText("Tab notes saved");
    await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
    await page.waitForFunction(() => window.api?.boundsLookup?.isFinished && window.api?.player?.isReadyForPlayback);

    const persisted = await readEditedBeat(page, refreshedLocation);
    expect(persisted.fret).toBe(changedFret);
    expect(persisted.noteCount).toBe(refreshedLocation.noteCount + 1);
    expect(await originalFileHash(page, tabId)).not.toBe(originalHash);
});
