# Acidbath visual smoke test

This is the first isolated visual regression test. It exercises the compact tool-row and borderless activity presentation through a deterministic terminal fixture:

- `tuistory` drives a fixed 80x12 PTY and captures text/PNG output.
- The text snapshot catches semantic/layout changes, lifecycle glyphs, and fixed-width alignment.
- `ffmpeg` computes PNG SSIM and writes a diff artifact on failure.
- No Pi session, model call, filesystem mutation, or network access is used.

Run the check:

```bash
npm run test:visual
```

When an intentional presentation change is made, regenerate both baselines explicitly:

```bash
npm run test:visual -- --update
```

The PNG baseline depends on the pinned tuistory renderer/font settings in the test. It is an evidence baseline for this local environment, not a cross-platform golden image. Later tests can add real Pi lifecycle fixtures, shimmer review, motion frame capture, and VHS review tapes without changing this test's scope.
