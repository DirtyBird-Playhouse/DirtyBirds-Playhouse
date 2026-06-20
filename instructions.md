# DirtyBirds-Playhouse — Instructions

ComfyUI node suite for prompt engineering and image generation. This guide covers
how to write prompts for the **Dirty Talk — The Script** node, whose built-in
wildcard engine resolves your template into a final prompt every run.

---

## The Script node (DirtyBirdsPrompt)

Type into the **positive** / **negative** boxes. On each run the engine resolves
wildcards and dynamic groups into a concrete prompt, shown in the node's preview
before the sampler runs (so you can cancel a bad roll).

- **seed** — fixed seed for a reproducible roll (used only when *reroll_each_run*
  is off).
- **reroll_each_run** — on: re-rolls randomly every run (ignores seed). Off: the
  seed gives the same roll every time.
- **concat_positive / concat_negative** — optional inputs prepended to the result.

Wildcard lists are loaded from every `.yaml` / `.yml` / `.txt` file in the
`user_files/wildcards` folder, re-read on every run (edit files, no restart
needed).

---

## Prompt syntax

### 1. Wildcards — `__key__`
Pulls one random entry from a named list.

```
__hair/color__
__clothing/footwear/business__
```

Keys are the nested path to a list, joined with `/`. Matching is
case-insensitive and spaces become `-` (so `Long hair` is reachable as
`long-hair`).

### 2. Dynamic groups — `{a|b|c}`
Pick one option at random.

```
{smiling|laughing|serious}
```

**Weighted pick** — `weight::option` (here a is ~70%, b ~30%):
```
{7::a|3::b}
```

**Pick several** — `N$$` or `N-M$$` quantifier:
```
{2$$a|b|c}        pick exactly 2
{1-3$$a|b|c}      pick 1 to 3
```

**Custom separator** — `N$$sep$$options` (joins picks with `sep`):
```
{2$$ and $$cat|dog|bird}     ->  "cat and dog"
```

Resolution is recursive: an option or a wildcard entry may itself contain more
`{...}` / `__...__`, resolved up to a safe depth.

### 3. Variables — `[[name=value]]` and `[[name]]`  (coherence / register lock)

Use a variable to make a choice **once** and reuse it across several tokens, so
independent rolls can't contradict each other (e.g. a formal top with casual
shoes).

- `[[name=VALUE]]` — declares a variable. VALUE is resolved once for the whole
  roll (its own `{...}` / `__...__` are evaluated), stored, and **prints
  nothing**.
- `[[name]]` — inserts the stored value, including inside a wildcard path.

**Register-lock example** — choose Casual or Business once, then dress head to toe
from that same register:

```
[[reg={Casual|Business}]]__clothing/tops/[[reg]]__, __clothing/bottoms/[[reg]]__, __clothing/footwear/[[reg]]__
```

Because `[[reg]]` is the same for all three tokens, the outfit is always coherent
— business attire never lands with sneakers. The same pattern works for any
paired axis (e.g. hair `Long hair` / `Short hair`, hosiery, etc.):

```
[[len={Long hair|Short hair}]]__hair/style/[[len]]__
```

**Where the declaration can live**
- In the prompt you type into the node, OR inside a scenario template that is
  stored as a wildcard entry and pulled with a `__token__`. Either works — a
  declaration is processed wherever it appears, including mid-roll.

**Notes / limits**
- A declaration's VALUE cannot reference another `[[var]]` (nested brackets are
  not parsed). References work everywhere else — declare independent variables and
  use each in the template.
- Unknown references are left visible (`[[typo]]`) so mistakes are obvious.
- Fully backward compatible: a template with no `[[ ]]` behaves exactly as before;
  the same seed reproduces the same prompt.

---

## Coherence: structure first, check second

1. **Register lock (this engine)** guarantees coherence on structured axes
   (clothing register, hair length) — pick the axis once with a variable and reuse
   it. This is the strongest fix; contradictions become impossible by
   construction.
2. **Post-roll coherence check (Wildcard Studio)** — the Expand tab's *Check
   coherence* button sends a rolled prompt to your local model and flags the fuzzy
   contradictions a structural rule can't encode (scene/weather clashes, body
   type, `{a|b}` either/or picks). Use it as the backstop, not the primary guard.

---

## Code layout (for maintenance)

- `dirtybirds_wildcard_engine.py` — the pure wildcard/dynamic/variable engine
  (no ComfyUI imports). `process(text, seed, wildcard_dict)` and
  `load_wildcard_dict()` live here.
- `dirtybirds_prompt.py` — the ComfyUI node + web API routes; imports the engine.
- `tests/test_wildcard_engine.py` — engine tests. Run from inside `tests/`:
  ```
  cd tests
  python -m pytest test_wildcard_engine.py --import-mode=importlib
  ```
  (Run from the project root, pytest tries to import the package `__init__` and
  fails with a relative-import error — run from `tests/`.)

Other nodes in the pack: Loader, Sampler, Image, Pipe, Muse, Wardrobe, plus booru
tag-autocomplete and folder web routes.
