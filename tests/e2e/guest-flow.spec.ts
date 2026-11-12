import { expect, test } from "@playwright/test";

const PHOTOS = ["tests/e2e/fixtures/photo-1.jpg", "tests/e2e/fixtures/photo-2.jpg", "tests/e2e/fixtures/photo-3.jpg"];

test("guest logs a visit, uploads photos, identifies them, and ranks them by keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow is desktop-only; mobile covered by the tap test");

  await page.goto("/visits");
  await page.getByRole("link", { name: "Log your first visit" }).click();
  await page.getByPlaceholder("Search by museum or city").fill("Orsay");
  await page.getByRole("button", { name: /Orsay/ }).first().click();
  await page.getByRole("button", { name: "Next: add your photos" }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);

  // Upload three photos; each one is resized in the browser and stored privately.
  await page.locator('main input[type="file"]').setInputFiles(PHOTOS);
  await expect(page.getByText("3 photos need identifying")).toBeVisible();
  const ownPhoto = page.locator('main img[src^="/api/photos/"]').first();
  await expect(ownPhoto).toBeVisible();
  expect(await ownPhoto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Identify: the dialog lists the museum's paintings and moves on to the next photo after each pick.
  await page.getByRole("button", { name: "Identify" }).click();
  const dialog = page.getByRole("dialog", { name: "Which painting is this?" });
  for (let i = 0; i < 2; i++) {
    await expect(dialog.getByText(`Photo ${i + 1} of 3`)).toBeVisible();
    await dialog.locator("ul button").nth(i).click();
  }
  // The third one isn't in the catalogue: add it by hand.
  await expect(dialog.getByText("Photo 3 of 3")).toBeVisible();
  await dialog.getByRole("button", { name: "Not listed? Add it by hand" }).click();
  await dialog.getByLabel("Title").fill("Study of a green wall");
  await dialog.getByRole("button", { name: "Add painting" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: "Rank 3 paintings →" }).click();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByText(`${i} ranked`)).toBeVisible();
    await page.keyboard.press(i === 2 ? "2" : "1");
    for (let q = 0; q < 4; q++) {
      const placed = page.getByText(`${i + 1} ranked`).or(page.getByRole("heading", { name: "All caught up" }));
      const comparing = page.getByRole("heading", { name: "Which do you prefer?" });
      await expect(placed.or(comparing)).toBeVisible();
      if (await placed.isVisible()) break;
      await page.keyboard.press("ArrowLeft");
    }
  }
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible();

  // Same browser, fresh page: the list is there, built from the guest's own photos.
  const again = await page.context().newPage();
  await again.goto("/list");
  await expect(again.getByText("3 paintings, best first.")).toBeVisible();
  await expect(again.getByText("Study of a green wall")).toBeVisible();
  await expect(again.locator('main img[src^="/api/photos/"]')).toHaveCount(3);
});

test("demo account shows visits, explained museum matches and a map", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("button", { name: /Try the demo account/ }).click();
  await expect(page).toHaveURL(/\/museums$/);
  const first = page.getByRole("listitem").filter({ hasText: "% match" }).first();
  await expect(first).toContainText("Holds");
  await page.getByRole("tab", { name: "map" }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Visits" }).click();
  await expect(page.getByRole("heading", { name: "Visits" })).toBeVisible();
  await expect(page.getByText("3 paintings waiting to be ranked")).toBeVisible();
});

test("comparison stacks vertically on narrow screens and works by tap", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/account");
  await page.getByRole("button", { name: /Try the demo account/ }).click();
  await expect(page).toHaveURL(/\/museums$/);
  // The Rank tab shows how many are waiting.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Rank\W+3 to rank/ }).click();
  await expect(page.getByText("3 left from your visits")).toBeVisible();
  await page.getByRole("button", { name: /Loved it/ }).click();
  await expect(page.getByRole("heading", { name: "Which do you prefer?" })).toBeVisible();
  const imgs = page.locator("main button img");
  await expect(imgs).toHaveCount(2);
  const [a, b] = [await imgs.nth(0).boundingBox(), await imgs.nth(1).boundingBox()];
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1); // stacked
  await imgs.nth(0).click();
});

test("photo-first: + opens the library, photos without location ask for the museum, uploads land on the visit", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the + tab is the phone flow");
  await page.goto("/visits");
  // The + button opens the file picker directly; hand it our photos.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add photos" }).click();
  await (await chooser).setFiles(PHOTOS);
  await expect(page).toHaveURL(/\/add$/);
  await expect(page.getByRole("heading", { name: /One visit, 3 photos/ })).toBeVisible();
  await expect(page.getByText("Which museum?")).toBeVisible(); // test images carry no GPS
  await page.getByRole("button", { name: /^Which museum\?/ }).click();
  await page.getByPlaceholder("Search by museum or city").fill("Prado");
  await page.getByRole("button", { name: /Prado/ }).first().click();
  await page.getByRole("button", { name: "Add 3 photos" }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Prado/ })).toBeVisible();
  await expect(page.getByText("3 photos need identifying")).toBeVisible();
  await expect(page.locator('main img[src^="/api/photos/"]')).toHaveCount(3);
});

test("installable: manifest, icons and service worker are served", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get("/sw.js")).ok()).toBe(true);
  expect((await request.get("/offline")).ok()).toBe(true);
  expect((await request.get("/api/health")).ok()).toBe(true);
});

test("photos added with no signal are kept on the phone and upload when it returns", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "one project is enough");
  await page.goto("/visits/new?museum=Q160112"); // Prado
  await page.getByRole("button", { name: "Next: add your photos" }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);

  await context.setOffline(true);
  await page.locator('main input[type="file"]').setInputFiles(PHOTOS);
  await expect(page.getByText("Saved on this phone · uploads when you're online")).toHaveCount(3);

  // Reloading while offline would lose a plain upload; these sit in IndexedDB.
  await context.setOffline(false);
  await expect(page.getByText("3 photos need identifying")).toBeVisible();
  await expect(page.locator('main img[src^="/api/photos/"]')).toHaveCount(3);
});
