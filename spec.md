## Painting behavior

- Spray has a covering core and faint speckles. There is no user-facing cap
  selector; the internal brush defaults to the wide spray preset. The Edge slider
  spans visibly feathered to fully hard-edged spray without weakening the center.
  Edge also controls Buff softness; it becomes Fire Rate for Paintball and is
  hidden for Roller, Mop and Stamp.
- Slider label/output columns fit their text rather than a fixed label width,
  with explicit gaps and non-wrapping labels to prevent Fire Rate overlap.
- Wetness follows time spent depositing paint, not the number of interpolated
  stamps or pointer events. Moving passes stay controlled; lingering/repeated
  passes can run. Time between movement stamps is retained even when individual
  pointer moves are smaller than stamp spacing. Straight-line assist does not treat its instant interpolation
  as a stationary hold.
- Spray drips start inside the painted core, scale with cap size, and drain the
  whole wet patch so a wide cap cannot spawn a curtain of grid-cell drips.
- Roller runs sample the masked stroke's actual lower painted pixels before
  clearing the stroke layer, including rotated/diagonal strokes. They never
  originate in empty space inside the overall stroke bounding box.
- Stencil previews mask a temporary copy without erasing the pending stroke.
  The committed stroke is masked once at full masking opacity.
- Pointer movement uses the original event when coalesced samples are empty.
  Drip rendering restores the paint context state afterward.
- Existing artwork is a saved raster image; brush changes affect new marks only.

Validate actual browser-canvas coverage, drips, stencil edges and pointer handling
without connecting to Firebase:

```powershell
npm run test:browser -- painting.browser.spec.ts
npm run build
```

For a local preview using live Firebase reads:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

This is not `dev:local` (which uses emulators). Normal painting may autosave to
production, even without clicking POST. Use the existing Practice Yard for
no-post brush testing; it saves/shares nothing. Production App Check only trusts
the real site domains, so localhost is not a supported publishing/voting/reporting
origin without separately authorized verification setup. Do not weaken live
protections or run data-mutating integration tests against production.

## Development Checklist
- [ ] Task 1.1: Initialize Vite + TypeScript project structure with HTML5 Canvas viewport.
- [ ] Task 1.2: Build layered train car canvas (base steel background, drawing layer, window mask).
- [ ] Task 1.3: Implement zoom & horizontal pan controls for 4000x1200px car resolution.
- [ ] Task 1.4: Implement Unified Spray Tool (size, feather/hardness, opacity sliders).
- [ ] Task 1.5: Implement Color Picker and active swatch palette.
- [ ] Task 2.1: Add Straight-Line assist (`Shift` key / toggle) and Angle Snapping.
- [ ] Task 2.2: Add Paint Roller and Paintball Gun specialty tools.
- [ ] Task 2.3: Add Stencil Creator modal and custom brush angle/aspect ratio controls.
- [ ] Task 2.4: Build Ghost Yard solo sandbox with continuous LocalStorage auto-save.
- [ ] Task 3.1: Set up Node.js + Express + Socket.io backend for yard management.
- [ ] Task 3.2: Implement 20-car train consist model (Freight vs. Subway lines).
- [ ] Task 3.3: Implement Yard lifecycles (20m, 8h, 7d), Respect/Battle modes, 5-car cap per writer.
- [ ] Task 3.4: Real-time stroke synchronization across connected users.
- [ ] Task 4.1: Build server-side car flattener (raw strokes -> WebP asset upon departure).
- [ ] Task 4.2: Build dual-line animated roll-through main page with click-to-pause inspection.
- [ ] Task 4.3: Implement "Props" voting, dynamic buff decay, and permanent archive roster.
- [ ] Task 5.1: Build Admin Dashboard route for live tuning and content moderation.
- [ ] Task 5.2: UI polish and sound effects (spray can shake, yard horns, train clatter).