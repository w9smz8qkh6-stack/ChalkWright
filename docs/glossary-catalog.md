# Offline glossary catalog

Vocabulary source material is imported from a teacher-controlled glossary into
the Chalkwright SQLite database. The display reads only that local catalog;
normal slideshow operation does not depend on Google Drive availability.

Each imported source is scoped by academic year and class, with optional unit
and lesson-topic metadata. Teacher-authored term and definition text is the
canonical entry. Translations are additive records, never replacements for the
source text. The canonical entry retains its English (or other source-language)
term, definition, part of speech, and sample sentence. Each translation is
keyed by its language code and can independently carry the translated term,
definition, part of speech, and sample sentence. This production workflow does
not create machine-origin translations.

Pronunciations, illustrations, and other approved glossary media are stored as
SQLite BLOBs. Each object records MIME type, length, SHA-256 digest, origin,
review state, and optional attribution/license information. The catalog rejects
individual objects above 5 MiB and a source import whose combined media exceeds
20 MiB. A missing optional asset must leave text displayable; it must not make
the whole vocabulary card unavailable.

The Drive adapter is read-only and CSV-first. The CSV normalizer accepts
the common `Term`/`Word`/`Vocabulary` and `Definition`/`Meaning` headers, plus
optional language, part-of-speech, example, and pronunciation columns. It also
accepts both descriptive translated headers and the compact production schema:
`sample_sentence_en`, `term_vi`/`definition_vi`/`sample_sentence_vi`,
`term_ko`/`definition_ko`/`sample_sentence_ko`, and
`term_zh`/`definition_zh`/`sample_sentence_zh`. Vietnamese, Korean, and
Simplified Chinese values are stored as reviewed teacher translations. It
rejects malformed quotes, missing required columns, invalid rows, and oversized
files before catalog writes. PDF files remain teacher reference material unless
a separately tested extraction path is introduced. Imports replace the entries
for one source atomically after validation, while
the source record and audit trail remain local. A display selection should keep
the selected entry snapshot, so later source edits do not rewrite a past day's
word of the day.

The provider boundary has only two capabilities: list the direct children of a
known folder and download a bounded CSV file. It accepts no Drive write,
sharing, delete, or global-search capability. Protected production
configuration binds one known academic-year folder ID and, for each mapped
class, an exact course name. The importer resolves only the direct-child
`<academic-year>/<course name>/Glossaries` hierarchy, imports every direct-child
CSV in that folder in deterministic filename order, rejects missing or
ambiguous exact folders, and enforces finite page and per-course file budgets.

After import, Chalkwright converts local catalog rows to class-scoped
vocabulary candidates, selects one deterministic word per effective-plan
meeting, and stores both the selected snapshot and class history in SQLite.
The same meeting always reuses its recorded selection; repeats occur only after
the available class pool is exhausted. The production display reads the native
selection first and can fall back to transition-era copied vocabulary. It
never contacts Drive from a display request.

`chalkwright-glossary-refresh.service` is the only production unit with access
to the Drive-read provider directory. Its non-catch-up timer runs at 07:27
Asia/Ho_Chi_Minh Sunday through Friday, after plan refresh and before Calendar
sync. A provider failure retains the last-known-good catalog and existing
meeting selections; it does not fabricate a word.

When all three translated languages are present, the word-of-the-day card
rotates through English, Vietnamese, Korean, and Simplified Chinese long enough
for every face to appear before the outer content carousel advances. The
legacy English/Vietnamese two-face presentation remains supported.

No AI translation call is made by this workflow. Translations come only from
the teacher-supplied CSV.
