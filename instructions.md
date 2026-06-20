# DirtyBirds — Wildcard Prompt Guide (start here)

A plain, step-by-step guide to writing prompts with the **Dirty Talk - The
Script** node. No coding needed. Read top to bottom the first time.

---

## 1. The big idea (read once)

You write a short "template" and the node fills in the blanks every time it runs,
so each image gets a fresh, varied prompt.

There are two files behind the scenes, both in this folder:

```
C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse\user_files\wildcards\
```

- **Wildcard_Master.yaml** = your *word lists* (hair colors, clothing, poses...).
- **templates.yaml** = your *saved scenarios* (ready-made prompts you reuse).

You do not have to touch either file to make a prompt. You can just type in the
node. The files are there when you want to save and reuse things.

---

## 2. Make your first prompt (do this)

1. In ComfyUI, find the **Dirty Talk - The Script** node.
2. Click in the big **positive** box.
3. Type a prompt. To drop in a random word from a list, wrap a list name in double
   underscores, like `__hair/color__`.
4. Run the workflow. The node replaces `__hair/color__` with one random color from
   that list. The preview shows the finished prompt before the image renders.

Example you can type:

```
a portrait of a woman with __hair/color__ hair, __expression/facial__
```

Every run, the underscored bits get filled in differently.

---

## 3. The four things you can type

### a) Pull a random word from a list  →  `__list/name__`

```
__hair/color__
__clothing/footwear/business__
```

The name is the path to the list, with `/` between levels. Capitals and spaces
do not matter (`Long hair` also works as `long-hair`).

### b) Pick one of a few choices  →  `{a|b|c}`

```
{smiling|laughing|serious}
```

Picks one at random.

### c) Make one choice more likely  →  `number::choice`

```
{7::a|3::b}
```

`a` shows up about 70% of the time, `b` about 30%.

### d) Pick several at once  →  `number$$choices`

```
{2$$a|b|c}        pick exactly 2
{1-3$$a|b|c}      pick anywhere from 1 to 3
```

That is everything. You can mix them in one prompt.

---

## 4. Keep outfits (and looks) from clashing  →  the register lock

The problem: if you pull a top, bottoms, and shoes separately, you can end up with
a business jacket and beach sandals. The fix is to **choose the style once and
reuse it**.

Use a label in double square brackets. Set it once, then reuse it:

```
[[outfit={Casual|Business}]]__clothing/tops/[[outfit]]__, __clothing/bottoms/[[outfit]]__, __clothing/footwear/[[outfit]]__
```

What this does, in plain words:

1. `[[outfit={Casual|Business}]]` flips a coin once: Casual or Business. It prints
   nothing itself.
2. Each `[[outfit]]` after it gets that same answer.
3. So the top, bottoms, and shoes all come from the same style. No mismatch.

The words in `{Casual|Business}` must match your list names (you have
`Clothing/Tops/Casual` and `Clothing/Tops/Business`, etc., so it works).

Same trick for any pair that should match, like hair length:

```
[[len={Long hair|Short hair}]]__hair/style/[[len]]__
```

Tip: if you always want one style, fix it with `[[outfit=Business]]` (no
`{ }`) and every piece stays Business.

---

## 5. Save a scenario so you can reuse it

Once you have a prompt you like, save it as a named scenario. Then you only type
its short name to run it.

1. Open `templates.yaml` in `user_files\wildcards\` with any text editor
   (Notepad is fine).
2. Add a new line under `templates:`, indented, in this shape:

   ```yaml
   templates:
     my-look: ["[[outfit={Casual|Business}]]a woman, __clothing/tops/[[outfit]]__, __clothing/footwear/[[outfit]]__, __expression/facial__"]
   ```

   - `my-look` is the name you choose.
   - The whole prompt goes inside `["` and `"]` on one line.
3. Save the file. No restart needed.
4. In the node's positive box, just type:

   ```
   __templates/my-look__
   ```

   The node loads that scenario and fills it in. You already have
   `professional`, `editorial-fashion`, `editorial-glamour`, and `everyday` set up
   the same way.

Why a separate file: your big word-list file (`Wildcard_Master.yaml`) stays clean,
and you edit your saved prompts in one small place.

---

## 6. If something looks wrong

- **A `__token__` shows up in the final prompt as plain text** (like
  `__clothing/hats__` literally): that list name does not exist in your files.
  Check the spelling, or that the list exists in `Wildcard_Master.yaml`.
- **A `[[word]]` shows up in the output**: you used a label you never set. Add the
  `[[word=...]]` line, or fix the spelling.
- **An outfit still mixes styles**: make sure every clothing piece uses the same
  `[[outfit]]` label, and that the list it points to does not itself contain the
  wrong style (e.g. dress shoes hiding in the Casual list).
- **Same prompt every time**: turn on *reroll_each_run* on the node (it re-rolls
  randomly). With it off, the seed gives the same result on purpose.

---

## 7. The node's switches (quick reference)

- **positive / negative** — where you type your prompt.
- **reroll_each_run** — ON: new random roll every run. OFF: same roll from the
  seed.
- **seed** — the number that fixes a roll when reroll is OFF.
- **concat_positive / concat_negative** — optional text added in front, from
  another node.

---

## For the techy stuff (optional)

- Word lists and scenarios load from every `.yaml` / `.yml` / `.txt` in
  `user_files/wildcards/`, re-read on every run (no restart to see edits).
- Engine code: `dirtybirds_wildcard_engine.py` (the resolver) and
  `dirtybirds_prompt.py` (the ComfyUI node). Tests in `tests/`.
- A second safety net exists in the Wildcard Studio app: an Expand-tab "Check
  coherence" button that asks your local model to flag any contradictions a
  register lock cannot catch (scene/weather, body type, free `{a|b}` picks).
