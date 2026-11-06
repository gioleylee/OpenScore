import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

test("real audio upload, notation, editing, playback and edited MIDI export", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page
    .locator('input[type=file][accept*=".wav"]')
    .setInputFiles(path.resolve("../examples/melody.wav"));
  await page
    .getByRole("button", { name: "Guitar Standard notation & tabs" })
    .click();
  await page.getByRole("button", { name: "Transcribe recording" }).click();
  await expect(
    page.getByRole("heading", { name: "melody", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".score-paper svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Staff + tab", exact: true }).click();
  await expect(page.locator(".score-paper svg")).toHaveCount(2);
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Pitch (MIDI)").fill("72");
  await page.getByRole("button", { name: "Recalculate fingerings" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI", exact: true }).click();
  const downloaded = await dl;
  expect(downloaded.suggestedFilename()).toBe("melody.mid");
  const bytes = await readFile((await downloaded.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("MThd");
  expect(bytes.indexOf(Buffer.from([144, 72]))).toBeGreaterThan(-1);
  await page.getByRole("button", { name: "Play transcription" }).click();
  await expect(
    page.getByRole("button", { name: "Pause transcription" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause transcription" }).click();
  await page.getByRole("button", { name: "Save offline", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Saved in your offline library",
  );
  await page
    .getByRole("button", { name: "New recording · delete this job" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your music. On your terms." }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await page
    .getByRole("article")
    .filter({ hasNotText: "Recover last session" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(page.locator(".score-paper svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Pitch (MIDI)").fill("74");
  const offlineMidi = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI", exact: true }).click();
  expect((await offlineMidi).suggestedFilename()).toBe("melody.mid");
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  expect((await pdf).suggestedFilename()).toBe("melody.pdf");
  await page.context().setOffline(false);
});

test("mobile upload screen fits viewport and theme toggles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "browse files" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
