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
definition, part of speech, and sample sentence. Machine-origin records must
identify their generator revision and remain reviewable independently from
teacher-authored material.

Pronunciations, illustrations, and other approved glossary media are stored as
SQLite BLOBs. Each object records MIME type, length, SHA-256 digest, origin,
review state, and optional attribution/license information. The catalog rejects
individual objects above 5 MiB and a source import whose combined media exceeds
20 MiB. A missing optional asset must leave text displayable; it must not make
the whole vocabulary card unavailable.

The Drive adapter will be read-only and CSV-first. The CSV normalizer accepts
the common `Term`/`Word`/`Vocabulary` and `Definition`/`Meaning` headers, plus
optional language, part-of-speech, example, and pronunciation columns. It
rejects malformed quotes, missing required columns, invalid rows, and oversized
files before catalog writes. PDF files remain teacher reference material unless
a separately tested extraction path is introduced. Imports replace the entries
for one source atomically after validation, while
the source record and audit trail remain local. A display selection should keep
the selected entry snapshot, so later source edits do not rewrite a past day's
word of the day.

The provider boundary has only two capabilities: list the direct children of a
known folder and download a bounded CSV file. It accepts no Drive write,
sharing, delete, or search capability. Folder discovery and the mapping from
the configured `2026-27/Web Design/Glossaries` hierarchy to source identifiers
are the next importer step; no live Drive read occurs during normal development
or from the display request path.

No AI translation or media generation is authorized by this design alone. Such
work requires a separately configured provider, a bounded import operation,
and explicit review policy.
