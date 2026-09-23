# Backgrounds

Pre-made background images that people can choose in place of uploading their own (the sign-in background on Manage > Server, and a person's own background on their profile). Files in this folder ship with Magpie and are served as `/assets/images/backgrounds/<file>`.

## Format

WebP. A full background is up to 2560 px wide and about 250 KB; a pattern that repeats is 512 to 1024 px and about 60 KB. Photos and painted pieces are lossy at quality 80 to 85; flat patterns are lossless. There are no separate thumbnails: the images are small enough to show as they are, and the picker loads them as they scroll into view. If one is large (over about 300 KB), make it smaller.

## Names

`background-<theme>-<style>-<name>-<index>.webp`, for example `background-fantasy-pattern-orange-01.webp`.

| Part | Meaning | Example |
|---|---|---|
| `background` | the type | `background` |
| theme | the world it belongs to | `fantasy` |
| style | how it is drawn or used | `pattern`, `scene`, `texture` |
| name | its colour or subject, one word | `orange`, `forest` |
| index | which one of that name, two digits | `01` |

Each part is lower-case letters and digits with no hyphen inside it ("deepblue", not "deep-blue"), so the hyphens between parts are unambiguous. Magpie reads this folder and builds the list from the file names; a file that does not match is skipped and the server's log says why.

## Licence

Everything here must be free to use commercially and to redistribute. List each image (or set) and where it came from, and its licence, in \`CREDITS.md\` in this folder.
