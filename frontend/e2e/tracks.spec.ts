import { expect, test } from "./fixtures.ts";
import { openTab, selectBars, waitForDemoTab } from "./helpers.ts";

test.describe("track controls", () => {
    test("track list opens, lists the tracks and closes", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.click(".track-selector .button");
        await expect(page.locator(".track-list")).toBeVisible();
        await expect(page.locator(".track-list .track")).toHaveCount(4);

        const names = await page.locator(".track-list .track .name").allTextContents();
        expect(names.length).toBe(4);
        expect(names.every((n) => n.trim().length > 0)).toBe(true);

        // Close by clicking outside
        await page.click("h1");
        await expect(page.locator(".track-list")).toBeHidden();
    });

    test("switching track updates the toolbar", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const first = (await page.locator(".track-selector .button").innerText()).trim();

        await page.click(".track-selector .button");
        await page.locator(".track-list .track .name").nth(1).click();

        const second = (await page.locator(".track-selector .button").innerText()).trim();
        expect(second).not.toBe(first);
    });

    test("solo mutes the other tracks and can be undone", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.click(".track-selector .button");
        const soloButtons = page.locator(".track-list .track .solo");
        const muteButtons = page.locator(".track-list .track .mute");

        await soloButtons.nth(0).click();
        await expect(soloButtons.nth(0)).toHaveClass(/active/);
        // All other tracks are muted alongside the solo
        for (let i = 1; i < 4; i++) {
            await expect(muteButtons.nth(i)).toHaveClass(/active/);
        }

        // Un-solo restores everything
        await soloButtons.nth(0).click();
        await expect(soloButtons.nth(0)).not.toHaveClass(/active/);
        for (let i = 0; i < 4; i++) {
            await expect(muteButtons.nth(i)).not.toHaveClass(/active/);
        }
    });

    test("mute toggles the track and can be undone", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.click(".track-selector .button");
        const muteButtons = page.locator(".track-list .track .mute");

        await muteButtons.nth(0).click();
        await expect(muteButtons.nth(0)).toHaveClass(/active/);

        await muteButtons.nth(0).click();
        await expect(muteButtons.nth(0)).not.toHaveClass(/active/);
    });

    test("master volume sets every track and a track can be overridden", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.evaluate(() => {
            const calls: Array<{ trackIndexes: number[]; volume: number }> = [];
            const original = window.api.changeTrackVolume.bind(window.api);
            window.api.changeTrackVolume = (tracks, volume) => {
                calls.push({ trackIndexes: tracks.map((track) => track.index), volume });
                original(tracks, volume);
            };
            (window as typeof window & { trackVolumeCalls: typeof calls }).trackVolumeCalls = calls;
        });

        await page.click(".track-selector .button");
        const masterVolumeInput = page.locator(".track-list .master-volume input");
        const trackVolumeInputs = page.locator(".track-list .track .select-percentage input");

        await masterVolumeInput.fill("44");
        await expect(masterVolumeInput).toHaveValue("44");
        for (let i = 0; i < 4; i++) {
            await expect(trackVolumeInputs.nth(i)).toHaveValue("44");
        }

        await trackVolumeInputs.nth(0).fill("80");
        await expect(trackVolumeInputs.nth(0)).toHaveValue("80");
        for (let i = 1; i < 4; i++) {
            await expect(trackVolumeInputs.nth(i)).toHaveValue("44");
        }

        const calls = await page.evaluate(() => (window as typeof window & { trackVolumeCalls: Array<{ trackIndexes: number[]; volume: number }> }).trackVolumeCalls);
        expect(calls.at(-2)).toEqual({ trackIndexes: [0, 1, 2, 3], volume: 0.44 });
        expect(calls.at(-1)).toEqual({ trackIndexes: [0], volume: 0.8 });

        await openTab(page, "synth");
        await page.click(".track-selector .button");
        await expect(page.locator(".track-list .master-volume input")).toHaveValue("44");
        const restoredTrackVolumeInputs = page.locator(".track-list .track .select-percentage input");
        await expect(restoredTrackVolumeInputs.nth(0)).toHaveValue("80");
        for (let i = 1; i < 4; i++) {
            await expect(restoredTrackVolumeInputs.nth(i)).toHaveValue("44");
        }
    });

    test("switching track clears the highlighted range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await selectBars(page, 1, 3);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
        await expect(page.locator(".at-selection-handle-start")).toBeVisible();

        await page.click(".track-selector .button");
        await page.locator(".track-list .track .name").nth(1).click();

        await expect.poll(() => page.evaluate(() => window.api.playbackRange)).toBeNull();
        await expect(page.getByRole("button", { name: "Restart" })).toBeHidden();
        await expect(page.locator(".at-selection-handle-start")).toBeHidden();
        await expect(page.locator(".at-selection-close")).toBeHidden();
    });

    test("switching to the drums track re-renders the score", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        // Drums have MIDI program 0 and force a full reload on switch
        const drumsIndex = await page.evaluate(
            () => window.api.score.tracks.findIndex((t) => t.playbackInfo.program === 0),
        );
        expect(drumsIndex).toBeGreaterThan(-1);

        await page.click(".track-selector .button");
        await page.locator(".track-list .track .name").nth(drumsIndex).click();

        // A fresh api is created after the reload; wait for it to render again
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const api = window.api;
                    return api && api.score && api.score.tracks && api.boundsLookup?.isFinished ? api.score.tracks.length : -1;
                })
            )
            .toBe(4);
        const name = (await page.locator(".track-selector .button").innerText()).trim();
        expect(name.length).toBeGreaterThan(0);
    });
});
