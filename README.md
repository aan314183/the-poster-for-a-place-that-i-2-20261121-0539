# VELMORA — The Poster for a Place That Isn't There

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/c/the-poster-for-a-place-that-i-2-20261121-0539)

[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/aan314183/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/c/the-poster-for-a-place-that-i-2-20261121-0539)

[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/aan314183/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/c/the-poster-for-a-place-that-i-2-20261121-0539)

VELMORA is a floating lantern city that drifts above the clouds at dusk, where
stone islands hang in a peach-coloured sky, waterfalls spill off grassy
plateaus into a sea of cloud, hot-air balloons drift past a low amber sun, and
a lantern tower lights the way home for every traveller who has ever dreamed
of a city with no ground beneath it. The poster is drawn entirely by a small
software rasterizer written from scratch — no image files, no network, no
randomness beyond one fixed seed — so every run paints the same VELMORA.

## How to run

```sh
node main.ts /output
```

This writes `/output/entry.png` (1024×1024 PNG, under 1 MiB) and validates it:
PNG signature, size, dimensions, 8-bit RGB colour type and IEND are all
checked before the program reports success. The output directory defaults to
`/output` when no argument is given.

## License

MIT — see [LICENSE](LICENSE).
