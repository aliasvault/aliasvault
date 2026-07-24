# Identity generator dictionaries

This folder contains the name dictionaries used by the identity generator. Each `.txt`
file contains one name per line and is embedded into the Rust core at compile time,
so the same lists are used by all clients:

- Web client (WASM)
- Browser extensions (WASM)
- Mobile apps for iOS and Android (native)

## Layout

Languages with flat lists have three files:

```
<code>/firstnames_male.txt
<code>/firstnames_female.txt
<code>/lastnames.txt
```

Languages with decade-based first names split the first
names per birth decade so generated first names match names that were popular around
the generated birth year:

```
<code>/firstnames_male_1950_1959.txt
<code>/firstnames_female_1950_1959.txt
...
<code>/lastnames.txt
```

## Adding or updating a language

1. Add or edit the `.txt` files in the language subdirectory (one name per line).
2. Register the language in `../mod.rs` (`DICTIONARIES`), using `flat_language!` or
   `decade_language!`.
3. Rebuild and run `cargo test`: the test suite verifies every registered language has
   non-empty name lists.

See the contributing guide at https://docs.aliasvault.com/contributing/identity-generator.html
for content guidelines (name popularity sources, list sizes, etc.).
