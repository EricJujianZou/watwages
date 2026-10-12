# Do not edit this repo by hand

This is the public copy of the WatWages extension, linked from the Chrome Web
Store listing and the privacy page. The source of truth is the private repo at
`/home/ubuntu/projects/watermyjobs`, which has the tests, fixtures, design
files and the store packager.

- Make every code change in `watermyjobs/extension`, run its tests there
  (`cd extension && node --test tests/*.test.js`), and build the store zip
  with `scripts/package-extension.sh`.
- Then run `watermyjobs/scripts/publish-public.sh`, which copies the shipped
  files into this repo's `extension/`, and commit and push here with the same
  version in the message.
- The only files edited directly in this repo are `README.md`, `LICENSE` and
  `docs/media/`.

If you find uncommitted changes under `extension/` here, they were made in the
wrong place. Move them into watermyjobs as a patch before doing anything else.
