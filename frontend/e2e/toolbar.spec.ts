import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, openTab, playbackRange, selectBars, tickPosition, waitForDemoTab } from "./helpers.ts";

test.describe("toolbar playback controls", () => {
    test("play/pause toggles playback", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.getByRole("button", { name: "Play" }).click();
        await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);

        await page.getByRole("button", { name: "Pause" }).click();
        await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(0);
    });

    test("loop toggles the loop range and persists", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.getByRole("button", { name: "Loop" }).click();
        await expect(page.getByRole("button", { name: "Loop" })).toHaveClass(/active/);
        await expect.poll(() => page.evaluate(() => window.api.isLooping)).toBe(true);
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("tab-1-isLooping")))
            .toBe("true");

        await page.getByRole("button", { name: "Loop" }).click();
        await expect.poll(() => page.evaluate(() => window.api.isLooping)).toBe(false);
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("tab-1-isLooping")))
            .toBe("false");
    });

    test("count in toggles and arms the count-in volume", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.getByRole("button", { name: "Count in" }).click();
        await expect(page.getByRole("button", { name: "Count in" })).toHaveClass(/active/);
        await expect.poll(() => page.evaluate(() => window.api.countInVolume)).toBe(1);

        await page.getByRole("button", { name: "Count in" }).click();
        await expect.poll(() => page.evaluate(() => window.api.countInVolume)).toBe(0);
    });

    test("metronome toggles and is disabled on external audio", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.getByRole("button", { name: "Metronome" }).click();
        await expect(page.getByRole("button", { name: "Metronome" })).toHaveClass(/active/);
        // The app consumes alphaTab's metronome timing events itself. Keeping
        // the native click muted avoids its Web Audio stop/start race.
        await expect.poll(() => page.evaluate(() => window.api.metronomeVolume)).toBe(0);
        await expect.poll(() => page.evaluate(() => window.api.midiEventsPlayedFilter.length)).toBeGreaterThan(0);

        // Switching to an external audio source marks it disabled
        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();
        await expect(page.getByRole("button", { name: "Metronome" })).toHaveClass(/disabled/);
    });

    test("metronome timing continues across loop boundaries", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");
        await selectBars(page, 0, 0);

        await page.evaluate(() => {
            const state = { clicks: 0 };
            (window as unknown as { metronomeTestState: typeof state }).metronomeTestState = state;
            window.api.midiEventsPlayed.on((args) => {
                state.clicks += args.events.filter((event) => event.isMetronome).length;
            });
        });

        await page.getByRole("button", { name: "Loop" }).click();
        await page.getByRole("button", { name: "Metronome" }).click();
        await page.locator(".select-percentage input").fill("400");
        await page.getByRole("button", { name: "Play" }).click();

        // One 4/4 bar produces four events. More than eight proves the timing
        // stream survived at least two loop boundaries.
        await expect.poll(() => page.evaluate(() => (window as unknown as { metronomeTestState: { clicks: number } }).metronomeTestState.clicks)).toBeGreaterThanOrEqual(12);
    });

    test("speed input changes, clamps and persists", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const speedInput = page.locator(".select-percentage input");

        await speedInput.fill("50");
        await expect.poll(() => page.evaluate(() => window.api.playbackSpeed)).toBeCloseTo(0.5);

        // Clamped to 20%
        await speedInput.fill("0");
        await expect.poll(() => page.evaluate(() => window.api.playbackSpeed)).toBeCloseTo(0.2);

        // Clamped to 1000%
        await speedInput.fill("10000");
        await expect.poll(() => page.evaluate(() => window.api.playbackSpeed)).toBeCloseTo(10);
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("tab-1-speed")))
            .toBe("1000");
    });

    test("restart plays from the beginning of the highlighted range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const range = await selectBars(page, 1, 3);
        const restart = page.getByRole("button", { name: "Restart" });
        await expect(restart).toBeVisible();

        await restart.click();
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);
        await expect.poll(() => tickPosition(page)).toBeGreaterThanOrEqual(range.startTick);

        // The selected range is still locked (not cleared by playing)
        expect(await playbackRange(page)).toEqual(range);
    });
});
